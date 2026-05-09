import type { Analyzer, FacetArtifact, Finding } from "../types.js";

interface AstNode {
  nodeType?: string;
  [key: string]: unknown;
}

interface SstoreLiteral {
  slot: string;
  rawValue: string;
  artifact: FacetArtifact;
  src?: string;
}

function walkAst(ast: unknown, visit: (node: AstNode) => void): void {
  if (!ast || typeof ast !== "object") return;
  const node = ast as AstNode;
  if (typeof node.nodeType === "string") visit(node);
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) walkAst(child, visit);
    } else if (value && typeof value === "object") {
      walkAst(value, visit);
    }
  }
}

function normalizeSlot(value: string): string {
  const trimmed = value.trim();
  let big: bigint;
  try {
    if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
      big = BigInt(trimmed);
    } else {
      big = BigInt(trimmed);
    }
  } catch {
    return trimmed;
  }
  return "0x" + big.toString(16).padStart(64, "0");
}

export function collectSstoreLiterals(artifacts: FacetArtifact[]): SstoreLiteral[] {
  const out: SstoreLiteral[] = [];
  for (const artifact of artifacts) {
    if (!artifact.ast) continue;
    walkAst(artifact.ast, (node) => {
      if (node.nodeType !== "YulFunctionCall") return;
      const fnName = (node.functionName as AstNode | undefined)?.name;
      if (fnName !== "sstore") return;
      const args = node.arguments as unknown;
      if (!Array.isArray(args) || args.length < 2) return;
      const arg0 = args[0] as AstNode;
      if (arg0?.nodeType !== "YulLiteral" || arg0.kind !== "number") return;
      const rawValue = String(arg0.value ?? "");
      out.push({
        slot: normalizeSlot(rawValue),
        rawValue,
        artifact,
        src: node.src as string | undefined,
      });
    });
  }
  return out;
}

export const inlineAssemblyAnalyzer: Analyzer = {
  name: "inline-assembly-slot",
  run(ctx) {
    const literals = collectSstoreLiterals(ctx.artifacts);
    return literals.map<Finding>((lit) => ({
      kind: "inline-assembly-slot",
      severity: "info",
      slot: lit.slot,
      message: `inline assembly writes to a hardcoded slot (sstore(${lit.rawValue}, …)) — confirm no overlap with computed storage slots.`,
      facets: [lit.artifact.contractName],
      locations: [{ file: lit.artifact.sourcePath }],
      detail: { rawValue: lit.rawValue, src: lit.src },
    }));
  },
};
