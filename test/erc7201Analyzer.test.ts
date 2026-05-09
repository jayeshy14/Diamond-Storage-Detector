import { describe, expect, it } from "vitest";
import {
  collectErc7201Annotations,
  erc7201Analyzer,
} from "../src/detector/analyzers/erc7201.js";
import type { AnalyzerContext, FacetArtifact } from "../src/detector/types.js";
import { erc7201Slot } from "../src/lib/eip7201.js";

function structWithAnnotation(
  contractName: string,
  sourcePath: string,
  namespaceId: string,
  structName = "Layout",
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
          nodes: [
            {
              nodeType: "StructDefinition",
              name: structName,
              src: "100:50:0",
              documentation: {
                nodeType: "StructuredDocumentation",
                text: `@custom:storage-location erc7201:${namespaceId}`,
              },
              members: [],
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

describe("collectErc7201Annotations", () => {
  it("extracts a namespace id from a struct's NatSpec", () => {
    const annotations = collectErc7201Annotations([
      structWithAnnotation("LibA", "src/LibA.sol", "myapp.access"),
    ]);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.namespaceId).toBe("myapp.access");
    expect(annotations[0]!.slot).toBe(erc7201Slot("myapp.access"));
    expect(annotations[0]!.contract).toBe("LibA");
  });

  it("ignores nodes without erc7201 annotations", () => {
    const a: FacetArtifact = {
      contractName: "LibX",
      sourcePath: "src/LibX.sol",
      artifactPath: "out/LibX.sol/LibX.json",
      storageLayout: null,
      ast: {
        nodeType: "SourceUnit",
        nodes: [
          {
            nodeType: "ContractDefinition",
            name: "LibX",
            nodes: [
              {
                nodeType: "StructDefinition",
                name: "Plain",
                documentation: {
                  nodeType: "StructuredDocumentation",
                  text: "@notice plain struct, no annotation",
                },
                members: [],
              },
            ],
          },
        ],
      },
    };
    expect(collectErc7201Annotations([a])).toEqual([]);
  });

  it("supports the annotation on a contract or library, not just a struct", () => {
    const a: FacetArtifact = {
      contractName: "MyContract",
      sourcePath: "src/MyContract.sol",
      artifactPath: "out/MyContract.sol/MyContract.json",
      storageLayout: null,
      ast: {
        nodeType: "SourceUnit",
        nodes: [
          {
            nodeType: "ContractDefinition",
            name: "MyContract",
            contractKind: "contract",
            documentation: {
              nodeType: "StructuredDocumentation",
              text: "@custom:storage-location erc7201:my.namespace",
            },
            nodes: [],
          },
        ],
      },
    };
    const annotations = collectErc7201Annotations([a]);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]!.namespaceId).toBe("my.namespace");
    expect(annotations[0]!.contract).toBe("MyContract");
  });
});

describe("erc7201Analyzer", () => {
  it("emits no findings when each namespace is unique", () => {
    const findings = erc7201Analyzer.run(
      ctx([
        structWithAnnotation("LibA", "src/LibA.sol", "myapp.a"),
        structWithAnnotation("LibB", "src/LibB.sol", "myapp.b"),
      ]),
    );
    expect(findings).toEqual([]);
  });

  it("flags two sources declaring the same erc7201 id", () => {
    const findings = erc7201Analyzer.run(
      ctx([
        structWithAnnotation("LibA", "src/LibA.sol", "myapp.shared"),
        structWithAnnotation("LibB", "src/LibB.sol", "myapp.shared"),
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("erc7201-namespace");
    expect(findings[0]!.slot).toBe(erc7201Slot("myapp.shared"));
    expect(findings[0]!.facets.sort()).toEqual(["LibA", "LibB"]);
  });

  it("dedupes when the same source location appears in multiple artifacts", () => {
    const a = structWithAnnotation("LibX", "src/LibX.sol", "shared.lib");
    const findings = erc7201Analyzer.run(ctx([a, { ...a }]));
    expect(findings).toEqual([]);
  });

  it("does NOT confuse the slot prefix with naive keccak256(id) — uses the EIP-7201 formula", () => {
    const annotations = collectErc7201Annotations([
      structWithAnnotation("Lib", "src/Lib.sol", "example.main"),
    ]);
    expect(annotations[0]!.slot).toBe(
      "0x183a6125c38840424c4a85fa12bab2ab606c4b6d0e7cc73c0c06ba5300eab500",
    );
  });
});
