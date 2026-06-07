import { createPublicClient, http, parseAbiItem, getAddress, decodeEventLog } from "viem";
import type { Address, FacetCutRecord } from "./types.js";
import { FacetCutAction } from "./types.js";
import type { RawLog } from "./etherscan.js";

/**
 * The canonical EIP-2535 DiamondCut event. All three parameters are non-indexed, so the
 * full payload lives in `data` and viem decodes the nested struct array for us.
 */
export const DIAMOND_CUT_EVENT = parseAbiItem(
  "event DiamondCut((address facetAddress, uint8 action, bytes4[] functionSelectors)[] _diamondCut, address _init, bytes _calldata)",
);

const ZERO: Address = "0x0000000000000000000000000000000000000000";

export type ViemClient = ReturnType<typeof createPublicClient>;

export function makeClient(rpcUrl: string): ViemClient {
  return createPublicClient({ transport: http(rpcUrl) });
}

/**
 * Decode raw DiamondCut logs (fetched from Etherscan) and return the set of distinct facet
 * addresses ever registered (Add or Replace). Removed facets are intentionally retained:
 * their code may have written storage that still persists in the proxy, so their layouts
 * are part of the collision space even though they are no longer routable.
 */
export function decodeFacetHistory(logs: RawLog[]): { facets: Address[]; cuts: FacetCutRecord[] } {
  const cuts: FacetCutRecord[] = [];
  const facets = new Set<Address>();

  for (const log of logs) {
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: [DIAMOND_CUT_EVENT],
        data: log.data,
        topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
      });
    } catch {
      continue; // not a DiamondCut we can decode; skip defensively
    }
    const diamondCut = (decoded.args as { _diamondCut?: readonly unknown[] })._diamondCut;
    if (!Array.isArray(diamondCut)) continue;
    for (const cut of diamondCut) {
      const c = cut as { facetAddress?: string; action?: number; functionSelectors?: string[] };
      if (typeof c.facetAddress !== "string") continue;
      const facetAddress = getAddress(c.facetAddress) as Address;
      const action = typeof c.action === "number" ? c.action : Number(c.action);
      cuts.push({
        facetAddress,
        action,
        selectors: Array.isArray(c.functionSelectors) ? c.functionSelectors : [],
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
      });
      if (facetAddress !== ZERO && action !== FacetCutAction.Remove) {
        facets.add(facetAddress);
      }
    }
  }
  return { facets: [...facets], cuts };
}
