import { Command } from "commander";
import pc from "picocolors";
import { detect } from "./detector/index.js";
import { decideCoverageAction } from "./detector/coverage.js";
import { defaultAnalyzers } from "./detector/analyzers/index.js";
import { renderTerminal } from "./reporter/terminal.js";
import { renderJson } from "./reporter/json.js";
import { renderMarkdown } from "./reporter/markdown.js";
import type { Severity } from "./detector/types.js";

const SEVERITY_RANK: Record<Severity, number> = { info: 0, warn: 1, error: 2 };

interface CliOptions {
  json?: boolean;
  markdown?: boolean;
  severity: Severity;
  ignore: string[];
  noDefaultIgnore?: boolean;
  facets: string[];
  allowMissingAst?: boolean;
  onchain?: string;
  rpc?: string;
  etherscanKey?: string;
  chainid?: string;
}

// Load .env so RPC_URL_* and API_KEY_ETHERSCAN can be picked up without exporting them.
// Available on Node 20.12+/21.7+; guarded so older runtimes (and a missing file) are fine.
try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env");
} catch {
  // no .env, or unsupported runtime — env vars may still be exported directly
}

async function loadOnchain(opts: CliOptions): Promise<{
  artifacts: import("./detector/types.js").FacetArtifact[];
  rawSources: Map<string, string>;
}> {
  const { loadOnchainArtifacts } = await import("./onchain/index.js");
  const address = opts.onchain as `0x${string}`;
  const rpcUrl = opts.rpc ?? process.env.RPC_URL_ARB ?? process.env.RPC_URL ?? "";
  const etherscanKey = opts.etherscanKey ?? process.env.API_KEY_ETHERSCAN ?? "";
  const chainId = opts.chainid ? Number(opts.chainid) : 42161; // default: Arbitrum One

  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`--onchain expects a 20-byte address, got "${address}"`);
  }
  if (!rpcUrl) throw new Error("no RPC URL: pass --rpc or set RPC_URL_ARB / RPC_URL");
  if (!etherscanKey) throw new Error("no Etherscan key: pass --etherscan-key or set API_KEY_ETHERSCAN");

  const res = await loadOnchainArtifacts({
    address,
    rpcUrl,
    etherscanKey,
    chainId,
    onProgress: (m) => process.stderr.write(pc.dim(m) + "\n"),
  });

  if (res.unverified.length > 0) {
    process.stderr.write(
      pc.yellow(`warning: ${res.unverified.length} facet(s) had no verified source and were skipped\n`),
    );
  }
  for (const f of res.failed) {
    process.stderr.write(pc.yellow(`warning: could not recompile ${f.address}: ${f.error}\n`));
  }
  return { artifacts: res.artifacts, rawSources: res.rawSources };
}

async function run(target: string | undefined, opts: CliOptions): Promise<void> {
  const preloaded = opts.onchain ? await loadOnchain(opts) : undefined;
  const result = await detect(
    {
      path: target ?? ".",
      ignoreGlobs: opts.ignore,
      noDefaultIgnore: opts.noDefaultIgnore,
      facetGlobs: opts.facets.length > 0 ? opts.facets : undefined,
      preloaded,
    },
    defaultAnalyzers,
  );

  const decision = decideCoverageAction(result.artifacts, {
    allowMissingAst: opts.allowMissingAst,
  });
  if (decision.message) {
    const colored =
      decision.level === "error" ? pc.red(decision.message) : pc.yellow(decision.message);
    process.stderr.write(colored + "\n");
  }
  if (decision.exitCode !== undefined) {
    // Fail closed before rendering, so we never print a "no collisions" report for a
    // scan that could not actually run the AST-based analyzers.
    process.exit(decision.exitCode);
  }

  const output = opts.json
    ? renderJson(result.findings, result.artifacts.length)
    : opts.markdown
      ? renderMarkdown(result.findings, result.artifacts.length)
      : renderTerminal(
          result.findings,
          result.artifacts.length,
          result.rawSources,
          result.inventory,
        );

  process.stdout.write(output + "\n");

  const threshold = SEVERITY_RANK[opts.severity];
  const hit = result.findings.some((f) => SEVERITY_RANK[f.severity] >= threshold);
  process.exit(hit ? 1 : 0);
}

const program = new Command();

program
  .name("diamond-detect")
  .description("Static analyzer for EIP-2535 Diamond storage-slot collisions")
  .argument("[path]", "Foundry project root or src/ folder (omit when using --onchain)")
  .option(
    "--onchain <address>",
    "History mode: replay the deployed Diamond's DiamondCut log, recompile every facet ever registered (verified source from Etherscan), and check the full lifetime for collisions",
  )
  .option("--rpc <url>", "RPC endpoint for --onchain (default: $RPC_URL_ARB or $RPC_URL)")
  .option("--etherscan-key <key>", "Etherscan API key for --onchain (default: $API_KEY_ETHERSCAN)")
  .option("--chainid <n>", "Chain id for --onchain Etherscan V2 lookups (default: 42161, Arbitrum One)")
  .option("--json", "Emit machine-readable JSON")
  .option("--markdown", "Emit GitHub-flavored Markdown (PR-friendly)")
  .option(
    "--severity <level>",
    "Exit-code threshold: info | warn | error",
    (v: string) => {
      if (v !== "info" && v !== "warn" && v !== "error") {
        throw new Error(`invalid severity: ${v}`);
      }
      return v;
    },
    "warn" as Severity,
  )
  .option(
    "--ignore <glob>",
    "Skip source files matching this glob. Repeat for multiple. Defaults: lib/**, test/**, script/**, **/*.t.sol, **/*.s.sol",
    (v: string, prev: string[] = []) => prev.concat(v),
    [] as string[],
  )
  .option(
    "--no-default-ignore",
    "Disable the built-in lib/test/script ignore list and scan everything in out/",
  )
  .option(
    "--facets <glob>",
    "Restrict facet-shared-storage analyzers (inheritance-overlap, appstorage-fingerprint) to source paths matching this glob. Repeat for multiple.",
    (v: string, prev: string[] = []) => prev.concat(v),
    [] as string[],
  )
  .option(
    "--allow-missing-ast",
    "Downgrade the hard failure when no artifact has an AST (storage-layout-only scan) to a warning and continue",
  )
  .action(async (target: string | undefined, opts: CliOptions) => {
    try {
      if (!target && !opts.onchain) {
        throw new Error("provide a path, or use --onchain <address> for history mode");
      }
      await run(target, opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(pc.red(`diamond-detect: ${msg}\n`));
      process.exit(2);
    }
  });

program.parseAsync(process.argv);
