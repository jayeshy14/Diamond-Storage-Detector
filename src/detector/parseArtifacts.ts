import { promises as fs } from "node:fs";
import path from "node:path";
import type { FacetArtifact, StorageLayout } from "./types.js";

interface ResolvedRoot {
  root: string;
  outDir: string;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveFoundryRoot(input: string): Promise<ResolvedRoot> {
  const abs = path.resolve(input);
  const stat = await fs.stat(abs);
  const candidate = stat.isDirectory() ? abs : path.dirname(abs);

  let cur = candidate;
  for (let i = 0; i < 6; i++) {
    if (await fileExists(path.join(cur, "foundry.toml"))) {
      return { root: cur, outDir: path.join(cur, "out") };
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  if (await fileExists(path.join(candidate, "out"))) {
    return { root: candidate, outDir: path.join(candidate, "out") };
  }

  throw new Error(
    `Could not locate a Foundry project root from "${input}". Run \`forge build\` first, or pass the project root.`,
  );
}

async function walkJson(dir: string, acc: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walkJson(full, acc);
    else if (e.isFile() && e.name.endsWith(".json") && !e.name.endsWith(".metadata.json")) {
      acc.push(full);
    }
  }
  return acc;
}

interface RawArtifact {
  ast?: unknown;
  storageLayout?: StorageLayout;
  metadata?: string | { settings?: { compilationTarget?: Record<string, string> } };
  bytecode?: { object?: string };
}

function extractContractName(artifactPath: string): string {
  return path.basename(artifactPath, ".json");
}

function extractSourcePath(artifactPath: string, parsed: RawArtifact): string {
  if (typeof parsed.metadata === "object" && parsed.metadata?.settings?.compilationTarget) {
    const targets = parsed.metadata.settings.compilationTarget;
    const first = Object.keys(targets)[0];
    if (first) return first;
  }
  if (typeof parsed.metadata === "string") {
    try {
      const md = JSON.parse(parsed.metadata) as RawArtifact["metadata"];
      if (typeof md === "object" && md?.settings?.compilationTarget) {
        const first = Object.keys(md.settings.compilationTarget)[0];
        if (first) return first;
      }
    } catch {
      // ignore
    }
  }
  return path.basename(path.dirname(artifactPath));
}

export interface LoadOptions {
  ignoreSourcePath?: (sourcePath: string) => boolean;
}

export async function loadFoundryArtifacts(
  inputPath: string,
  opts: LoadOptions = {},
): Promise<FacetArtifact[]> {
  const { outDir } = await resolveFoundryRoot(inputPath);
  if (!(await fileExists(outDir))) {
    throw new Error(
      `Foundry out/ directory not found at ${outDir}. Run \`forge build\` first, with \`ast = true\` and \`extra_output = ["storageLayout"]\` in foundry.toml (or pass \`--ast\` to forge).`,
    );
  }

  const files = await walkJson(outDir);
  const artifacts: FacetArtifact[] = [];

  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    let parsed: RawArtifact;
    try {
      parsed = JSON.parse(text) as RawArtifact;
    } catch {
      continue;
    }

    if (!parsed.ast && !parsed.storageLayout) continue;

    const contractName = extractContractName(file);
    const sourcePath = extractSourcePath(file, parsed);

    if (opts.ignoreSourcePath?.(sourcePath)) continue;

    artifacts.push({
      contractName,
      sourcePath,
      artifactPath: file,
      storageLayout: parsed.storageLayout ?? null,
      ast: parsed.ast,
      bytecodeHash: parsed.bytecode?.object
        ? parsed.bytecode.object.slice(0, 18)
        : undefined,
    });
  }

  return artifacts;
}
