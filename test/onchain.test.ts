import { describe, it, expect } from "vitest";
import { encodeAbiParameters, toEventSelector, getAddress } from "viem";
import { decodeFacetHistory, DIAMOND_CUT_EVENT } from "../src/onchain/events.js";
import { normalizeSource } from "../src/onchain/etherscan.js";
import type { RawLog } from "../src/onchain/etherscan.js";

const FACET_CUT_PARAMS = [
  {
    type: "tuple[]",
    components: [
      { name: "facetAddress", type: "address" },
      { name: "action", type: "uint8" },
      { name: "functionSelectors", type: "bytes4[]" },
    ],
  },
  { type: "address" },
  { type: "bytes" },
] as const;

const TOPIC0 = toEventSelector(DIAMOND_CUT_EVENT);
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const ZERO = "0x0000000000000000000000000000000000000000";

function makeLog(
  cuts: { facetAddress: string; action: number; functionSelectors: string[] }[],
): RawLog {
  const data = encodeAbiParameters(FACET_CUT_PARAMS as never, [
    cuts as never,
    ZERO as never,
    "0x" as never,
  ]) as `0x${string}`;
  return { data, topics: [TOPIC0], blockNumber: 1n, transactionHash: "0xabc" };
}

describe("decodeFacetHistory", () => {
  it("recovers Add and Replace facet addresses, deduped and checksummed", () => {
    const logs = [
      makeLog([{ facetAddress: A, action: 0, functionSelectors: ["0x12345678"] }]),
      makeLog([{ facetAddress: B, action: 1, functionSelectors: ["0xaabbccdd"] }]),
      // duplicate Add of A in a later cut should collapse
      makeLog([{ facetAddress: A, action: 0, functionSelectors: ["0x99999999"] }]),
    ];
    const { facets, cuts } = decodeFacetHistory(logs);
    expect(facets.sort()).toEqual([getAddress(A), getAddress(B)].sort());
    expect(cuts).toHaveLength(3);
  });

  it("retains removed facets' addresses only when re-added, excludes pure Remove and zero address", () => {
    const logs = [
      makeLog([{ facetAddress: A, action: 2, functionSelectors: ["0x12345678"] }]), // Remove
      makeLog([{ facetAddress: ZERO, action: 0, functionSelectors: [] }]), // zero addr Add
    ];
    const { facets } = decodeFacetHistory(logs);
    expect(facets).toEqual([]);
  });

  it("skips logs that do not decode as DiamondCut", () => {
    const bogus: RawLog = { data: "0x1234", topics: [TOPIC0], blockNumber: 1n, transactionHash: "0x" };
    expect(decodeFacetHistory([bogus]).facets).toEqual([]);
  });
});

describe("normalizeSource", () => {
  const base = {
    ContractName: "Foo",
    CompilerVersion: "v0.8.20+commit.a1b79de6",
    OptimizationUsed: "1",
    Runs: "200",
    EVMVersion: "paris",
  };

  it("parses the {{ ... }} double-brace standard-JSON wrapper", () => {
    const std = { language: "Solidity", sources: { "Foo.sol": { content: "contract Foo {}" } }, settings: { optimizer: { enabled: true, runs: 999 } } };
    const r = { ...base, SourceCode: `{${JSON.stringify(std)}}` };
    const out = normalizeSource(r);
    expect(Object.keys(out.sources)).toEqual(["Foo.sol"]);
    expect(out.settings.optimizer?.runs).toBe(999);
  });

  it("parses a bare path -> {content} sources map and derives settings from fields", () => {
    const map = { "a/Foo.sol": { content: "contract Foo {}" }, "b/Bar.sol": { content: "contract Bar {}" } };
    const r = { ...base, SourceCode: JSON.stringify(map) };
    const out = normalizeSource(r);
    expect(Object.keys(out.sources).sort()).toEqual(["a/Foo.sol", "b/Bar.sol"]);
    expect(out.settings.optimizer).toEqual({ enabled: true, runs: 200 });
    expect(out.settings.evmVersion).toBe("paris");
  });

  it("wraps a flattened single-file source under <ContractName>.sol", () => {
    const r = { ...base, OptimizationUsed: "0", EVMVersion: "Default", SourceCode: "// SPDX\ncontract Foo {}" };
    const out = normalizeSource(r);
    expect(Object.keys(out.sources)).toEqual(["Foo.sol"]);
    expect(out.sources["Foo.sol"]!.content).toContain("contract Foo");
    expect(out.settings.optimizer).toEqual({ enabled: false, runs: 200 });
    // "Default" evmVersion is omitted so solc uses its per-version default.
    expect(out.settings.evmVersion).toBeUndefined();
  });
});
