import type { Finding } from "../detector/types.js";

export function renderMarkdown(findings: Finding[], facetCount: number): string {
  const errs = findings.filter((f) => f.severity === "error").length;
  const warns = findings.filter((f) => f.severity === "warn").length;

  if (findings.length === 0) {
    return `### diamond-detect\n\n✅ No storage collisions detected across ${facetCount} contract(s).`;
  }

  const lines: string[] = [];
  lines.push(`### diamond-detect — ${errs} error(s), ${warns} warning(s)`);
  lines.push("");
  lines.push("| Severity | Kind | Slot | Facets | Message |");
  lines.push("|---|---|---|---|---|");
  for (const f of findings) {
    const facets = f.facets.join(", ");
    const slot = `\`${f.slot}\``;
    const msg = f.message.replace(/\|/g, "\\|");
    lines.push(`| ${f.severity} | ${f.kind} | ${slot} | ${facets} | ${msg} |`);
  }
  return lines.join("\n");
}
