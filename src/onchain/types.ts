/**
 * Types shared by the on-chain history mode. This mode reconstructs every facet a
 * Diamond has *ever* registered by replaying its DiamondCut event log, then recompiles
 * each facet's verified source so the same static analyzers can run over the full
 * lifetime of the proxy, not just the facets that happen to compile today.
 */

export type Address = `0x${string}`;

/** EIP-2535 FacetCutAction. */
export const FacetCutAction = {
  Add: 0,
  Replace: 1,
  Remove: 2,
} as const;

export interface FacetCutRecord {
  facetAddress: Address;
  action: number;
  selectors: string[];
  blockNumber: bigint;
  txHash: string;
}

/**
 * The verified source bundle for one facet address, as returned by Etherscan, already
 * normalized into a solc standard-JSON input plus the compiler coordinates needed to
 * reproduce the exact build.
 */
export interface FacetSource {
  address: Address;
  contractName: string;
  /** A solc standard-JSON input: { language, sources, settings }. */
  standardJson: SolcStandardInput;
  /** e.g. "v0.8.20+commit.a1b79de6" — the exact version to load. */
  compilerVersion: string;
}

export interface SolcStandardInput {
  language: "Solidity";
  sources: Record<string, { content: string }>;
  settings: {
    optimizer?: { enabled?: boolean; runs?: number };
    evmVersion?: string;
    outputSelection?: Record<string, Record<string, string[]>>;
    remappings?: string[];
    [k: string]: unknown;
  };
}

export interface OnchainOptions {
  address: Address;
  rpcUrl: string;
  etherscanKey: string;
  chainId: number;
  /** Block-range chunk size for eth_getLogs; shrinks automatically on RPC range errors. */
  logChunk?: bigint;
  /** Called with human-readable progress so the CLI can stream it to stderr. */
  onProgress?: (msg: string) => void;
}
