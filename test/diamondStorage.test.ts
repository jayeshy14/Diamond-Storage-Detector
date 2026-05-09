import { describe, expect, it } from "vitest";
import {
  collectSlotConstants,
  diamondStorageAnalyzer,
} from "../src/detector/analyzers/diamondStorage.js";
import type { AnalyzerContext, FacetArtifact } from "../src/detector/types.js";

function variableDeclaration(name: string, namespace: string, src = "0:0:0") {
  return {
    nodeType: "VariableDeclaration",
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

function libraryArtifact(
  contractName: string,
  sourcePath: string,
  decls: ReturnType<typeof variableDeclaration>[],
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
          contractKind: "library",
          nodes: decls,
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
    const decl = variableDeclaration("POSITION", "shared.lib", "100:50:5");
    const findings = diamondStorageAnalyzer.run(
      ctx([
        libraryArtifact("LibX", "src/LibX.sol", [decl]),
        libraryArtifact("LibX", "src/LibX.sol", [decl]),
      ]),
    );
    expect(findings).toEqual([]);
  });
});
