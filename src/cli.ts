import { Command } from "commander";
import pc from "picocolors";
import { detect } from "./detector/index.js";
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
}

async function run(target: string, opts: CliOptions): Promise<void> {
  const result = await detect(
    {
      path: target,
      ignoreGlobs: opts.ignore,
      noDefaultIgnore: opts.noDefaultIgnore,
      facetGlobs: opts.facets.length > 0 ? opts.facets : undefined,
    },
    defaultAnalyzers,
  );

  const withAst = result.artifacts.filter((a) => a.ast).length;
  if (result.artifacts.length > 0 && withAst === 0 && !opts.json) {
    process.stderr.write(
      pc.yellow(
        "warning: no AST found in any artifact. Set `ast = true` in foundry.toml (or pass `--ast` to forge) and rebuild — AST-based analyzers depend on it.\n",
      ),
    );
  }

  const output = opts.json
    ? renderJson(result.findings, result.artifacts.length)
    : opts.markdown
      ? renderMarkdown(result.findings, result.artifacts.length)
      : renderTerminal(result.findings, result.artifacts.length);

  process.stdout.write(output + "\n");

  const threshold = SEVERITY_RANK[opts.severity];
  const hit = result.findings.some((f) => SEVERITY_RANK[f.severity] >= threshold);
  process.exit(hit ? 1 : 0);
}

const program = new Command();

program
  .name("diamond-detect")
  .description("Static analyzer for EIP-2535 Diamond storage-slot collisions")
  .argument("<path>", "Foundry project root or src/ folder")
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
  .action(async (target: string, opts: CliOptions) => {
    try {
      await run(target, opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(pc.red(`diamond-detect: ${msg}\n`));
      process.exit(2);
    }
  });

program.parseAsync(process.argv);
