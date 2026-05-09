import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadFoundryArtifacts } from "../src/detector/parseArtifacts.js";

let tmp: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "diamond-detect-"));
  await fs.writeFile(path.join(tmp, "foundry.toml"), "[profile.default]\n");
  const out = path.join(tmp, "out", "FacetA.sol");
  await fs.mkdir(out, { recursive: true });
  const artifact = {
    ast: { nodeType: "SourceUnit", id: 1 },
    storageLayout: {
      storage: [
        {
          astId: 7,
          contract: "src/FacetA.sol:FacetA",
          label: "owner",
          offset: 0,
          slot: "0",
          type: "t_address",
        },
      ],
      types: {
        t_address: { encoding: "inplace", label: "address", numberOfBytes: "20" },
      },
    },
    metadata: { settings: { compilationTarget: { "src/FacetA.sol": "FacetA" } } },
    bytecode: { object: "0xdeadbeef" },
  };
  await fs.writeFile(path.join(out, "FacetA.json"), JSON.stringify(artifact));
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("loadFoundryArtifacts", () => {
  it("loads an artifact and extracts storage layout", async () => {
    const arts = await loadFoundryArtifacts(tmp);
    expect(arts).toHaveLength(1);
    expect(arts[0]!.contractName).toBe("FacetA");
    expect(arts[0]!.sourcePath).toBe("src/FacetA.sol");
    expect(arts[0]!.storageLayout?.storage[0]!.label).toBe("owner");
  });

  it("throws a clear error when out/ is missing", async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "diamond-detect-empty-"));
    await fs.writeFile(path.join(empty, "foundry.toml"), "");
    await expect(loadFoundryArtifacts(empty)).rejects.toThrow(/out\/ directory/);
    await fs.rm(empty, { recursive: true, force: true });
  });
});
