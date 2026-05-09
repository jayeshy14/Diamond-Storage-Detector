import type {
  Analyzer,
  FacetArtifact,
  Finding,
  SourceLocation,
  StorageLayoutSlot,
} from "../types.js";

interface StructFingerprint {
  label: string;
  numberOfBytes: string;
  members: Array<Pick<StorageLayoutSlot, "label" | "offset" | "slot" | "type">>;
}

interface FingerprintedStruct {
  fingerprint: StructFingerprint;
  hash: string;
  artifact: FacetArtifact;
}

function memberFingerprint(m: StorageLayoutSlot) {
  return { label: m.label, offset: m.offset, slot: m.slot, type: m.type };
}

function structFingerprint(
  label: string,
  numberOfBytes: string,
  members: StorageLayoutSlot[],
): StructFingerprint {
  const ordered = [...members]
    .map(memberFingerprint)
    .sort((a, b) => {
      if (a.slot !== b.slot) return a.slot.localeCompare(b.slot);
      return a.offset - b.offset;
    });
  return { label, numberOfBytes, members: ordered };
}

function hashFingerprint(fp: StructFingerprint): string {
  return JSON.stringify(fp);
}

export function collectStructFingerprints(
  artifacts: FacetArtifact[],
): Map<string, FingerprintedStruct[]> {
  const byLabel = new Map<string, FingerprintedStruct[]>();
  for (const artifact of artifacts) {
    const types = artifact.storageLayout?.types;
    if (!types) continue;
    for (const entry of Object.values(types)) {
      if (!entry.members || entry.members.length === 0) continue;
      if (entry.encoding !== "inplace") continue;
      const fingerprint = structFingerprint(entry.label, entry.numberOfBytes, entry.members);
      const hash = hashFingerprint(fingerprint);
      const list = byLabel.get(entry.label) ?? [];
      list.push({ fingerprint, hash, artifact });
      byLabel.set(entry.label, list);
    }
  }
  return byLabel;
}

function dedupeByHash(items: FingerprintedStruct[]): FingerprintedStruct[] {
  const seen = new Map<string, FingerprintedStruct>();
  for (const item of items) {
    const key = `${item.hash}::${item.artifact.sourcePath}`;
    if (!seen.has(key)) seen.set(key, item);
  }
  return Array.from(seen.values());
}

function diffSummary(a: StructFingerprint, b: StructFingerprint): string {
  const aFields = new Set(a.members.map((m) => `${m.label}@${m.slot}+${m.offset}:${m.type}`));
  const bFields = new Set(b.members.map((m) => `${m.label}@${m.slot}+${m.offset}:${m.type}`));
  const onlyA = [...aFields].filter((f) => !bFields.has(f));
  const onlyB = [...bFields].filter((f) => !aFields.has(f));
  const parts: string[] = [];
  if (onlyA.length > 0) parts.push(`only in version A: ${onlyA.join(", ")}`);
  if (onlyB.length > 0) parts.push(`only in version B: ${onlyB.join(", ")}`);
  if (a.numberOfBytes !== b.numberOfBytes) {
    parts.push(`size differs (${a.numberOfBytes} vs ${b.numberOfBytes} bytes)`);
  }
  return parts.join("; ");
}

export const appStorageAnalyzer: Analyzer = {
  name: "appstorage-fingerprint",
  run(ctx) {
    const findings: Finding[] = [];
    const scoped = ctx.isFacet
      ? ctx.artifacts.filter(ctx.isFacet)
      : ctx.artifacts;
    const grouped = collectStructFingerprints(scoped);

    for (const [label, items] of grouped) {
      const variants = new Map<string, FingerprintedStruct[]>();
      for (const item of dedupeByHash(items)) {
        const list = variants.get(item.hash) ?? [];
        list.push(item);
        variants.set(item.hash, list);
      }
      if (variants.size < 2) continue;

      const variantArr = [...variants.values()];
      const sources = new Set<string>();
      const facets = new Set<string>();
      const locations: SourceLocation[] = [];
      for (const v of variantArr) {
        for (const item of v) {
          sources.add(item.artifact.sourcePath);
          facets.add(item.artifact.contractName);
          locations.push({ file: item.artifact.sourcePath });
        }
      }

      const a = variantArr[0]![0]!.fingerprint;
      const b = variantArr[1]![0]!.fingerprint;
      const summary = diffSummary(a, b);

      findings.push({
        kind: "appstorage-fingerprint",
        severity: "error",
        slot: "n/a",
        message: `${label} has ${variants.size} divergent layouts across ${sources.size} sources — ${summary || "member ordering differs"}.`,
        facets: [...facets],
        locations,
        detail: {
          structLabel: label,
          variants: variantArr.map((v) => ({
            fingerprint: v[0]!.fingerprint,
            artifacts: v.map((x) => ({
              contractName: x.artifact.contractName,
              sourcePath: x.artifact.sourcePath,
            })),
          })),
        },
      });
    }

    return findings;
  },
};
