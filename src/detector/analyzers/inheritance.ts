import type {
  Analyzer,
  FacetArtifact,
  Finding,
  SourceLocation,
  StorageLayoutSlot,
} from "../types.js";

interface SlotEntry {
  artifact: FacetArtifact;
  slot: StorageLayoutSlot;
}

interface SlotKey {
  slot: string;
  offset: number;
}

function keyOf(s: StorageLayoutSlot): string {
  return `${s.slot}@${s.offset}`;
}

function declarationKey(s: StorageLayoutSlot): string {
  // Don't include `s.contract` — when a facet declares its own state, the contract
  // field is the facet's own path, which differs across facets even when both reference
  // the *same* conceptual variable. Same label + same type-id (incl. astId) means
  // it's the canonical shared-storage pattern, not drift.
  return `${s.label}::${s.type}`;
}

export function collectSlotEntries(artifacts: FacetArtifact[]): Map<string, SlotEntry[]> {
  const byKey = new Map<string, SlotEntry[]>();
  for (const artifact of artifacts) {
    const layout = artifact.storageLayout?.storage;
    if (!layout || layout.length === 0) continue;
    for (const slot of layout) {
      const k = keyOf(slot);
      const list = byKey.get(k) ?? [];
      list.push({ artifact, slot });
      byKey.set(k, list);
    }
  }
  return byKey;
}

export const inheritanceAnalyzer: Analyzer = {
  name: "inheritance-overlap",
  run(ctx) {
    const findings: Finding[] = [];
    const scoped = ctx.isFacet
      ? ctx.artifacts.filter(ctx.isFacet)
      : ctx.artifacts;
    const grouped = collectSlotEntries(scoped);

    for (const [_slotKey, entries] of grouped) {
      const facetNames = new Set(entries.map((e) => e.artifact.contractName));
      if (facetNames.size < 2) continue;

      const declarations = new Map<string, SlotEntry[]>();
      for (const e of entries) {
        const k = declarationKey(e.slot);
        const list = declarations.get(k) ?? [];
        list.push(e);
        declarations.set(k, list);
      }
      if (declarations.size < 2) continue;

      const sample = entries[0]!.slot;
      const slotHex = "0x" + BigInt(sample.slot).toString(16).padStart(64, "0");
      const facets = Array.from(facetNames).sort();
      const declarationsForMessage = Array.from(declarations.entries()).map(
        ([_, items]) => {
          const sample = items[0]!.slot;
          return `${sample.label}:${sample.type} (declared in ${sample.contract})`;
        },
      );

      const locations: SourceLocation[] = entries.map((e) => ({
        file: e.artifact.sourcePath,
      }));

      findings.push({
        kind: "inheritance-overlap",
        severity: "warn",
        slot: slotHex,
        message: `Slot ${sample.slot}+${sample.offset} is occupied by ${declarations.size} different declarations across ${facetNames.size} contracts: ${declarationsForMessage.join(" vs ")}. If these are Diamond facets sharing the proxy's storage, this is a collision; if they are independent contracts, ignore.`,
        facets,
        locations,
        detail: {
          slot: sample.slot,
          offset: sample.offset,
          declarations: Array.from(declarations.entries()).map(([_, items]) => ({
            contract: items[0]!.slot.contract,
            label: items[0]!.slot.label,
            type: items[0]!.slot.type,
            facets: items.map((i) => i.artifact.contractName),
          })),
        },
      });
    }

    return findings;
  },
};
