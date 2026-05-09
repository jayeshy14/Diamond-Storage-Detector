import type { Analyzer, AnalyzerContext, FacetArtifact, Finding } from "./types.js";
import { loadFoundryArtifacts } from "./parseArtifacts.js";

export interface DetectOptions {
  path: string;
  ignoreGlobs?: string[];
  noDefaultIgnore?: boolean;
  facetGlobs?: string[];
}

export interface DetectionResult {
  artifacts: FacetArtifact[];
  findings: Finding[];
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
  const artifacts = await loadFoundryArtifacts(options.path, {
    ignoreSourcePath: buildIgnore(options.ignoreGlobs, options.noDefaultIgnore),
  });

  const ctx: AnalyzerContext = {
    artifacts,
    rawSources: new Map(),
    isFacet: buildIsFacet(options.facetGlobs),
  };

  const findings: Finding[] = [];
  for (const analyzer of analyzers) {
    const out = await analyzer.run(ctx);
    findings.push(...out);
  }

  return { artifacts, findings };
}
