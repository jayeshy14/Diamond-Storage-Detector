import pc from "picocolors";
import type { Finding, FindingKind, Severity, SourceLocation } from "../detector/types.js";

const SEVERITY_RANK: Record<Severity, number> = { info: 0, warn: 1, error: 2 };

interface SevStyle {
  label: string;
  glyph: string;
  paint: (s: string) => string;
}

const SEV: Record<Severity, SevStyle> = {
  error: { label: "error", glyph: "✖", paint: (s) => pc.red(s) },
  warn: { label: "warning", glyph: "⚠", paint: (s) => pc.yellow(s) },
  info: { label: "note", glyph: "●", paint: (s) => pc.cyan(s) },
};

// Per-kind one-line remediation, shown as `= help:` under each diagnostic.
const HELP: Record<FindingKind, string> = {
  "diamond-storage-namespace":
    "give every facet a unique storage seed; never reuse a namespace string, precomputed slot, or formula across facets",
  "erc7201-namespace": "use a distinct erc7201 namespace id per facet",
  "appstorage-fingerprint":
    "keep the shared struct layout identical across all facets; append fields, never reorder or insert",
  "inheritance-overlap":
    "facets must not declare sequential state variables; move state into namespaced Diamond Storage",
  "inline-assembly-slot": "confirm this hardcoded slot cannot overlap any namespaced storage region",
  "mapping-overlap": "ensure mapping base slots are derived from distinct, collision-resistant seeds",
};

function shortSlot(slot: string): string {
  if (!slot.startsWith("0x") || slot.length <= 14) return slot;
  return `${slot.slice(0, 8)}…${slot.slice(-6)}`;
}

function expandTabs(s: string): string {
  return s.replace(/\t/g, "    ");
}

interface Span {
  line: number;
  column: number; // 1-based, tab-expanded
  lineText: string; // tab-expanded
  caretLen: number;
}

function resolveSpan(loc: SourceLocation, sourceText: string | undefined): Span | null {
  if (!sourceText || !loc.src) return null;
  const [offStr, lenStr] = loc.src.split(":");
  const offset = Number(offStr);
  const length = Number(lenStr);
  if (!Number.isFinite(offset) || offset < 0 || offset > sourceText.length) return null;

  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (sourceText.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  const nl = sourceText.indexOf("\n", lineStart);
  const lineEnd = nl === -1 ? sourceText.length : nl;
  const rawLine = sourceText.slice(lineStart, lineEnd);
  const rawPrefix = sourceText.slice(lineStart, offset);
  const column = expandTabs(rawPrefix).length + 1;

  const visibleLen = expandTabs(rawLine).length;
  const rawCaret = Number.isFinite(length) && length > 0 ? length : 1;
  const caretLen = Math.max(1, Math.min(rawCaret, visibleLen - (column - 1)));

  return { line, column, lineText: expandTabs(rawLine), caretLen };
}

function renderFrame(loc: SourceLocation, span: Span, sev: SevStyle, note?: string): string[] {
  const gutter = String(span.line);
  const pad = " ".repeat(gutter.length);
  const bar = pc.dim("│");
  const arrow = pc.dim("╭─[");
  const close = pc.dim("]");
  const caret = sev.paint("─".repeat(span.caretLen));
  const caretPad = " ".repeat(span.column - 1);
  const label = note ? " " + sev.paint(note) : "";
  return [
    `  ${arrow}${pc.cyan(`${loc.file}:${span.line}:${span.column}`)}${close}`,
    `  ${pad} ${bar}`,
    `  ${pc.dim(gutter)} ${bar} ${span.lineText}`,
    `  ${pad} ${pc.dim("·")} ${caretPad}${caret}${label}`,
    `  ${pad} ${pc.dim("╰─")}`,
  ];
}

export function renderTerminal(
  findings: Finding[],
  facetCount: number,
  rawSources?: Map<string, string>,
): string {
  const artifactsNote = pc.dim(`${facetCount} artifact${facetCount === 1 ? "" : "s"} scanned`);

  if (findings.length === 0) {
    return `${pc.green(pc.bold("✔ no storage collisions detected"))}  ${pc.dim("·")}  ${artifactsNote}`;
  }

  const sorted = [...findings].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const lines: string[] = [];

  for (const f of sorted) {
    const sev = SEV[f.severity];
    const tag = `${pc.bold(sev.paint(sev.label))}${pc.dim(`[${f.kind}]`)}`;
    lines.push("");
    lines.push(`${tag}: ${pc.bold(f.message)}`);

    f.locations.forEach((loc, i) => {
      const span = resolveSpan(loc, rawSources?.get(loc.file));
      const note = i === 0 ? `slot ${shortSlot(f.slot)}` : "same slot here";
      if (span) {
        lines.push(...renderFrame(loc, span, sev, f.slot === "n/a" ? "here" : note));
      } else {
        const where = loc.line ? `${loc.file}:${loc.line}` : loc.file;
        lines.push(`  ${pc.dim("╭─[")}${pc.cyan(where)}${pc.dim("]")}`);
      }
    });

    if (f.facets.length > 0) {
      lines.push(`  ${pc.dim("= facets:")} ${f.facets.join(pc.dim(", "))}`);
    }
    if (f.slot && f.slot !== "n/a") {
      lines.push(`  ${pc.dim("= slot:  ")} ${pc.dim(f.slot)}`);
    }
    lines.push(`  ${pc.dim("= help:  ")} ${pc.dim(HELP[f.kind] ?? "")}`);
  }

  const errors = findings.filter((f) => f.severity === "error").length;
  const warns = findings.filter((f) => f.severity === "warn").length;
  const notes = findings.filter((f) => f.severity === "info").length;

  const parts: string[] = [];
  if (errors > 0) parts.push(pc.red(`${SEV.error.glyph} ${errors} error${errors === 1 ? "" : "s"}`));
  if (warns > 0)
    parts.push(pc.yellow(`${SEV.warn.glyph} ${warns} warning${warns === 1 ? "" : "s"}`));
  if (notes > 0) parts.push(pc.cyan(`${SEV.info.glyph} ${notes} note${notes === 1 ? "" : "s"}`));

  lines.push("");
  lines.push(`${parts.join(pc.dim("  ·  "))}  ${pc.dim("·")}  ${artifactsNote}`);
  return lines.join("\n");
}
