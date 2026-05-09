import { Command } from "commander";
import pc from "picocolors";
import { detect } from "./detector/index.js";
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
}

async function run(target: string, opts: CliOptions): Promise<void> {
  const result = await detect(
    { path: target, ignoreGlobs: opts.ignore },
    [], // analyzers wired in subsequent days
  );

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
    "--ignore <glob...>",
    "Skip files matching these globs (relative to project root)",
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
