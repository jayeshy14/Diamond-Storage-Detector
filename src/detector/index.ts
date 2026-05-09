import type { Analyzer, AnalyzerContext, FacetArtifact, Finding } from "./types.js";
import { loadFoundryArtifacts } from "./parseArtifacts.js";

export interface DetectOptions {
  path: string;
  ignoreGlobs?: string[];
}

export interface DetectionResult {
  artifacts: FacetArtifact[];
  findings: Finding[];
}

function compileIgnore(globs: string[] | undefined): ((rel: string) => boolean) | undefined {
  if (!globs || globs.length === 0) return undefined;
  const patterns = globs.map((g) => {
    const escaped = g
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "::DOUBLESTAR::")
      .replace(/\*/g, "[^/]*")
      .replace(/::DOUBLESTAR::/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`);
  });
  return (rel: string) => patterns.some((p) => p.test(rel));
}

export async function detect(
  options: DetectOptions,
  analyzers: Analyzer[],
): Promise<DetectionResult> {
  const artifacts = await loadFoundryArtifacts(options.path, {
    ignore: compileIgnore(options.ignoreGlobs),
  });

  const ctx: AnalyzerContext = {
    artifacts,
    rawSources: new Map(),
  };

  const findings: Finding[] = [];
  for (const analyzer of analyzers) {
    const out = await analyzer.run(ctx);
    findings.push(...out);
  }

  return { artifacts, findings };
}
