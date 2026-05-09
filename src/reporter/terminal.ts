import pc from "picocolors";
import type { Finding, Severity } from "../detector/types.js";

const SEVERITY_RANK: Record<Severity, number> = { info: 0, warn: 1, error: 2 };

function colorSeverity(sev: Severity): string {
  if (sev === "error") return pc.red(pc.bold("ERROR"));
  if (sev === "warn") return pc.yellow("WARN ");
  return pc.cyan("INFO ");
}

export function renderTerminal(findings: Finding[], facetCount: number): string {
  const lines: string[] = [];
  lines.push(pc.dim(`scanned ${facetCount} contract artifact(s)`));
  if (findings.length === 0) {
    lines.push(pc.green("✓ no storage collisions detected"));
    return lines.join("\n");
  }

  const sorted = [...findings].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  );

  for (const f of sorted) {
    lines.push("");
    lines.push(`${colorSeverity(f.severity)} ${pc.bold(f.kind)}  ${pc.dim(f.slot)}`);
    lines.push(`  ${f.message}`);
    if (f.facets.length > 0) {
      lines.push(`  ${pc.dim("facets:")} ${f.facets.join(", ")}`);
    }
    for (const loc of f.locations) {
      const where = loc.line ? `${loc.file}:${loc.line}` : loc.file;
      lines.push(`  ${pc.dim("at")} ${where}`);
    }
  }

  const errors = findings.filter((f) => f.severity === "error").length;
  const warns = findings.filter((f) => f.severity === "warn").length;
  lines.push("");
  lines.push(pc.bold(`${errors} error(s), ${warns} warning(s)`));
  return lines.join("\n");
}
