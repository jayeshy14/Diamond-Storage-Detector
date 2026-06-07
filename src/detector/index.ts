import type { Analyzer, AnalyzerContext, FacetArtifact, Finding, StorageRegion } from "./types.js";
import { loadFoundryArtifacts, loadRawSources } from "./parseArtifacts.js";
import { buildInventory } from "./inventory.js";

export interface DetectOptions {
  path: string;
  ignoreGlobs?: string[];
  noDefaultIgnore?: boolean;
  facetGlobs?: string[];
  /**
   * Pre-loaded artifacts and source text, bypassing the Foundry on-disk loader. Used by
   * the on-chain history mode, which sources artifacts by recompiling verified source
   * rather than reading `out/`. When set, `path` is ignored.
   */
  preloaded?: {
    artifacts: FacetArtifact[];
    rawSources: Map<string, string>;
  };
}

export interface DetectionResult {
  artifacts: FacetArtifact[];
  findings: Finding[];
  rawSources: Map<string, string>;
  inventory: StorageRegion[];
}

export const DEFAULT_IGNORE_GLOBS: readonly string[] = [
  "lib/**",
  "test/**",
  "script/**",
  "**/*.t.sol",
  "**/*.s.sol",
];

function compilePatterns(globs: readonly string[]): RegExp[] {
  return globs.map((g) => {
    const escaped = g
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "::DOUBLESTAR::")
      .replace(/\*/g, "[^/]*")
      .replace(/::DOUBLESTAR::/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`);
  });
}

function buildIgnore(
  userGlobs: string[] | undefined,
  noDefault: boolean | undefined,
): ((sourcePath: string) => boolean) | undefined {
  const globs = [
    ...(noDefault ? [] : DEFAULT_IGNORE_GLOBS),
    ...(userGlobs ?? []),
  ];
  if (globs.length === 0) return undefined;
  const patterns = compilePatterns(globs);
  return (sourcePath: string) => patterns.some((p) => p.test(sourcePath));
}

function buildIsFacet(
  globs: string[] | undefined,
): ((artifact: FacetArtifact) => boolean) | undefined {
  if (!globs || globs.length === 0) return undefined;
  const patterns = compilePatterns(globs);
  return (artifact) => patterns.some((p) => p.test(artifact.sourcePath));
}

export async function detect(
  options: DetectOptions,
  analyzers: Analyzer[],
): Promise<DetectionResult> {
  const ignore = buildIgnore(options.ignoreGlobs, options.noDefaultIgnore);
  const artifacts = options.preloaded
    ? (ignore ? options.preloaded.artifacts.filter((a) => !ignore(a.sourcePath)) : options.preloaded.artifacts)
    : await loadFoundryArtifacts(options.path, { ignoreSourcePath: ignore });

  const rawSources = options.preloaded
    ? options.preloaded.rawSources
    : await loadRawSources(
        options.path,
        artifacts.map((a) => a.sourcePath),
      );

  const ctx: AnalyzerContext = {
    artifacts,
    rawSources,
    isFacet: buildIsFacet(options.facetGlobs),
  };

  const findings: Finding[] = [];
  for (const analyzer of analyzers) {
    const out = await analyzer.run(ctx);
    findings.push(...out);
  }

  const inventory = buildInventory(ctx);

  return { artifacts, findings, rawSources, inventory };
}
