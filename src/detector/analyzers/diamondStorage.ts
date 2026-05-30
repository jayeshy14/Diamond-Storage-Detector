import { keccak_256 } from "@noble/hashes/sha3";
import type { Analyzer, AnalyzerContext, FacetArtifact, Finding, SourceLocation } from "../types.js";
import { erc7201Slot } from "../../lib/eip7201.js";

interface AstNode {
  nodeType?: string;
  [key: string]: unknown;
}

interface SlotConstant {
  declarationId: number;
  variableName: string;
  // The keccak256 string namespace, or null when the slot is a hardcoded
  // precomputed literal (e.g. `bytes32 constant S = 0x3400...00`). Literal slots
  // are the gas-optimized ERC-7201 idiom: the seed is computed offline and pasted
  // as a constant, so there is no string to recover from the AST.
  namespace: string | null;
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

/**
 * Read a `bytes32 constant = <number literal>` value as a normalized 32-byte slot.
 * Handles the precomputed-literal ERC-7201 pattern (`0x3400...00`) and decimal
 * literals (`bytes32 constant S = 0`). Returns null for anything that is not a
 * plain number literal, including `keccak256("...")` (handled separately) and
 * `hex"..."` byte-string literals, which are not used as storage-slot pointers.
 */
function extractBytes32HexLiteral(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as AstNode;
  if (v.nodeType !== "Literal" || v.kind !== "number") return null;
  if (typeof v.value !== "string") return null;
  try {
    const big = BigInt(v.value);
    if (big < 0n) return null;
    return "0x" + big.toString(16).padStart(64, "0");
  } catch {
    return null;
  }
}

/**
 * Recognize the canonical EIP-7201 slot expression written inline in a constant
 * initializer, e.g.:
 *   keccak256(abi.encode(uint256(keccak256("ns")) - 1)) & ~bytes32(uint256(0xff))
 * Returns the namespace string if the value subtree contains exactly one
 * keccak256(<string literal>), a subtraction by 1, and a bitwise-and mask — the
 * three structural markers of the formula. This is deliberately structural rather
 * than an exact tree match so reformatting/parenthesization variants still match,
 * while a wrong formula (missing the -1 or the mask) does not.
 */
function findKeccakStringArg(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const v = node as AstNode;
  if (v.nodeType !== "FunctionCall") return null;
  const expr = v.expression as AstNode | undefined;
  if (expr?.nodeType !== "Identifier" || expr.name !== "keccak256") return null;
  const args = v.arguments as unknown;
  if (!Array.isArray(args) || args.length !== 1) return null;
  const arg = args[0] as AstNode;
  if (arg.nodeType !== "Literal" || arg.kind !== "string") return null;
  return typeof arg.value === "string" ? arg.value : null;
}

function someNode(node: unknown, pred: (n: AstNode) => boolean): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as AstNode;
  if (typeof n.nodeType === "string" && pred(n)) return true;
  for (const key of Object.keys(n)) {
    const value = n[key];
    if (Array.isArray(value)) {
      if (value.some((c) => someNode(c, pred))) return true;
    } else if (value && typeof value === "object") {
      if (someNode(value, pred)) return true;
    }
  }
  return false;
}

function extractErc7201FormulaNamespace(value: unknown): string | null {
  const strings: string[] = [];
  someNode(value, (n) => {
    const s = findKeccakStringArg(n);
    if (s !== null) strings.push(s);
    return false;
  });
  if (strings.length !== 1) return null;
  const hasSubOne = someNode(
    value,
    (n) =>
      n.nodeType === "BinaryOperation" &&
      n.operator === "-" &&
      (n.rightExpression as AstNode | undefined)?.nodeType === "Literal" &&
      (n.rightExpression as AstNode).value === "1",
  );
  const hasMask = someNode(value, (n) => n.nodeType === "BinaryOperation" && n.operator === "&");
  if (!hasSubOne || !hasMask) return null;
  return strings[0]!;
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

/**
 * Collect `bytes32 constant = <precomputed literal>` declarations. These are the
 * gas-optimized ERC-7201 / hardcoded-slot pattern: the namespace hash is computed
 * offline and pasted as a literal, with no `keccak256("...")` in source and often
 * no `@custom:storage-location` annotation, so neither collectSlotConstants nor
 * the erc7201 analyzer sees them. Without this, two facets that share an identical
 * precomputed slot are a silent, undetected collision. The analyzer gates these on
 * isUsedAsSlot just like keccak constants, so role ids / event topics that happen
 * to be bytes32 literals do not produce false positives.
 */
export function collectLiteralSlotConstants(ctx: AnalyzerContext): SlotConstant[] {
  const seen = new Set<string>();
  const out: SlotConstant[] = [];

  for (const artifact of ctx.artifacts) {
    if (!artifact.ast) continue;
    walkAst(artifact.ast, (node, parents) => {
      if (!isBytes32Constant(node)) return;
      // keccak256("...") namespaces are handled by collectSlotConstants.
      if (extractKeccakStringArg(node.value) !== null) return;
      const slot = extractBytes32HexLiteral(node.value);
      if (slot === null) return;
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
        namespace: null,
        slot,
        contract,
        sourcePath: artifact.sourcePath,
        src,
      });
    });
  }
  return out;
}

/**
 * Collect `bytes32 constant = keccak256(abi.encode(uint256(keccak256("ns")) - 1)) & ~bytes32(uint256(0xff))`
 * declarations: the ERC-7201 slot formula written inline in the constant, with no
 * `@custom:storage-location` annotation (so the erc7201 analyzer never sees it) and
 * no bare literal (so collectLiteralSlotConstants never sees it). The slot is the
 * ERC-7201 location of the recovered namespace, so these enter the same comparison
 * space as literals and keccak constants and cross-detect against them.
 */
export function collectFormulaSlotConstants(ctx: AnalyzerContext): SlotConstant[] {
  const seen = new Set<string>();
  const out: SlotConstant[] = [];

  for (const artifact of ctx.artifacts) {
    if (!artifact.ast) continue;
    walkAst(artifact.ast, (node, parents) => {
      if (!isBytes32Constant(node)) return;
      // Plain keccak256("ns") and bare literals are handled by the other collectors.
      if (extractKeccakStringArg(node.value) !== null) return;
      const namespace = extractErc7201FormulaNamespace(node.value);
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
        slot: erc7201Slot(namespace),
        contract,
        sourcePath: artifact.sourcePath,
        src,
      });
    });
  }
  return out;
}

/**
 * Collect direct `assembly { x.slot := <number literal> }` assignments — a hardcoded
 * slot written straight into assembly without going through a named constant. These
 * are inherent slot uses (no isUsedAsSlot gate needed) and feed the same comparison
 * space, so two facets pinning the same literal slot in assembly are caught.
 */
export function collectAssemblyLiteralSlots(artifacts: FacetArtifact[]): SlotConstant[] {
  const seen = new Set<string>();
  const out: SlotConstant[] = [];
  for (const artifact of artifacts) {
    if (!artifact.ast) continue;
    walkAst(artifact.ast, (node, parents) => {
      if (node.nodeType !== "YulAssignment") return;
      const targets = node.variableNames as AstNode[] | undefined;
      const targetsSlot =
        Array.isArray(targets) &&
        targets.some((t) => typeof t.name === "string" && t.name.endsWith(".slot"));
      if (!targetsSlot) return;
      const value = node.value as AstNode | undefined;
      if (value?.nodeType !== "YulLiteral" || value.kind !== "number") return;
      if (typeof value.value !== "string") return;
      let slot: string;
      try {
        const big = BigInt(value.value);
        if (big < 0n) return;
        slot = "0x" + big.toString(16).padStart(64, "0");
      } catch {
        return;
      }
      const contract = declaringContract(parents) ?? artifact.contractName;
      const src = node.src as string | undefined;
      // The same library AST is emitted into every consumer artifact; dedupe by the
      // source location so a single assignment is not counted once per artifact.
      const dedupeKey = `${artifact.sourcePath}::${contract}::${slot}::${src ?? ""}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      out.push({
        declarationId: -1,
        variableName: "<assembly literal>",
        namespace: null,
        slot,
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

/**
 * Every bytes32 slot pointer we can prove is used as Diamond Storage: keccak256
 * namespace constants, precomputed literals, inline ERC-7201 formulas, and direct
 * `assembly { x.slot := <literal> }` writes. Constant-backed entries are gated on
 * proof-of-use so role ids / event topics are excluded; assembly writes are the use
 * themselves. This is the single source of truth for both collision detection and
 * the storage-region inventory.
 */
export function collectGatedSlotConstants(ctx: AnalyzerContext): SlotConstant[] {
  const constants = [
    ...collectSlotConstants(ctx),
    ...collectLiteralSlotConstants(ctx),
    ...collectFormulaSlotConstants(ctx),
  ];
  const slotUsedIds = collectSlotUsedDeclarationIds(ctx.artifacts);
  const aliases = collectAliases(ctx.artifacts);
  return [
    ...constants.filter((c) => isUsedAsSlot(c.declarationId, slotUsedIds, aliases)),
    ...collectAssemblyLiteralSlots(ctx.artifacts),
  ];
}

export const diamondStorageAnalyzer: Analyzer = {
  name: "diamond-storage-namespace",
  run(ctx) {
    const slotConstants = collectGatedSlotConstants(ctx);

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
      const namespaces = Array.from(
        new Set(group.map((g) => g.namespace).filter((n): n is string => n !== null)),
      );
      const variableNames = Array.from(new Set(group.map((g) => g.variableName)));
      const hasLiteral = group.some((g) => g.namespace === null);
      const facets = Array.from(new Set(group.map((g) => g.contract)));
      const locations: SourceLocation[] = group.map((g) => {
        const sourceText = ctx.rawSources.get(g.sourcePath);
        return { file: g.sourcePath, line: lineFromSrc(g.src, sourceText), src: g.src };
      });

      let message: string;
      if (!hasLiteral) {
        // Pure keccak256-namespace collision: original behavior, unchanged.
        message =
          namespaces.length === 1
            ? `Diamond Storage namespace "${namespaces[0]}" is declared in ${distinctSources.size} different sources, all resolving to the same slot.`
            : `Distinct namespaces ${namespaces.map((n) => `"${n}"`).join(", ")} hash to the same slot.`;
      } else if (namespaces.length === 0) {
        // Every member is a hardcoded precomputed literal slot.
        message = `Hardcoded storage slot ${slot} is used as a Diamond Storage pointer by ${distinctSources.size} different sources (${variableNames.join(", ")}), so distinct facets share the same slot.`;
      } else {
        // Mixed: a hardcoded literal that equals one or more keccak256 namespaces.
        message = `Hardcoded slot ${slot} collides with namespace(s) ${namespaces
          .map((n) => `"${n}"`)
          .join(", ")} — they resolve to the same storage slot.`;
      }

      findings.push({
        kind: "diamond-storage-namespace",
        severity: "error",
        slot,
        message,
        facets,
        locations,
        detail: { namespaces, variableNames, declarations: group },
      });
    }
    return findings;
  },
};
