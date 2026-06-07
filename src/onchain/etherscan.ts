import { toEventSelector } from "viem";
import type { Address, FacetSource, SolcStandardInput } from "./types.js";
import { DIAMOND_CUT_EVENT } from "./events.js";

/** topic0 for DiamondCut, used to filter Etherscan's logs endpoint. */
const DIAMOND_CUT_TOPIC = toEventSelector(DIAMOND_CUT_EVENT);

export interface RawLog {
  data: `0x${string}`;
  topics: `0x${string}`[];
  blockNumber: bigint;
  transactionHash: string;
}

interface EtherscanSourceResult {
  SourceCode: string;
  ContractName: string;
  CompilerVersion: string;
  OptimizationUsed: string;
  Runs: string;
  EVMVersion: string;
}

/** Etherscan's unified V2 endpoint; chain is selected by the chainid query param. */
const V2_BASE = "https://api.etherscan.io/v2/api";

async function fetchJson(url: string, timeoutMs = 20_000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function buildSettingsFromFields(r: EtherscanSourceResult): SolcStandardInput["settings"] {
  const settings: SolcStandardInput["settings"] = {};
  if (r.OptimizationUsed === "1") {
    settings.optimizer = { enabled: true, runs: Number(r.Runs) || 200 };
  } else {
    settings.optimizer = { enabled: false, runs: 200 };
  }
  const evm = (r.EVMVersion || "").toLowerCase();
  if (evm && evm !== "default") settings.evmVersion = evm;
  return settings;
}

/**
 * Etherscan stores verified source three ways. Normalize all of them into a solc
 * standard-JSON `{ sources, settings }`:
 *   1. `{{ ... }}`  double-brace wrapper around a full standard-JSON input (most common).
 *   2. `{ ... }`    a bare standard-JSON input, or a plain path->{content} sources map.
 *   3. plain text   a single flattened source file.
 */
function normalizeSource(r: EtherscanSourceResult): Pick<SolcStandardInput, "sources" | "settings"> {
  const raw = (r.SourceCode ?? "").trim();
  const fallbackPath = `${r.ContractName || "Flattened"}.sol`;

  if (raw.startsWith("{{") && raw.endsWith("}}")) {
    const parsed = JSON.parse(raw.slice(1, -1)) as Partial<SolcStandardInput>;
    return {
      sources: parsed.sources ?? {},
      settings: parsed.settings ?? buildSettingsFromFields(r),
    };
  }

  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.sources && typeof parsed.sources === "object") {
        // A bare standard-JSON input.
        return {
          sources: parsed.sources as SolcStandardInput["sources"],
          settings: (parsed.settings as SolcStandardInput["settings"]) ?? buildSettingsFromFields(r),
        };
      }
      // A plain path -> { content } map.
      const looksLikeSourcesMap = Object.values(parsed).every(
        (v) => v && typeof v === "object" && "content" in (v as object),
      );
      if (looksLikeSourcesMap) {
        return { sources: parsed as SolcStandardInput["sources"], settings: buildSettingsFromFields(r) };
      }
    } catch {
      // fall through to flattened handling
    }
  }

  return {
    sources: { [fallbackPath]: { content: raw } },
    settings: buildSettingsFromFields(r),
  };
}

/**
 * Fetch and normalize one facet's verified source. Returns null when the address is not
 * verified on Etherscan (nothing to analyze) so the caller can warn and continue.
 */
export async function fetchFacetSource(
  address: Address,
  chainId: number,
  apiKey: string,
): Promise<FacetSource | null> {
  const url =
    `${V2_BASE}?chainid=${chainId}&module=contract&action=getsourcecode` +
    `&address=${address}&apikey=${apiKey}`;
  const json = (await fetchJson(url)) as { status: string; message: string; result: unknown };

  if (json.status !== "1" || !Array.isArray(json.result) || json.result.length === 0) {
    return null;
  }
  const r = json.result[0] as EtherscanSourceResult;
  if (!r.SourceCode || r.SourceCode.trim() === "") return null;

  const { sources, settings } = normalizeSource(r);
  if (Object.keys(sources).length === 0) return null;

  return {
    address,
    contractName: r.ContractName || "Unknown",
    compilerVersion: r.CompilerVersion,
    standardJson: { language: "Solidity", sources, settings },
  };
}

/**
 * Look up the contract-creation transaction so the log replay can start at the deployment
 * block instead of block 0 — essential on high-block chains (Arbitrum is past 470M blocks).
 * Returns the creation block when Etherscan provides it, plus the tx hash so the caller can
 * resolve the block via an RPC receipt if the field is absent on older API responses.
 */
export async function fetchCreation(
  address: Address,
  chainId: number,
  apiKey: string,
): Promise<{ txHash?: string; blockNumber?: bigint } | null> {
  const url =
    `${V2_BASE}?chainid=${chainId}&module=contract&action=getcontractcreation` +
    `&contractaddresses=${address}&apikey=${apiKey}`;
  const json = (await fetchJson(url)) as { status: string; result: unknown };
  if (json.status !== "1" || !Array.isArray(json.result) || json.result.length === 0) {
    return null;
  }
  const r = json.result[0] as { txHash?: string; blockNumber?: string };
  return {
    txHash: r.txHash,
    blockNumber: r.blockNumber ? BigInt(r.blockNumber) : undefined,
  };
}

/**
 * Fetch every DiamondCut log for the proxy via Etherscan's logs endpoint, paginated
 * server-side (1000 records per page). This deliberately bypasses the RPC's eth_getLogs
 * block-range cap — free RPC tiers (e.g. Alchemy) limit it to as few as 10 blocks, which
 * makes a from-deployment scan of a 20M-block chain impossible. Etherscan has the index,
 * so we use it for the one query that needs full history.
 */
export async function fetchDiamondCutLogs(
  address: Address,
  chainId: number,
  apiKey: string,
  fromBlock: bigint,
  toBlock: bigint,
  onProgress?: (msg: string) => void,
): Promise<RawLog[]> {
  const PAGE = 1000;
  const out: RawLog[] = [];
  for (let page = 1; ; page++) {
    const url =
      `${V2_BASE}?chainid=${chainId}&module=logs&action=getLogs` +
      `&address=${address}&topic0=${DIAMOND_CUT_TOPIC}` +
      `&fromBlock=${fromBlock}&toBlock=${toBlock}&page=${page}&offset=${PAGE}&apikey=${apiKey}`;
    const json = (await fetchJson(url)) as { status: string; message: string; result: unknown };
    // status "0" with an empty result array just means "no more logs", not an error.
    if (json.status !== "1" || !Array.isArray(json.result)) break;
    const rows = json.result as {
      data: string;
      topics: string[];
      blockNumber: string;
      transactionHash: string;
    }[];
    for (const r of rows) {
      out.push({
        data: (r.data || "0x") as `0x${string}`,
        topics: (r.topics || []) as `0x${string}`[],
        blockNumber: BigInt(r.blockNumber),
        transactionHash: r.transactionHash,
      });
    }
    onProgress?.(`  fetched ${rows.length} DiamondCut log(s) (page ${page})`);
    if (rows.length < PAGE) break;
    await new Promise((res) => setTimeout(res, 220));
  }
  return out;
}

export { normalizeSource };
