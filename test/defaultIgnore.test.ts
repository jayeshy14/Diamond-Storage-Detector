import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { detect, DEFAULT_IGNORE_GLOBS } from "../src/detector/index.js";

interface ArtifactSpec {
  contractName: string;
  sourcePath: string;
}

async function writeProject(root: string, specs: ArtifactSpec[]): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "foundry.toml"), "[profile.default]\n");
  for (const s of specs) {
    const dir = path.join(root, "out", `${s.contractName}.sol`);
    await fs.mkdir(dir, { recursive: true });
    const artifact = {
      ast: { nodeType: "SourceUnit", nodes: [] },
      storageLayout: { storage: [], types: null },
      metadata: {
        settings: { compilationTarget: { [s.sourcePath]: s.contractName } },
      },
    };
    await fs.writeFile(
      path.join(dir, `${s.contractName}.json`),
      JSON.stringify(artifact),
    );
  }
}

let tmp: string;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "diamond-detect-defign-"));
});

afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("default-ignore globs", () => {
  it("declares the expected default patterns", () => {
    expect(DEFAULT_IGNORE_GLOBS).toContain("lib/**");
    expect(DEFAULT_IGNORE_GLOBS).toContain("test/**");
    expect(DEFAULT_IGNORE_GLOBS).toContain("script/**");
    expect(DEFAULT_IGNORE_GLOBS).toContain("**/*.t.sol");
    expect(DEFAULT_IGNORE_GLOBS).toContain("**/*.s.sol");
  });

  it("skips Foundry test/script/lib paths and *.t.sol / *.s.sol files by default", async () => {
    const root = path.join(tmp, "default");
    await writeProject(root, [
      { contractName: "MyFacet", sourcePath: "src/MyFacet.sol" },
      { contractName: "Test", sourcePath: "lib/forge-std/src/Test.sol" },
      { contractName: "Script", sourcePath: "lib/forge-std/src/Script.sol" },
      { contractName: "MyFacetTests", sourcePath: "test/MyFacetTests.t.sol" },
      { contractName: "DeployScript", sourcePath: "script/Deploy.s.sol" },
      { contractName: "InlineTest", sourcePath: "src/Foo.t.sol" },
      { contractName: "InlineScript", sourcePath: "src/Foo.s.sol" },
    ]);
    const result = await detect({ path: root }, []);
    const names = result.artifacts.map((a) => a.contractName).sort();
    expect(names).toEqual(["MyFacet"]);
  });

  it("includes everything when --no-default-ignore is set", async () => {
    const root = path.join(tmp, "no-default");
    await writeProject(root, [
      { contractName: "MyFacet", sourcePath: "src/MyFacet.sol" },
      { contractName: "Test", sourcePath: "lib/forge-std/src/Test.sol" },
      { contractName: "MyFacetTests", sourcePath: "test/MyFacetTests.t.sol" },
    ]);
    const result = await detect(
      { path: root, noDefaultIgnore: true },
      [],
    );
    expect(result.artifacts.map((a) => a.contractName).sort()).toEqual([
      "MyFacet",
      "MyFacetTests",
      "Test",
    ]);
  });

  it("merges user --ignore globs with the defaults", async () => {
    const root = path.join(tmp, "merged");
    await writeProject(root, [
      { contractName: "Public", sourcePath: "src/Public.sol" },
      { contractName: "Internal", sourcePath: "src/internal/Internal.sol" },
      { contractName: "Test", sourcePath: "lib/forge-std/src/Test.sol" },
    ]);
    const result = await detect(
      { path: root, ignoreGlobs: ["src/internal/**"] },
      [],
    );
    expect(result.artifacts.map((a) => a.contractName).sort()).toEqual(["Public"]);
  });
});
