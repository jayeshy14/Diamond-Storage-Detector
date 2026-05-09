import type { Finding, FindingKind, Severity } from "../detector/types.js";

const SEVERITY_LABEL: Record<Severity, string> = {
  error: "🔴 error",
  warn: "🟡 warn",
  info: "🔵 info",
};

const SEVERITY_RANK: Record<Severity, number> = { info: 0, warn: 1, error: 2 };

const KIND_TITLE: Record<FindingKind, string> = {
  "diamond-storage-namespace": "Diamond Storage namespace collisions",
  "appstorage-fingerprint": "AppStorage struct drift",
  "erc7201-namespace": "EIP-7201 namespace collisions",
  "inline-assembly-slot": "Inline-assembly hardcoded sstore slots",
  "inheritance-overlap": "Inheritance / cross-contract slot overlap",
  "mapping-overlap": "Mapping / Diamond Storage overlap",
};

function escape(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/`/g, "\\`");
}

function renderFinding(f: Finding): string {
  const lines: string[] = [];
  lines.push(`- **\`${f.slot}\`** — ${SEVERITY_LABEL[f.severity]}`);
  lines.push(`  - ${escape(f.message)}`);
  if (f.facets.length > 0) {
    lines.push(`  - facets: ${f.facets.map((x) => `\`${x}\``).join(", ")}`);
  }
  if (f.locations.length > 0) {
    const locs = Array.from(new Set(f.locations.map((l) => l.file))).slice(0, 8);
    lines.push(`  - sources: ${locs.map((l) => `\`${l}\``).join(", ")}`);
  }
  return lines.join("\n");
}

function groupByKind(findings: Finding[]): Map<FindingKind, Finding[]> {
  const map = new Map<FindingKind, Finding[]>();
  for (const f of findings) {
    const list = map.get(f.kind) ?? [];
    list.push(f);
    map.set(f.kind, list);
  }
  return map;
}

function maxSeverity(findings: Finding[]): Severity {
  let max: Severity = "info";
  for (const f of findings) {
    if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[max]) max = f.severity;
  }
  return max;
}

export function renderMarkdown(findings: Finding[], facetCount: number): string {
  const errs = findings.filter((f) => f.severity === "error").length;
  const warns = findings.filter((f) => f.severity === "warn").length;
  const infos = findings.filter((f) => f.severity === "info").length;

  if (findings.length === 0) {
    return `### diamond-detect\n\n✅ No storage collisions detected across ${facetCount} contract(s).`;
  }

  const lines: string[] = [];
  lines.push(`### diamond-detect`);
  lines.push("");
  lines.push(
    `Scanned **${facetCount}** contract(s). Found **${errs}** error(s), **${warns}** warning(s), **${infos}** info(s).`,
  );

  const grouped = groupByKind(findings);
  const orderedKinds: FindingKind[] = [
    "diamond-storage-namespace",
    "erc7201-namespace",
    "appstorage-fingerprint",
    "inheritance-overlap",
    "inline-assembly-slot",
    "mapping-overlap",
  ];

  for (const kind of orderedKinds) {
    const items = grouped.get(kind);
    if (!items || items.length === 0) continue;
    const title = KIND_TITLE[kind];
    const max = maxSeverity(items);
    const open = max === "error" ? " open" : "";
    lines.push("");
    lines.push(
      `<details${open}><summary>${SEVERITY_LABEL[max]} — ${title} (${items.length})</summary>`,
    );
    lines.push("");
    for (const f of items) lines.push(renderFinding(f));
    lines.push("");
    lines.push("</details>");
  }

  return lines.join("\n");
}
