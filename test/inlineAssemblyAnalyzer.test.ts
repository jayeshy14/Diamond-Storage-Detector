import { describe, expect, it } from "vitest";
import {
  collectSstoreLiterals,
  inlineAssemblyAnalyzer,
} from "../src/detector/analyzers/inlineAssembly.js";
import type { AnalyzerContext, FacetArtifact } from "../src/detector/types.js";

function yulSstore(slotLiteral: string, valueRef = "v") {
  return {
    nodeType: "YulExpressionStatement",
    expression: {
      nodeType: "YulFunctionCall",
      src: "200:30:0",
      functionName: { nodeType: "YulIdentifier", name: "sstore" },
      arguments: [
        { nodeType: "YulLiteral", kind: "number", value: slotLiteral, type: "" },
        { nodeType: "YulIdentifier", name: valueRef },
      ],
    },
  };
}

function yulSstoreVar(slotIdent: string, valueRef = "v") {
  return {
    nodeType: "YulExpressionStatement",
    expression: {
      nodeType: "YulFunctionCall",
      functionName: { nodeType: "YulIdentifier", name: "sstore" },
      arguments: [
        { nodeType: "YulIdentifier", name: slotIdent },
        { nodeType: "YulIdentifier", name: valueRef },
      ],
    },
  };
}

function artifactWithAssembly(
  contractName: string,
  sourcePath: string,
  yulStatements: unknown[],
): FacetArtifact {
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
          nodes: [
            {
              nodeType: "FunctionDefinition",
              name: "f",
              body: {
                nodeType: "Block",
                statements: [
                  {
                    nodeType: "InlineAssembly",
                    src: "100:200:0",
                    AST: { nodeType: "YulBlock", statements: yulStatements },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  };
}

function ctx(artifacts: FacetArtifact[]): AnalyzerContext {
  return { artifacts, rawSources: new Map() };
}

describe("collectSstoreLiterals", () => {
  it("captures sstore with a hex literal slot and normalizes to padded 0x form", () => {
    const lits = collectSstoreLiterals([
      artifactWithAssembly("Lib", "src/Lib.sol", [yulSstore("0x42")]),
    ]);
    expect(lits).toHaveLength(1);
    expect(lits[0]!.slot).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000042",
    );
    expect(lits[0]!.rawValue).toBe("0x42");
  });

  it("captures sstore with a decimal literal slot", () => {
    const lits = collectSstoreLiterals([
      artifactWithAssembly("Lib", "src/Lib.sol", [yulSstore("7")]),
    ]);
    expect(lits[0]!.slot).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000007",
    );
  });

  it("ignores sstore where the slot is a variable, not a literal", () => {
    const lits = collectSstoreLiterals([
      artifactWithAssembly("Lib", "src/Lib.sol", [yulSstoreVar("position")]),
    ]);
    expect(lits).toEqual([]);
  });

  it("ignores other Yul function calls (mload, mstore, sload)", () => {
    const lits = collectSstoreLiterals([
      artifactWithAssembly("Lib", "src/Lib.sol", [
        {
          nodeType: "YulExpressionStatement",
          expression: {
            nodeType: "YulFunctionCall",
            functionName: { nodeType: "YulIdentifier", name: "mstore" },
            arguments: [
              { nodeType: "YulLiteral", kind: "number", value: "0x40", type: "" },
              { nodeType: "YulIdentifier", name: "v" },
            ],
          },
        },
      ]),
    ]);
    expect(lits).toEqual([]);
  });

  it("handles multiple sstore literals across multiple facets", () => {
    const lits = collectSstoreLiterals([
      artifactWithAssembly("LibA", "src/LibA.sol", [yulSstore("0x1"), yulSstore("0x2")]),
      artifactWithAssembly("LibB", "src/LibB.sol", [yulSstore("0x3")]),
    ]);
    expect(lits).toHaveLength(3);
    expect(lits.map((l) => l.artifact.contractName).sort()).toEqual([
      "LibA",
      "LibA",
      "LibB",
    ]);
  });
});

describe("inlineAssemblyAnalyzer", () => {
  it("emits one info-severity finding per literal sstore", () => {
    const findings = inlineAssemblyAnalyzer.run(
      ctx([
        artifactWithAssembly("Lib", "src/Lib.sol", [yulSstore("0xdead")]),
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("inline-assembly-slot");
    expect(findings[0]!.severity).toBe("info");
    expect(findings[0]!.facets).toEqual(["Lib"]);
    expect(findings[0]!.message).toContain("0xdead");
  });

  it("emits no findings when all sstore calls use computed slots", () => {
    const findings = inlineAssemblyAnalyzer.run(
      ctx([artifactWithAssembly("Lib", "src/Lib.sol", [yulSstoreVar("position")])]),
    );
    expect(findings).toEqual([]);
  });
});
