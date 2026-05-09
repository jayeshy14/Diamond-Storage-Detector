import { describe, expect, it } from "vitest";
import { appStorageAnalyzer } from "../src/detector/analyzers/appStorage.js";
import type {
  AnalyzerContext,
  FacetArtifact,
  StorageLayoutSlot,
} from "../src/detector/types.js";

function member(
  label: string,
  type: string,
  slot = "0",
  offset = 0,
  astId = 1,
): StorageLayoutSlot {
  return {
    astId,
    contract: "src/X.sol:X",
    label,
    type,
    slot,
    offset,
  };
}

function artifactWithStruct(
  contractName: string,
  sourcePath: string,
  structLabel: string,
  members: StorageLayoutSlot[],
  numberOfBytes = "32",
): FacetArtifact {
  return {
    contractName,
    sourcePath,
    artifactPath: `out/${contractName}.sol/${contractName}.json`,
    ast: null,
    storageLayout: {
      storage: [],
      types: {
        [`t_struct(${contractName}.${structLabel})1_storage`]: {
          encoding: "inplace",
          label: structLabel,
          numberOfBytes,
          members,
        },
        t_address: { encoding: "inplace", label: "address", numberOfBytes: "20" },
      },
    },
  };
}

function ctx(artifacts: FacetArtifact[]): AnalyzerContext {
  return { artifacts, rawSources: new Map() };
}

describe("appStorageAnalyzer", () => {
  it("emits no findings when struct fingerprints match across artifacts", () => {
    const members = [member("owner", "t_address", "0", 0), member("totalAssets", "t_uint256", "1", 0)];
    const findings = appStorageAnalyzer.run(
      ctx([
        artifactWithStruct("FacetA", "src/FacetA.sol", "struct LibX.AppStorage", members, "64"),
        artifactWithStruct("FacetB", "src/FacetB.sol", "struct LibX.AppStorage", members, "64"),
      ]),
    );
    expect(findings).toEqual([]);
  });

  it("flags when the same fully-qualified struct has divergent member layouts", () => {
    const v1 = [member("owner", "t_address", "0", 0), member("totalAssets", "t_uint256", "1", 0)];
    const v2 = [
      member("owner", "t_address", "0", 0),
      member("paused", "t_bool", "0", 20),
      member("totalAssets", "t_uint256", "1", 0),
    ];
    const findings = appStorageAnalyzer.run(
      ctx([
        artifactWithStruct("FacetA", "src/FacetA.sol", "struct LibX.AppStorage", v1, "64"),
        artifactWithStruct("FacetB", "src/FacetB.sol", "struct LibX.AppStorage", v2, "64"),
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("appstorage-fingerprint");
    expect(findings[0]!.facets.sort()).toEqual(["FacetA", "FacetB"]);
    expect(findings[0]!.message).toContain("struct LibX.AppStorage");
  });

  it("does NOT flag two distinct libraries that happen to share the simple name AppStorage", () => {
    const m = [member("owner", "t_address", "0", 0)];
    const findings = appStorageAnalyzer.run(
      ctx([
        artifactWithStruct("FacetA", "src/FacetA.sol", "struct LibFoo.AppStorage", m),
        artifactWithStruct("FacetB", "src/FacetB.sol", "struct LibBar.AppStorage", m),
      ]),
    );
    expect(findings).toEqual([]);
  });

  it("dedupes when the same fingerprint appears in many artifacts (canonical pattern)", () => {
    // Same struct used in 3 facets, all consistent → no finding.
    const m = [member("owner", "t_address", "0", 0), member("v", "t_uint256", "1", 0)];
    const findings = appStorageAnalyzer.run(
      ctx([
        artifactWithStruct("F1", "src/F1.sol", "struct Lib.AppStorage", m, "64"),
        artifactWithStruct("F2", "src/F2.sol", "struct Lib.AppStorage", m, "64"),
        artifactWithStruct("F3", "src/F3.sol", "struct Lib.AppStorage", m, "64"),
      ]),
    );
    expect(findings).toEqual([]);
  });

  it("includes a diff summary in the finding message", () => {
    const v1 = [member("owner", "t_address", "0", 0)];
    const v2 = [member("owner", "t_address", "0", 0), member("extra", "t_uint256", "1", 0)];
    const findings = appStorageAnalyzer.run(
      ctx([
        artifactWithStruct("A", "src/A.sol", "struct Lib.S", v1, "32"),
        artifactWithStruct("B", "src/B.sol", "struct Lib.S", v2, "64"),
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toMatch(/extra/);
    expect(findings[0]!.message).toMatch(/size differs/);
  });

  it("ignores artifacts without a storageLayout", () => {
    const findings = appStorageAnalyzer.run(
      ctx([
        {
          contractName: "X",
          sourcePath: "src/X.sol",
          artifactPath: "out/X.sol/X.json",
          ast: null,
          storageLayout: null,
        },
      ]),
    );
    expect(findings).toEqual([]);
  });
});
