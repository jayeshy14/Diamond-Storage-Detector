import type { FacetArtifact } from "../detector/types.js";
import type { Address, OnchainOptions } from "./types.js";
import { makeClient, decodeFacetHistory } from "./events.js";
import { fetchFacetSource, fetchCreation, fetchDiamondCutLogs } from "./etherscan.js";
import { compileFacet } from "./compile.js";

export interface OnchainLoadResult {
  artifacts: FacetArtifact[];
  rawSources: Map<string, string>;
  facetCount: number;
  /** Facet addresses with no verified source on Etherscan — skipped, reported. */
  unverified: Address[];
  /** Facet addresses whose source failed to recompile — skipped, reported. */
  failed: { address: Address; error: string }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function layoutSignature(a: FacetArtifact): string {
  return `${a.sourcePath}::${a.contractName}::${JSON.stringify(a.storageLayout?.storage ?? null)}`;
}

/**
 * Reconstruct the full historical artifact set for a deployed Diamond: replay its
 * DiamondCut log to find every facet ever registered, fetch each facet's verified source,
 * recompile it with its exact solc version, and collapse the result into a deduped
 * FacetArtifact[] the existing analyzers can consume unchanged.
 *
 * Dedupe keeps divergent layouts of the same struct (the drift signal) but drops exact
 * duplicate contracts (e.g. the same OpenZeppelin base bundled into every facet).
 */
export async function loadOnchainArtifacts(opts: OnchainOptions): Promise<OnchainLoadResult> {
  const progress = opts.onProgress ?? (() => {});
  const client = makeClient(opts.rpcUrl);

  // Find the deployment block so the log scan starts there, not at block 0.
  let fromBlock = 0n;
  try {
    const creation = await fetchCreation(opts.address, opts.chainId, opts.etherscanKey);
    if (creation?.blockNumber !== undefined) {
      fromBlock = creation.blockNumber;
    } else if (creation?.txHash) {
      const receipt = await client.getTransactionReceipt({ hash: creation.txHash as `0x${string}` });
      fromBlock = receipt.blockNumber;
    }
    progress(`diamond deployed at block ${fromBlock}`);
  } catch (err) {
    progress(`could not resolve deployment block (${err instanceof Error ? err.message : err}); scanning from 0`);
  }

  const latest = await client.getBlockNumber();
  progress(`fetching DiamondCut logs from Etherscan (blocks ${fromBlock}-${latest})`);
  const rawLogs = await fetchDiamondCutLogs(
    opts.address,
    opts.chainId,
    opts.etherscanKey,
    fromBlock,
    latest,
    progress,
  );
  const { facets } = decodeFacetHistory(rawLogs);
  progress(`recovered ${facets.length} distinct facet address(es) across ${rawLogs.length} cut event(s)`);

  const seen = new Map<string, FacetArtifact>();
  const rawSources = new Map<string, string>();
  const unverified: Address[] = [];
  const failed: { address: Address; error: string }[] = [];

  for (let i = 0; i < facets.length; i++) {
    const facet = facets[i]!;
    progress(`[${i + 1}/${facets.length}] fetching source for ${facet}`);
    try {
      const source = await fetchFacetSource(facet, opts.chainId, opts.etherscanKey);
      if (!source) {
        unverified.push(facet);
        progress(`  ${facet}: not verified on Etherscan, skipping`);
        await sleep(220); // stay under the free-tier rate limit
        continue;
      }
      for (const [path, file] of Object.entries(source.standardJson.sources)) {
        if (!rawSources.has(path)) rawSources.set(path, file.content);
      }
      const compiled = await compileFacet(source);
      for (const art of compiled) {
        const key = layoutSignature(art);
        if (!seen.has(key)) seen.set(key, art);
      }
      progress(`  ${facet}: ${source.contractName}, ${compiled.length} contract(s) compiled`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ address: facet, error: msg });
      progress(`  ${facet}: FAILED — ${msg}`);
    }
    await sleep(220);
  }

  return {
    artifacts: [...seen.values()],
    rawSources,
    facetCount: facets.length,
    unverified,
    failed,
  };
}
