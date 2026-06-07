import { describe, expect, it } from "vitest";
import {
  collectAssemblyLiteralSlots,
  collectFormulaSlotConstants,
  collectLiteralSlotConstants,
  collectSlotConstants,
  diamondStorageAnalyzer,
} from "../src/detector/analyzers/diamondStorage.js";
import { erc7201Slot } from "../src/lib/eip7201.js";
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

// A `bytes32 constant = 0x<precomputed literal>` declaration (the gas-optimized
// ERC-7201 idiom). Same VariableDeclaration shape as variableDeclaration, but the
// value is a number Literal rather than a keccak256(string) call.
function literalSlotDeclaration(
  name: string,
  slotHex: string,
  idOverride?: number,
  src = "0:0:0",
) {
  const id = idOverride ?? freshId();
  return {
    nodeType: "VariableDeclaration",
    id,
    name,
    constant: true,
    src,
    typeName: { nodeType: "ElementaryTypeName", name: "bytes32" },
    value: { nodeType: "Literal", kind: "number", value: slotHex },
  } as unknown as ReturnType<typeof variableDeclaration>;
}

// A `bytes32 constant = keccak256(abi.encode(uint256(keccak256("ns")) - 1)) & ~bytes32(uint256(0xff))`
// declaration: the ERC-7201 slot formula written inline, no annotation, no literal.
function formulaSlotDeclaration(
  name: string,
  namespace: string,
  idOverride?: number,
  src = "0:0:0",
  maskLiteralValue = "0xff",
) {
  const id = idOverride ?? freshId();
  return {
    nodeType: "VariableDeclaration",
    id,
    name,
    constant: true,
    src,
    typeName: { nodeType: "ElementaryTypeName", name: "bytes32" },
    value: {
      nodeType: "BinaryOperation",
      operator: "&",
      leftExpression: {
        nodeType: "FunctionCall",
        expression: { nodeType: "Identifier", name: "keccak256" },
        arguments: [
          {
            nodeType: "FunctionCall",
            expression: { nodeType: "Identifier", name: "abi.encode" },
            arguments: [
              {
                nodeType: "BinaryOperation",
                operator: "-",
                leftExpression: {
                  nodeType: "FunctionCall",
                  expression: { nodeType: "ElementaryTypeNameExpression", name: "uint256" },
                  arguments: [
                    {
                      nodeType: "FunctionCall",
                      expression: { nodeType: "Identifier", name: "keccak256" },
                      arguments: [{ nodeType: "Literal", kind: "string", value: namespace }],
                    },
                  ],
                },
                rightExpression: { nodeType: "Literal", kind: "number", value: "1" },
              },
            ],
          },
        ],
      },
      rightExpression: {
        nodeType: "UnaryOperation",
        operator: "~",
        subExpression: { nodeType: "Literal", kind: "number", value: maskLiteralValue },
      },
    },
  } as unknown as ReturnType<typeof variableDeclaration>;
}

// A library whose only storage access is `assembly { s.slot := <number literal> }`.
function assemblyLiteralArtifact(
  contractName: string,
  sourcePath: string,
  slotHex: string,
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
              nodeType: "FunctionDefinition",
              name: "layout",
              body: {
                nodeType: "Block",
                statements: [
                  {
                    nodeType: "InlineAssembly",
                    src: "0:0:0",
                    AST: {
                      nodeType: "YulBlock",
                      statements: [
                        {
                          nodeType: "YulAssignment",
                          variableNames: [{ nodeType: "YulIdentifier", name: "s.slot" }],
                          value: { nodeType: "YulLiteral", kind: "number", value: slotHex },
                        },
                      ],
                    },
                    externalReferences: [],
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

// Real precomputed ERC-7201 slots taken from a production Diamond (vault-router).
const SLOT_A = "0x340080245a7d3e67835fb5055646777827d09fc7212fda4d8d724367e1215700";
const SLOT_B = "0xb0e016db49ce2cfbe35770c2200cbf5f1a9b502bca57dbaaddf328cb9e0cef00";
// keccak256("myapp.strategies"), matching the keccak fixtures above.
const KECCAK_STRATEGIES_SLOT =
  "0x84d86c34a05b71953e57fe7dafea685384b33934d9ddaebd0cf7709e74b71bab";

describe("collectLiteralSlotConstants", () => {
  it("extracts a bytes32 constant whose value is a precomputed hex literal", () => {
    const got = collectLiteralSlotConstants(
      ctx([
        libraryArtifact("LibAave", "src/LibAave.sol", [
          literalSlotDeclaration("AAVE_STORAGE_SLOT", SLOT_A),
        ]),
      ]),
    );
    expect(got).toHaveLength(1);
    expect(got[0]!.namespace).toBeNull();
    expect(got[0]!.slot).toBe(SLOT_A);
    expect(got[0]!.contract).toBe("LibAave");
  });

  it("left-pads a short numeric literal to a full 32-byte slot", () => {
    const got = collectLiteralSlotConstants(
      ctx([libraryArtifact("LibX", "src/LibX.sol", [literalSlotDeclaration("S", "0x01")])]),
    );
    expect(got).toHaveLength(1);
    expect(got[0]!.slot).toBe("0x" + "0".repeat(63) + "1");
  });

  it("ignores keccak256(string) constants (those belong to collectSlotConstants)", () => {
    const got = collectLiteralSlotConstants(
      ctx([
        libraryArtifact("LibA", "src/LibA.sol", [
          variableDeclaration("POSITION", "myapp.strategies"),
        ]),
      ]),
    );
    expect(got).toHaveLength(0);
  });
});

describe("diamondStorageAnalyzer — hardcoded precomputed literal slots", () => {
  it("flags two facets that share the same precomputed literal slot", () => {
    // Regression for the silent false negative: bare `bytes32 constant = 0x..`
    // slots with no keccak256(string) and no @custom:storage-location annotation,
    // accessed via `assembly { s.slot := slot }`. Before the fix this returned
    // "no collisions detected" on an identical-slot pair.
    const findings = diamondStorageAnalyzer.run(
      ctx([
        libraryArtifact("LibAave", "src/LibAave.sol", [
          literalSlotDeclaration("AAVE_STORAGE_SLOT", SLOT_A),
        ]),
        libraryArtifact("LibMorpho", "src/LibMorpho.sol", [
          literalSlotDeclaration("MORPHO_STORAGE_SLOT", SLOT_A),
        ]),
      ]),
    );
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.kind).toBe("diamond-storage-namespace");
    expect(f.severity).toBe("error");
    expect(f.slot).toBe(SLOT_A);
    expect(f.facets.sort()).toEqual(["LibAave", "LibMorpho"]);
  });

  it("does NOT flag distinct precomputed literal slots", () => {
    const findings = diamondStorageAnalyzer.run(
      ctx([
        libraryArtifact("LibAave", "src/LibAave.sol", [
          literalSlotDeclaration("AAVE_STORAGE_SLOT", SLOT_A),
        ]),
        libraryArtifact("LibPendle", "src/LibPendle.sol", [
          literalSlotDeclaration("PENDLE_STORAGE_SLOT", SLOT_B),
        ]),
      ]),
    );
    expect(findings).toEqual([]);
  });

  it("does NOT flag a bytes32 literal constant that is never used as a slot", () => {
    // A precomputed role id / domain separator reused across facets is intentional,
    // not a storage collision. The isUsedAsSlot gate must exclude it.
    const findings = diamondStorageAnalyzer.run(
      ctx([
        libraryArtifact("RolesA", "src/RolesA.sol", [literalSlotDeclaration("ADMIN_ROLE", SLOT_A)], {
          confirmSlotUse: false,
        }),
        libraryArtifact("RolesB", "src/RolesB.sol", [literalSlotDeclaration("ADMIN_ROLE", SLOT_A)], {
          confirmSlotUse: false,
        }),
      ]),
    );
    expect(findings).toEqual([]);
  });

  it("flags a hardcoded literal that collides with a keccak256 namespace slot", () => {
    // keccak256("myapp.strategies") === KECCAK_STRATEGIES_SLOT. A second facet that
    // hardcodes that precomputed value lands on the same slot -> real collision.
    const findings = diamondStorageAnalyzer.run(
      ctx([
        libraryArtifact("LibStrategies", "src/LibStrategies.sol", [
          variableDeclaration("POSITION", "myapp.strategies"),
        ]),
        libraryArtifact("LibClone", "src/LibClone.sol", [
          literalSlotDeclaration("STRATEGIES_SLOT", KECCAK_STRATEGIES_SLOT),
        ]),
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.facets.sort()).toEqual(["LibClone", "LibStrategies"]);
    expect(findings[0]!.slot).toBe(KECCAK_STRATEGIES_SLOT);
  });
});

describe("collectFormulaSlotConstants", () => {
  it("recovers the namespace from an inline ERC-7201 formula and resolves its slot", () => {
    const got = collectFormulaSlotConstants(
      ctx([
        libraryArtifact("LibApp", "src/LibApp.sol", [
          formulaSlotDeclaration("APP_STORAGE", "myapp.main"),
        ]),
      ]),
    );
    expect(got).toHaveLength(1);
    expect(got[0]!.namespace).toBe("myapp.main");
    expect(got[0]!.slot).toBe(erc7201Slot("myapp.main"));
  });

  it("does not match a plain keccak256(string) (handled by collectSlotConstants)", () => {
    const got = collectFormulaSlotConstants(
      ctx([
        libraryArtifact("LibA", "src/LibA.sol", [
          variableDeclaration("POSITION", "myapp.main"),
        ]),
      ]),
    );
    expect(got).toHaveLength(0);
  });

  it("rejects a formula whose mask is not the canonical ~0xff low-byte clear", () => {
    // Same keccak/-1 shape but masked with 0xffff instead of 0xff. It computes a
    // different slot, so it must not be misread as ERC-7201 and assigned the standard
    // erc7201Slot(namespace) it does not occupy.
    const got = collectFormulaSlotConstants(
      ctx([
        libraryArtifact("LibBadMask", "src/LibBadMask.sol", [
          formulaSlotDeclaration("S", "myapp.main", undefined, "0:0:0", "0xffff"),
        ]),
      ]),
    );
    expect(got).toHaveLength(0);
  });
});

describe("diamondStorageAnalyzer — inline ERC-7201 formula slots", () => {
  it("flags two facets computing the same namespace via the inline formula", () => {
    const findings = diamondStorageAnalyzer.run(
      ctx([
        libraryArtifact("LibA", "src/LibA.sol", [formulaSlotDeclaration("S", "shared.ns")]),
        libraryArtifact("LibB", "src/LibB.sol", [formulaSlotDeclaration("S", "shared.ns")]),
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.slot).toBe(erc7201Slot("shared.ns"));
    expect(findings[0]!.facets.sort()).toEqual(["LibA", "LibB"]);
  });

  it("cross-detects an inline formula against a hardcoded literal of the same slot", () => {
    // The strongest completeness case: one facet writes the formula, another pastes
    // the precomputed literal. Different representations, same slot, real collision.
    const sharedSlot = erc7201Slot("shared.ns");
    const findings = diamondStorageAnalyzer.run(
      ctx([
        libraryArtifact("LibFormula", "src/LibFormula.sol", [
          formulaSlotDeclaration("S", "shared.ns"),
        ]),
        libraryArtifact("LibLiteral", "src/LibLiteral.sol", [
          literalSlotDeclaration("S", sharedSlot),
        ]),
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.slot).toBe(sharedSlot);
    expect(findings[0]!.facets.sort()).toEqual(["LibFormula", "LibLiteral"]);
  });
});

describe("collectAssemblyLiteralSlots", () => {
  it("captures a direct `assembly { s.slot := <literal> }` assignment", () => {
    const got = collectAssemblyLiteralSlots([
      assemblyLiteralArtifact("LibRaw", "src/LibRaw.sol", SLOT_A),
    ]);
    expect(got).toHaveLength(1);
    expect(got[0]!.slot).toBe(SLOT_A);
    expect(got[0]!.contract).toBe("LibRaw");
    expect(got[0]!.namespace).toBeNull();
  });
});

describe("diamondStorageAnalyzer — direct assembly literal slots", () => {
  it("flags two facets pinning the same slot directly in assembly", () => {
    const findings = diamondStorageAnalyzer.run(
      ctx([
        assemblyLiteralArtifact("LibRawA", "src/LibRawA.sol", SLOT_A),
        assemblyLiteralArtifact("LibRawB", "src/LibRawB.sol", SLOT_A),
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.slot).toBe(SLOT_A);
    expect(findings[0]!.facets.sort()).toEqual(["LibRawA", "LibRawB"]);
  });

  it("does NOT flag distinct assembly literal slots", () => {
    const findings = diamondStorageAnalyzer.run(
      ctx([
        assemblyLiteralArtifact("LibRawA", "src/LibRawA.sol", SLOT_A),
        assemblyLiteralArtifact("LibRawB", "src/LibRawB.sol", SLOT_B),
      ]),
    );
    expect(findings).toEqual([]);
  });
});
