import type { Finding } from "../detector/types.js";

export function renderJson(findings: Finding[], facetCount: number): string {
  return JSON.stringify(
    {
      summary: {
        facetCount,
        errors: findings.filter((f) => f.severity === "error").length,
        warnings: findings.filter((f) => f.severity === "warn").length,
        info: findings.filter((f) => f.severity === "info").length,
      },
      findings,
    },
    null,
    2,
  );
}
