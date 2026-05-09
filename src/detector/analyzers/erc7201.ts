import type { Analyzer, Finding, SourceLocation } from "../types.js";
import { erc7201Slot, parseErc7201Annotation } from "../../lib/eip7201.js";

interface AstNode {
  nodeType?: string;
  [key: string]: unknown;
}

interface Annotation {
  namespaceId: string;
  slot: string;
  attachedTo: string;
  contract: string;
  sourcePath: string;
  src?: string;
}

const NAMED_NODE_TYPES = new Set([
  "ContractDefinition",
  "StructDefinition",
  "FunctionDefinition",
  "VariableDeclaration",
  "ErrorDefinition",
  "EventDefinition",
  "ModifierDefinition",
  "EnumDefinition",
]);

function getDocText(node: AstNode): string | null {
  const doc = node.documentation;
  if (!doc) return null;
  if (typeof doc === "string") return doc;
  if (typeof doc === "object" && doc !== null) {
    const text = (doc as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return null;
}

function nearestContract(parents: AstNode[]): string | null {
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i]!;
    if (p.nodeType === "ContractDefinition") return (p.name as string) ?? null;
  }
  return null;
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

export function collectErc7201Annotations(
  artifacts: { ast: unknown; sourcePath: string; contractName: string }[],
): Annotation[] {
  const seen = new Set<string>();
  const out: Annotation[] = [];
  for (const artifact of artifacts) {
    if (!artifact.ast) continue;
    walkAst(artifact.ast, (node, parents) => {
      if (!node.nodeType || !NAMED_NODE_TYPES.has(node.nodeType)) return;
      const text = getDocText(node);
      if (!text || !text.includes("erc7201:")) return;
      const namespaceId = parseErc7201Annotation(text);
      if (!namespaceId) return;
      const attachedTo = `${node.nodeType}:${(node.name as string) ?? "<anon>"}`;
      const contract =
        node.nodeType === "ContractDefinition"
          ? ((node.name as string) ?? artifact.contractName)
          : (nearestContract(parents) ?? artifact.contractName);
      const src = node.src as string | undefined;
      const dedupeKey = `${artifact.sourcePath}::${attachedTo}::${src ?? ""}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      out.push({
        namespaceId,
        slot: erc7201Slot(namespaceId),
        attachedTo,
        contract,
        sourcePath: artifact.sourcePath,
        src,
      });
    });
  }
  return out;
}

export const erc7201Analyzer: Analyzer = {
  name: "erc7201-namespace",
  run(ctx) {
    const annotations = collectErc7201Annotations(ctx.artifacts);
    const bySlot = new Map<string, Annotation[]>();
    for (const a of annotations) {
      const list = bySlot.get(a.slot) ?? [];
      list.push(a);
      bySlot.set(a.slot, list);
    }

    const findings: Finding[] = [];
    for (const [slot, group] of bySlot) {
      const distinctSources = new Set(group.map((g) => g.sourcePath));
      if (distinctSources.size < 2) continue;
      const ids = Array.from(new Set(group.map((g) => g.namespaceId)));
      const facets = Array.from(new Set(group.map((g) => g.contract)));
      const locations: SourceLocation[] = group.map((g) => ({ file: g.sourcePath }));
      findings.push({
        kind: "erc7201-namespace",
        severity: "error",
        slot,
        message:
          ids.length === 1
            ? `EIP-7201 namespace "${ids[0]}" is declared in ${distinctSources.size} different sources, all resolving to the same slot.`
            : `Distinct EIP-7201 namespaces ${ids.map((n) => `"${n}"`).join(", ")} hash to the same slot.`,
        facets,
        locations,
        detail: { namespaceIds: ids, annotations: group },
      });
    }
    return findings;
  },
};
