import { describe, expect, it } from "vitest";
import { inheritanceAnalyzer } from "../src/detector/analyzers/inheritance.js";
import type {
  AnalyzerContext,
  FacetArtifact,
  StorageLayoutSlot,
} from "../src/detector/types.js";

function slot(
  declaringContract: string,
  label: string,
  type: string,
  slotNum = "0",
  offset = 0,
  astId = 1,
): StorageLayoutSlot {
  return {
    astId,
    contract: declaringContract,
    label,
    type,
    slot: slotNum,
    offset,
  };
}

function facet(
  contractName: string,
  sourcePath: string,
  storage: StorageLayoutSlot[],
): FacetArtifact {
  return {
    contractName,
    sourcePath,
    artifactPath: `out/${contractName}.sol/${contractName}.json`,
    ast: null,
    storageLayout: { storage, types: null },
  };
}

function ctx(artifacts: FacetArtifact[]): AnalyzerContext {
  return { artifacts, rawSources: new Map() };
}

describe("inheritanceAnalyzer", () => {
  it("emits no findings when both facets inherit the same declaration (canonical OZ pattern)", () => {
    const ozOwner = slot("lib/oz/Ownable.sol:Ownable", "_owner", "t_address", "0", 0, 42);
    const findings = inheritanceAnalyzer.run(
      ctx([
        facet("FacetA", "src/FacetA.sol", [ozOwner]),
        facet("FacetB", "src/FacetB.sol", [ozOwner]),
      ]),
    );
    expect(findings).toEqual([]);
  });

  it("flags two facets with different declarations at the same slot", () => {
    const findings = inheritanceAnalyzer.run(
      ctx([
        facet("FacetA", "src/FacetA.sol", [
          slot("lib/oz/Ownable.sol:Ownable", "_owner", "t_address", "0", 0),
        ]),
        facet("FacetB", "src/FacetB.sol", [
          slot("src/MyOwnable.sol:MyOwnable", "owner", "t_address", "0", 0),
        ]),
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("inheritance-overlap");
    expect(findings[0]!.severity).toBe("warn");
    expect(findings[0]!.facets.sort()).toEqual(["FacetA", "FacetB"]);
    expect(findings[0]!.message).toMatch(/_owner/);
    expect(findings[0]!.message).toMatch(/owner/);
    expect(findings[0]!.slot).toBe(
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    );
  });

  it("does NOT flag a single facet with its own state (single-source slot)", () => {
    const findings = inheritanceAnalyzer.run(
      ctx([
        facet("Solo", "src/Solo.sol", [
          slot("src/Solo.sol:Solo", "x", "t_uint256", "0", 0),
        ]),
      ]),
    );
    expect(findings).toEqual([]);
  });

  it("treats different (slot,offset) combos as distinct keys", () => {
    // Two packed variables in slot 0 — different offsets, different declarations → not flagged together
    const findings = inheritanceAnalyzer.run(
      ctx([
        facet("FacetA", "src/FacetA.sol", [
          slot("src/A.sol:A", "x", "t_uint128", "0", 0),
        ]),
        facet("FacetB", "src/FacetB.sol", [
          slot("src/B.sol:B", "y", "t_uint128", "0", 16),
        ]),
      ]),
    );
    expect(findings).toEqual([]);
  });

  it("handles three-way overlap with three distinct declarations", () => {
    const findings = inheritanceAnalyzer.run(
      ctx([
        facet("F1", "src/F1.sol", [slot("lib/X.sol:X", "x", "t_uint256", "1", 0)]),
        facet("F2", "src/F2.sol", [slot("lib/Y.sol:Y", "y", "t_address", "1", 0)]),
        facet("F3", "src/F3.sol", [slot("lib/Z.sol:Z", "z", "t_bool", "1", 0)]),
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.facets.sort()).toEqual(["F1", "F2", "F3"]);
  });

  it("ignores artifacts with empty or missing storage layout", () => {
    const findings = inheritanceAnalyzer.run(
      ctx([
        facet("Empty1", "src/Empty1.sol", []),
        facet("Empty2", "src/Empty2.sol", []),
      ]),
    );
    expect(findings).toEqual([]);
  });
});
