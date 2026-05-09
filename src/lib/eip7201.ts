import { keccak_256 } from "@noble/hashes/sha3";

const MASK_LAST_BYTE = (() => {
  const m = new Uint8Array(32).fill(0xff);
  m[31] = 0x00;
  return m;
})();

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function toHex(bytes: Uint8Array): string {
  let out = "0x";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function subOne(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes);
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i]! > 0) {
      out[i] = out[i]! - 1;
      return out;
    }
    out[i] = 0xff;
  }
  return out;
}

function maskLastByte(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = bytes[i]! & MASK_LAST_BYTE[i]!;
  return out;
}

/**
 * Compute the EIP-7201 storage location for a namespace id.
 *
 * location = keccak256(abi.encode(uint256(keccak256(id)) - 1)) & ~bytes32(uint256(0xff))
 */
export function erc7201Slot(namespaceId: string): string {
  const inner = keccak_256(utf8(namespaceId));
  const decremented = subOne(inner);
  const outer = keccak_256(decremented);
  return toHex(maskLastByte(outer));
}

const ERC7201_PREFIX = "erc7201:";

export function parseErc7201Annotation(text: string): string | null {
  const idx = text.indexOf(ERC7201_PREFIX);
  if (idx === -1) return null;
  const rest = text.slice(idx + ERC7201_PREFIX.length);
  const match = rest.match(/^[A-Za-z0-9_.\-]+/);
  return match ? match[0] : null;
}
