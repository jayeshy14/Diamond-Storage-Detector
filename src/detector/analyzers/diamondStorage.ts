import { keccak_256 } from "@noble/hashes/sha3";
import type { Analyzer, AnalyzerContext, Finding, SourceLocation } from "../types.js";

interface AstNode {
  nodeType?: string;
  [key: string]: unknown;
}

interface SlotConstant {
  variableName: string;
  namespace: string;
  slot: string;
  contract: string;
  sourcePath: string;
  src?: string;
}

function keccak256Hex(input: string): string {
  const bytes = keccak_256(new TextEncoder().encode(input));
  let out = "0x";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function isBytes32Constant(node: AstNode): boolean {
  if (node.nodeType !== "VariableDeclaration") return false;
  if (node.constant !== true) return false;
  const typeName = node.typeName as AstNode | undefined;
  return typeName?.nodeType === "ElementaryTypeName" && typeName.name === "bytes32";
}

function extractKeccakStringArg(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as AstNode;
  if (v.nodeType !== "FunctionCall") return null;
  const expr = v.expression as AstNode | undefined;
  if (expr?.nodeType !== "Identifier" || expr.name !== "keccak256") return null;
  const args = v.arguments as unknown;
  if (!Array.isArray(args) || args.length !== 1) return null;
  const arg = args[0] as AstNode;
  if (arg.nodeType !== "Literal" || arg.kind !== "string") return null;
  return typeof arg.value === "string" ? arg.value : null;
}

function lineFromSrc(src: unknown, sourceText?: string): number | undefined {
  if (typeof src !== "string" || !sourceText) return undefined;
  const [startStr] = src.split(":");
  const start = Number(startStr);
  if (!Number.isFinite(start)) return undefined;
  let line = 1;
  for (let i = 0; i < start && i < sourceText.length; i++) {
    if (sourceText.charCodeAt(i) === 10) line++;
  }
  return line;
}

function walkAst(
  ast: unknown,
  visit: (node: AstNode, parents: AstNode[]) => void,
  parents: AstNode[] = [],
): void {
  if (!ast || typeof ast !== "object") return;
  const node = ast as AstNode;
  if (typeof node.nodeType === "string") visit(node, parents);
  const nextParents = typeof node.nodeType === "string" ? [...parents, node] : parents;
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) walkAst(child, visit, nextParents);
    } else if (value && typeof value === "object") {
      walkAst(value, visit, nextParents);
    }
  }
}

function declaringContract(parents: AstNode[]): string | null {
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i]!;
    if (p.nodeType === "ContractDefinition") return (p.name as string) ?? null;
  }
  return null;
}

export function collectSlotConstants(ctx: AnalyzerContext): SlotConstant[] {
  const seen = new Set<string>();
  const out: SlotConstant[] = [];

  for (const artifact of ctx.artifacts) {
    if (!artifact.ast) continue;
    walkAst(artifact.ast, (node, parents) => {
      if (!isBytes32Constant(node)) return;
      const namespace = extractKeccakStringArg(node.value);
      if (namespace === null) return;
      const variableName = (node.name as string) ?? "<anon>";
      const contract = declaringContract(parents) ?? artifact.contractName;
      const src = node.src as string | undefined;
      const dedupeKey = `${artifact.sourcePath}::${contract}::${variableName}::${src ?? ""}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      out.push({
        variableName,
        namespace,
        slot: keccak256Hex(namespace),
        contract,
        sourcePath: artifact.sourcePath,
        src,
      });
    });
  }
  return out;
}

export const diamondStorageAnalyzer: Analyzer = {
  name: "diamond-storage-namespace",
  run(ctx) {
    const constants = collectSlotConstants(ctx);
    const bySlot = new Map<string, SlotConstant[]>();
    for (const c of constants) {
      const list = bySlot.get(c.slot) ?? [];
      list.push(c);
      bySlot.set(c.slot, list);
    }

    const findings: Finding[] = [];
    for (const [slot, group] of bySlot) {
      const distinctSources = new Set(group.map((g) => g.sourcePath));
      if (distinctSources.size < 2) continue;
      const namespaces = Array.from(new Set(group.map((g) => g.namespace)));
      const facets = Array.from(new Set(group.map((g) => g.contract)));
      const locations: SourceLocation[] = group.map((g) => {
        const sourceText = ctx.rawSources.get(g.sourcePath);
        return { file: g.sourcePath, line: lineFromSrc(g.src, sourceText) };
      });
      findings.push({
        kind: "diamond-storage-namespace",
        severity: "error",
        slot,
        message:
          namespaces.length === 1
            ? `Diamond Storage namespace "${namespaces[0]}" is declared in ${distinctSources.size} different sources, all resolving to the same slot.`
            : `Distinct namespaces ${namespaces.map((n) => `"${n}"`).join(", ")} hash to the same slot.`,
        facets,
        locations,
        detail: { namespaces, declarations: group },
      });
    }
    return findings;
  },
};
