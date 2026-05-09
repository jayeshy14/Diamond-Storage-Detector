import { describe, expect, it } from "vitest";
import {
  collectSlotConstants,
  diamondStorageAnalyzer,
} from "../src/detector/analyzers/diamondStorage.js";
import type { AnalyzerContext, FacetArtifact } from "../src/detector/types.js";

let nextId = 1;
function freshId(): number {
  return nextId++;
}

function variableDeclaration(name: string, namespace: string, idOverride?: number, src = "0:0:0") {
  const id = idOverride ?? freshId();
  return {
    nodeType: "VariableDeclaration",
    id,
    name,
    constant: true,
    src,
    typeName: { nodeType: "ElementaryTypeName", name: "bytes32" },
    value: {
      nodeType: "FunctionCall",
      expression: { nodeType: "Identifier", name: "keccak256" },
      arguments: [{ nodeType: "Literal", kind: "string", value: namespace }],
    },
  };
}

let nextSrc = 0;
function inlineAssemblySlotUse(declarationId: number) {
  // Construct a minimal Yul block containing `<x>.slot := <ident>` whose `<ident>`
  // src matches an externalReferences entry pointing at `declarationId`.
  const valueSrc = `${1000 + nextSrc++}:5:0`;
  return {
    nodeType: "InlineAssembly",
    src: "0:0:0",
    AST: {
      nodeType: "YulBlock",
      statements: [
        {
          nodeType: "YulAssignment",
          variableNames: [
            { nodeType: "YulIdentifier", name: "l.slot", src: "990:6:0" },
          ],
          value: { nodeType: "YulIdentifier", name: "p", src: valueSrc },
        },
      ],
    },
    externalReferences: [
      {
        declaration: declarationId,
        isSlot: false,
        isOffset: false,
        src: valueSrc,
        valueSize: 1,
      },
    ],
  };
}

function libraryArtifact(
  contractName: string,
  sourcePath: string,
  decls: ReturnType<typeof variableDeclaration>[],
  options: { confirmSlotUse?: boolean } = { confirmSlotUse: true },
): FacetArtifact {
  const contractNodes: unknown[] = [...decls];
  if (options.confirmSlotUse !== false) {
    for (const d of decls) {
      contractNodes.push({
        nodeType: "FunctionDefinition",
        name: `layout_${d.name}`,
        body: {
          nodeType: "Block",
          statements: [inlineAssemblySlotUse(d.id)],
        },
      });
    }
  }
  return {
    contractName,
    sourcePath,
    artifactPath: `out/${contractName}.sol/${contractName}.json`,
    storageLayout: null,
    ast: {
      nodeType: "SourceUnit",
      nodes: [
        {
          nodeType: "ContractDefinition",
          name: contractName,
          contractKind: "library",
          nodes: contractNodes,
        },
      ],
    },
  };
}

function ctx(artifacts: FacetArtifact[]): AnalyzerContext {
  return { artifacts, rawSources: new Map() };
}

describe("collectSlotConstants", () => {
  it("extracts a bytes32 constant whose value is keccak256(stringLiteral)", () => {
    const got = collectSlotConstants(
      ctx([
        libraryArtifact("LibA", "src/LibA.sol", [
          variableDeclaration("POSITION", "myapp.strategies"),
        ]),
      ]),
    );
    expect(got).toHaveLength(1);
    expect(got[0]!.namespace).toBe("myapp.strategies");
    expect(got[0]!.contract).toBe("LibA");
    expect(got[0]!.slot).toBe(
      "0x84d86c34a05b71953e57fe7dafea685384b33934d9ddaebd0cf7709e74b71bab",
    );
  });

  it("ignores non-bytes32 constants and non-keccak values", () => {
    const got = collectSlotConstants(
      ctx([
        libraryArtifact("LibA", "src/LibA.sol", [
          {
            nodeType: "VariableDeclaration",
            id: freshId(),
            name: "OWNER",
            constant: true,
            src: "0:0:0",
            typeName: { nodeType: "ElementaryTypeName", name: "address" },
            value: {
              nodeType: "FunctionCall",
              expression: { nodeType: "Identifier", name: "keccak256" },
              arguments: [{ nodeType: "Literal", kind: "string", value: "x" }],
            },
          } as unknown as ReturnType<typeof variableDeclaration>,
          {
            nodeType: "VariableDeclaration",
            id: freshId(),
            name: "FROM_HEX",
            constant: true,
            src: "0:0:0",
            typeName: { nodeType: "ElementaryTypeName", name: "bytes32" },
            value: {
              nodeType: "Literal",
              kind: "hexString",
              value: "deadbeef",
            },
          } as unknown as ReturnType<typeof variableDeclaration>,
        ]),
      ]),
    );
    expect(got).toHaveLength(0);
  });
});

describe("diamondStorageAnalyzer", () => {
  it("emits no findings when each namespace is unique", () => {
    const findings = diamondStorageAnalyzer.run(
      ctx([
        libraryArtifact("LibA", "src/LibA.sol", [
          variableDeclaration("POSITION", "myapp.strategies"),
        ]),
        libraryArtifact("LibB", "src/LibB.sol", [
          variableDeclaration("POSITION", "myapp.vaults"),
        ]),
      ]),
    );
    expect(findings).toEqual([]);
  });

  it("flags two libraries declaring the same namespace string", () => {
    const findings = diamondStorageAnalyzer.run(
      ctx([
        libraryArtifact("LibStrategies", "src/LibStrategies.sol", [
          variableDeclaration("POSITION", "myapp.strategies"),
        ]),
        libraryArtifact("LibVaults", "src/LibVaults.sol", [
          variableDeclaration("POSITION", "myapp.strategies"),
        ]),
      ]),
    );
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.kind).toBe("diamond-storage-namespace");
    expect(f.severity).toBe("error");
    expect(f.facets.sort()).toEqual(["LibStrategies", "LibVaults"]);
    expect(f.slot).toBe(
      "0x84d86c34a05b71953e57fe7dafea685384b33934d9ddaebd0cf7709e74b71bab",
    );
  });

  it("flags three-way collisions and lists every facet involved", () => {
    const findings = diamondStorageAnalyzer.run(
      ctx([
        libraryArtifact("LibA", "src/LibA.sol", [variableDeclaration("P", "ns.shared")]),
        libraryArtifact("LibB", "src/LibB.sol", [variableDeclaration("P", "ns.shared")]),
        libraryArtifact("LibC", "src/LibC.sol", [variableDeclaration("P", "ns.shared")]),
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.facets.sort()).toEqual(["LibA", "LibB", "LibC"]);
  });

  it("does NOT flag a single library that declares a namespace once (canonical pattern)", () => {
    const findings = diamondStorageAnalyzer.run(
      ctx([
        libraryArtifact("LibSingle", "src/LibSingle.sol", [
          variableDeclaration("POSITION", "single.only"),
        ]),
      ]),
    );
    expect(findings).toEqual([]);
  });

  it("dedupes when the same library AST is embedded in multiple artifacts", () => {
    // Foundry can emit the same library AST in multiple consumer artifacts.
    // We must not double-count the *same source location* as a collision.
    const decl = variableDeclaration("POSITION", "shared.lib", 9999, "100:50:5");
    const findings = diamondStorageAnalyzer.run(
      ctx([
        libraryArtifact("LibX", "src/LibX.sol", [decl]),
        libraryArtifact("LibX", "src/LibX.sol", [decl]),
      ]),
    );
    expect(findings).toEqual([]);
  });

  it("does NOT flag matching bytes32 constants that are never used as a storage slot", () => {
    // The BASE_MODULE pattern: keccak256("BASE") used as a module identifier
    // (mapping key, equality compare). Same string in two contracts is intentional.
    const findings = diamondStorageAnalyzer.run(
      ctx([
        libraryArtifact(
          "FacetRegistry",
          "src/FacetRegistry.sol",
          [variableDeclaration("BASE_MODULE", "BASE")],
          { confirmSlotUse: false },
        ),
        libraryArtifact(
          "Garden",
          "src/Garden.sol",
          [variableDeclaration("BASE_MODULE", "BASE")],
          { confirmSlotUse: false },
        ),
      ]),
    );
    expect(findings).toEqual([]);
  });

  it("DOES flag matching constants when at least one site is provably used as .slot", () => {
    // Mixed scenario: same string, but one or both sites consume the constant in
    // assembly { x.slot := POSITION }. Treat as a real collision.
    const findings = diamondStorageAnalyzer.run(
      ctx([
        libraryArtifact("LibStrategies", "src/LibStrategies.sol", [
          variableDeclaration("POSITION", "myapp.shared"),
        ]),
        libraryArtifact("LibVaults", "src/LibVaults.sol", [
          variableDeclaration("POSITION", "myapp.shared"),
        ]),
      ]),
    );
    expect(findings).toHaveLength(1);
  });
});
