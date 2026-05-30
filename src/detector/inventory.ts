import type { AnalyzerContext, StorageRegion } from "./types.js";
import { collectGatedSlotConstants } from "./analyzers/diamondStorage.js";
import { collectErc7201Annotations } from "./analyzers/erc7201.js";

function lineOf(src: string | undefined, text: string | undefined): number | undefined {
  if (!src || !text) return undefined;
  const [startStr] = src.split(":");
  const start = Number(startStr);
  if (!Number.isFinite(start)) return undefined;
  let line = 1;
  for (let i = 0; i < start && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

const PRIORITY: Record<StorageRegion["kind"], number> = { erc7201: 0, namespace: 1, hardcoded: 2 };

/**
 * The set of distinct storage regions a clean project defines. Built from the same
 * gated slot inventory the collision analyzer uses, plus ERC-7201 annotations, then
 * deduped by slot so a region declared both as an annotation and a precomputed
 * literal (the common gas-optimized pattern) shows once under its readable name.
 */
export function buildInventory(ctx: AnalyzerContext): StorageRegion[] {
  const bySlot = new Map<string, StorageRegion>();

  const add = (region: StorageRegion) => {
    const existing = bySlot.get(region.slot);
    if (!existing || PRIORITY[region.kind] < PRIORITY[existing.kind]) {
      bySlot.set(region.slot, region);
    }
  };

  for (const c of collectGatedSlotConstants(ctx)) {
    add({
      slot: c.slot,
      label: c.namespace ?? c.variableName,
      kind: c.namespace ? "namespace" : "hardcoded",
      contract: c.contract,
      file: c.sourcePath,
      line: lineOf(c.src, ctx.rawSources.get(c.sourcePath)),
    });
  }

  for (const a of collectErc7201Annotations(ctx.artifacts)) {
    add({
      slot: a.slot,
      label: a.namespaceId,
      kind: "erc7201",
      contract: a.contract,
      file: a.sourcePath,
      line: lineOf(a.src, ctx.rawSources.get(a.sourcePath)),
    });
  }

  return [...bySlot.values()].sort(
    (x, y) => x.file.localeCompare(y.file) || x.slot.localeCompare(y.slot),
  );
}
