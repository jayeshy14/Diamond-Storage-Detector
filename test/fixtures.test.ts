import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { detect } from "../src/detector/index.js";
import { defaultAnalyzers } from "../src/detector/analyzers/index.js";
import type { Finding } from "../src/detector/types.js";

interface Decl {
  name: string;
  namespace: string;
}

interface FacetSpec {
  contract: string;
  sourcePath: string;
  decls: Decl[];
}

interface FixtureSpec {
  name: string;
  description: string;
  facets: FacetSpec[];
}

function buildArtifact(spec: FacetSpec): unknown {
  return {
    ast: {
      nodeType: "SourceUnit",
      nodes: [
        {
          nodeType: "ContractDefinition",
          name: spec.contract,
          contractKind: "library",
          nodes: spec.decls.map((d, i) => ({
            nodeType: "VariableDeclaration",
            name: d.name,
            constant: true,
            src: `${100 + i * 50}:50:0`,
            typeName: { nodeType: "ElementaryTypeName", name: "bytes32" },
            value: {
              nodeType: "FunctionCall",
              expression: { nodeType: "Identifier", name: "keccak256" },
              arguments: [{ nodeType: "Literal", kind: "string", value: d.namespace }],
            },
          })),
        },
      ],
    },
    metadata: {
      settings: { compilationTarget: { [spec.sourcePath]: spec.contract } },
    },
    storageLayout: { storage: [], types: null },
  };
}

async function writeFixture(root: string, facets: FacetSpec[]): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "foundry.toml"), "[profile.default]\n");
  for (const f of facets) {
    const dir = path.join(root, "out", `${f.contract}.sol`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, `${f.contract}.json`),
      JSON.stringify(buildArtifact(f)),
    );
  }
}

function normalizeFindings(findings: Finding[]): unknown[] {
  return [...findings]
    .sort((a, b) => a.slot.localeCompare(b.slot))
    .map((f) => ({
      kind: f.kind,
      severity: f.severity,
      slot: f.slot,
      facets: [...f.facets].sort(),
      namespaces: ((f.detail?.namespaces as string[]) ?? []).slice().sort(),
      message: f.message,
    }));
}

const FIXTURES: FixtureSpec[] = [
  {
    name: "01-clean-baseline",
    description: "two facets with distinct namespaces — must produce no findings",
    facets: [
      {
        contract: "LibA",
        sourcePath: "src/LibA.sol",
        decls: [{ name: "POSITION", namespace: "blok.a" }],
      },
      {
        contract: "LibB",
        sourcePath: "src/LibB.sol",
        decls: [{ name: "POSITION", namespace: "blok.b" }],
      },
    ],
  },
  {
    name: "02-two-way-collision",
    description:
      "LibStrategies and LibVaults both declare keccak256(\"blok.strategies\")",
    facets: [
      {
        contract: "LibStrategies",
        sourcePath: "src/LibStrategies.sol",
        decls: [{ name: "POSITION", namespace: "blok.strategies" }],
      },
      {
        contract: "LibVaults",
        sourcePath: "src/LibVaults.sol",
        decls: [{ name: "POSITION", namespace: "blok.strategies" }],
      },
    ],
  },
  {
    name: "03-three-way-collision",
    description: "three libraries all reach the same slot",
    facets: [
      {
        contract: "LibA",
        sourcePath: "src/LibA.sol",
        decls: [{ name: "P", namespace: "ns.shared" }],
      },
      {
        contract: "LibB",
        sourcePath: "src/LibB.sol",
        decls: [{ name: "P", namespace: "ns.shared" }],
      },
      {
        contract: "LibC",
        sourcePath: "src/LibC.sol",
        decls: [{ name: "P", namespace: "ns.shared" }],
      },
    ],
  },
  {
    name: "04-shared-prefix-distinct",
    description:
      "namespaces share a prefix but resolve to different slots — must not be flagged",
    facets: [
      {
        contract: "LibFoo",
        sourcePath: "src/LibFoo.sol",
        decls: [{ name: "POSITION", namespace: "blok.foo" }],
      },
      {
        contract: "LibFooBar",
        sourcePath: "src/LibFooBar.sol",
        decls: [{ name: "POSITION", namespace: "blok.foobar" }],
      },
    ],
  },
  {
    name: "05-mixed-clean-and-collision",
    description:
      "four facets — two collide on \"blok.market\", two are clean. Only one finding expected.",
    facets: [
      {
        contract: "LibMarket",
        sourcePath: "src/LibMarket.sol",
        decls: [{ name: "POSITION", namespace: "blok.market" }],
      },
      {
        contract: "LibOrders",
        sourcePath: "src/LibOrders.sol",
        decls: [{ name: "POSITION", namespace: "blok.market" }],
      },
      {
        contract: "LibTokens",
        sourcePath: "src/LibTokens.sol",
        decls: [{ name: "POSITION", namespace: "blok.tokens" }],
      },
      {
        contract: "LibFees",
        sourcePath: "src/LibFees.sol",
        decls: [{ name: "POSITION", namespace: "blok.fees" }],
      },
    ],
  },
];

let tmp: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "diamond-detect-fix-"));
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("namespace-duplicate fixtures", () => {
  for (const fx of FIXTURES) {
    it(`${fx.name}: ${fx.description}`, async () => {
      const root = path.join(tmp, fx.name);
      await writeFixture(root, fx.facets);
      const result = await detect({ path: root }, defaultAnalyzers);
      expect(result.artifacts.length).toBe(fx.facets.length);
      expect(normalizeFindings(result.findings)).toMatchSnapshot();
    });
  }
});
