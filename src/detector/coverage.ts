import type { FacetArtifact } from "./types.js";

export type AstCoverage = "full" | "partial" | "none" | "empty";

/**
 * Classify how much of the loaded artifact set carries an AST. The three AST-based
 * analyzers (diamond-storage-namespace, erc7201-namespace, inline-assembly-slot)
 * silently produce nothing without it, so a scan over artifacts that all lack AST is
 * a storage-layout-only scan masquerading as a full one — the dangerous case for a
 * CI gate, which would pass green having effectively checked almost nothing.
 */
export function assessAstCoverage(artifacts: Pick<FacetArtifact, "ast">[]): AstCoverage {
  if (artifacts.length === 0) return "empty";
  const withAst = artifacts.filter((a) => a.ast).length;
  if (withAst === 0) return "none";
  if (withAst < artifacts.length) return "partial";
  return "full";
}

export interface CoverageDecision {
  level: "error" | "warn" | "ok";
  message?: string;
  /** When set, the CLI must exit with this code instead of the findings-based one. */
  exitCode?: number;
}

/**
 * Decide what the CLI should do about AST coverage. Pure so the fail-closed policy is
 * unit-testable without spawning a process or mocking process.exit:
 *
 *  - none    → hard error, exit 2 (fail closed), unless --allow-missing-ast downgrades
 *              it to a warning. This is the fix for a CI that would otherwise pass green
 *              on a build missing `ast = true`.
 *  - partial → warning only; some artifacts were genuinely excluded from the build and
 *              the rest were still analyzed in full.
 *  - full / empty → no coverage message.
 */
export function decideCoverageAction(
  artifacts: Pick<FacetArtifact, "ast">[],
  opts: { allowMissingAst?: boolean } = {},
): CoverageDecision {
  const total = artifacts.length;
  const withAst = artifacts.filter((a) => a.ast).length;
  const coverage = assessAstCoverage(artifacts);

  if (coverage === "none") {
    const detail =
      `no AST found in any of ${total} artifact(s). The namespace, EIP-7201, and ` +
      "inline-assembly analyzers depend on it, so this scan would only check storage-layout " +
      "drift. Set `ast = true` in foundry.toml (or pass `--ast` to forge) and rebuild.";
    if (opts.allowMissingAst) {
      return { level: "warn", message: `warning: ${detail}` };
    }
    return {
      level: "error",
      exitCode: 2,
      message:
        `error: ${detail}\n` +
        "Failing closed so CI does not pass green on a partial scan. Pass " +
        "--allow-missing-ast to downgrade this to a warning and continue.",
    };
  }

  if (coverage === "partial") {
    return {
      level: "warn",
      message:
        `warning: ${total - withAst} of ${total} artifact(s) lack AST and were checked for ` +
        "storage-layout drift only. Run `forge clean && forge build` with `ast = true` for full coverage.",
    };
  }

  return { level: "ok" };
}
