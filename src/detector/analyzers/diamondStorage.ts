import { keccak_256 } from "@noble/hashes/sha3";
import type { Analyzer, AnalyzerContext, FacetArtifact, Finding, SourceLocation } from "../types.js";

interface AstNode {
  nodeType?: string;
  [key: string]: unknown;
}

interface SlotConstant {
  declarationId: number;
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
      const declarationId = typeof node.id === "number" ? node.id : -1;
      const variableName = (node.name as string) ?? "<anon>";
      const contract = declaringContract(parents) ?? artifact.contractName;
      const src = node.src as string | undefined;
      const dedupeKey = `${artifact.sourcePath}::${contract}::${variableName}::${src ?? ""}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      out.push({
        declarationId,
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

interface ExternalReference {
  declaration?: number;
  isSlot?: boolean;
  isOffset?: boolean;
  suffix?: string;
  src?: string;
}

/**
 * Walk a Yul block. For every `YulAssignment` whose target is `<x>.slot`, collect
 * the `src` of the value-side YulIdentifier — that's what we'll match back against
 * the InlineAssembly's externalReferences to find the Solidity declaration.
 */
function collectSlotAssignmentValueSrcs(yulNode: unknown, srcs: Set<string>): void {
  if (!yulNode || typeof yulNode !== "object") return;
  const node = yulNode as AstNode;
  if (node.nodeType === "YulAssignment") {
    const targets = node.variableNames as AstNode[] | undefined;
    const targetsSlot =
      Array.isArray(targets) &&
      targets.some((t) => typeof t.name === "string" && t.name.endsWith(".slot"));
    if (targetsSlot) {
      const value = node.value as AstNode | undefined;
      if (value?.nodeType === "YulIdentifier" && typeof value.src === "string") {
        srcs.add(value.src);
      }
    }
  }
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (Array.isArray(v)) {
      for (const child of v) collectSlotAssignmentValueSrcs(child, srcs);
    } else if (v && typeof v === "object") {
      collectSlotAssignmentValueSrcs(v, srcs);
    }
  }
}

/**
 * Collect Solidity AST declaration ids that flow into a `.slot` assignment in any
 * inline-assembly block. The matching is: Yul `<x>.slot := V` → V's src → the
 * InlineAssembly's externalReferences entry with the same src → declaration id.
 */
function collectSlotUsedDeclarationIds(artifacts: FacetArtifact[]): Set<number> {
  const ids = new Set<number>();
  for (const artifact of artifacts) {
    if (!artifact.ast) continue;
    walkAst(artifact.ast, (node) => {
      if (node.nodeType !== "InlineAssembly") return;
      const yulAst = node.AST;
      if (!yulAst) return;
      const slotValueSrcs = new Set<string>();
      collectSlotAssignmentValueSrcs(yulAst, slotValueSrcs);
      if (slotValueSrcs.size === 0) return;
      const refs = node.externalReferences as ExternalReference[] | undefined;
      if (!Array.isArray(refs)) return;
      for (const ref of refs) {
        if (
          typeof ref.src === "string" &&
          slotValueSrcs.has(ref.src) &&
          typeof ref.declaration === "number"
        ) {
          ids.add(ref.declaration);
        }
      }
    });
  }
  return ids;
}

/**
 * Collect one-hop aliases. For:
 *   bytes32 slot = POSITION;
 *   assembly { l.slot := slot }
 * solc's externalReferences will say `slot` is used as `.slot`, where `slot` is the
 * local's id, not the constant's id. We need to map the local back to the constant.
 *
 * Returns map: alias declaration id -> referenced declaration id.
 */
function collectAliases(artifacts: FacetArtifact[]): Map<number, number> {
  const aliases = new Map<number, number>();
  for (const artifact of artifacts) {
    if (!artifact.ast) continue;
    walkAst(artifact.ast, (node) => {
      if (node.nodeType !== "VariableDeclarationStatement") return;
      const initialValue = node.initialValue as AstNode | undefined;
      if (initialValue?.nodeType !== "Identifier") return;
      const referenced = initialValue.referencedDeclaration as number | undefined;
      if (typeof referenced !== "number") return;
      const decls = node.declarations as AstNode[] | undefined;
      if (!Array.isArray(decls)) return;
      for (const d of decls) {
        if (typeof d?.id === "number") aliases.set(d.id, referenced);
      }
    });
  }
  return aliases;
}

function isUsedAsSlot(
  constantId: number,
  slotUsedIds: Set<number>,
  aliases: Map<number, number>,
): boolean {
  if (constantId < 0) return false;
  if (slotUsedIds.has(constantId)) return true;
  for (const [aliasId, refId] of aliases) {
    if (refId === constantId && slotUsedIds.has(aliasId)) return true;
  }
  return false;
}

export const diamondStorageAnalyzer: Analyzer = {
  name: "diamond-storage-namespace",
  run(ctx) {
    const constants = collectSlotConstants(ctx);
    const slotUsedIds = collectSlotUsedDeclarationIds(ctx.artifacts);
    const aliases = collectAliases(ctx.artifacts);

    // Only flag constants we can confirm are used as Diamond Storage slot pointers.
    // Module ids, role ids, event topics, etc. share the syntactic shape but aren't
    // collisions even when two contracts agree on the same string.
    const slotConstants = constants.filter((c) =>
      isUsedAsSlot(c.declarationId, slotUsedIds, aliases),
    );

    const bySlot = new Map<string, SlotConstant[]>();
    for (const c of slotConstants) {
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
