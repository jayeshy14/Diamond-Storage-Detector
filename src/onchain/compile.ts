import { createRequire } from "node:module";
import type { FacetArtifact, StorageLayout } from "../detector/types.js";
import type { FacetSource, SolcStandardInput } from "./types.js";

// solc is CommonJS; load it through createRequire so this stays an ESM module.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const solc = require("solc") as {
  compile: (input: string, opts?: unknown) => string;
  loadRemoteVersion: (
    version: string,
    cb: (err: Error | null, snapshot: { compile: (input: string) => string } | null) => void,
  ) => void;
};

interface SolcSnapshot {
  compile: (input: string) => string;
}

// One soljson binary is multiple MB and many facets share a compiler version, so cache
// each loaded snapshot by its version string and never download the same version twice.
const snapshotCache = new Map<string, Promise<SolcSnapshot>>();

function loadSolc(version: string): Promise<SolcSnapshot> {
  const cached = snapshotCache.get(version);
  if (cached) return cached;
  const p = new Promise<SolcSnapshot>((resolve, reject) => {
    solc.loadRemoteVersion(version, (err, snapshot) => {
      if (err || !snapshot) reject(err ?? new Error(`failed to load solc ${version}`));
      else resolve(snapshot);
    });
  });
  snapshotCache.set(version, p);
  return p;
}

interface SolcOutput {
  errors?: { severity: string; formattedMessage?: string; message?: string }[];
  sources?: Record<string, { ast?: unknown }>;
  contracts?: Record<string, Record<string, { storageLayout?: StorageLayout }>>;
}

/** Force the two outputs the analyzers need, regardless of what the verified build asked for. */
function withAnalysisOutput(input: SolcStandardInput): SolcStandardInput {
  return {
    ...input,
    settings: {
      ...input.settings,
      outputSelection: {
        "*": { "*": ["storageLayout"], "": ["ast"] },
      },
    },
  };
}

/**
 * Recompile one facet's verified source with its exact compiler version and turn the
 * solc output into the same FacetArtifact shape the offline (Foundry) path produces.
 *
 * Source paths are preserved verbatim, NOT prefixed by facet address. That is deliberate:
 * a library shared across facets (LibDiamond, OpenZeppelin) keeps one canonical path, so
 * it collapses to a single source and never reports a false collision against itself. Two
 * facets that *independently* declare the same namespace live at distinct paths and are
 * still caught.
 */
export async function compileFacet(source: FacetSource): Promise<FacetArtifact[]> {
  // Normalize the Etherscan version ("v0.8.20+commit.a1b79de6") to solc's expected form.
  const version = source.compilerVersion.startsWith("v")
    ? source.compilerVersion
    : `v${source.compilerVersion}`;
  const snapshot = await loadSolc(version);

  const input = withAnalysisOutput(source.standardJson);
  const out = JSON.parse(snapshot.compile(JSON.stringify(input))) as SolcOutput;

  const fatal = (out.errors ?? []).filter((e) => e.severity === "error");
  if (fatal.length > 0 && !out.contracts) {
    const first = fatal[0]!;
    throw new Error(
      `solc ${version} failed for ${source.address} (${source.contractName}): ` +
        (first.formattedMessage ?? first.message ?? "unknown error"),
    );
  }

  const artifacts: FacetArtifact[] = [];
  const contracts = out.contracts ?? {};
  for (const [file, contractMap] of Object.entries(contracts)) {
    const ast = out.sources?.[file]?.ast;
    for (const [name, c] of Object.entries(contractMap)) {
      artifacts.push({
        contractName: name,
        sourcePath: file,
        artifactPath: `onchain:${source.address}:${file}:${name}`,
        storageLayout: c.storageLayout ?? null,
        ast,
      });
    }
  }
  return artifacts;
}
