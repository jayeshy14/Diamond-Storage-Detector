import { describe, expect, it } from "vitest";
import { erc7201Slot, parseErc7201Annotation } from "../src/lib/eip7201.js";

// Vectors from EIP-7201 itself (https://eips.ethereum.org/EIPS/eip-7201)
// and OpenZeppelin's published namespaced storage slots.
const VECTORS: ReadonlyArray<{ id: string; slot: string }> = [
  // Canonical example from the EIP text:
  //   id: "example.main"
  //   location: 0x183a6125c38840424c4a85fa12bab2ab606c4b6d0e7cc73c0c06ba5300eab500
  {
    id: "example.main",
    slot: "0x183a6125c38840424c4a85fa12bab2ab606c4b6d0e7cc73c0c06ba5300eab500",
  },
  // OpenZeppelin Contracts v5 — AccessControl
  {
    id: "openzeppelin.storage.AccessControl",
    slot: "0x02dd7bc7dec4dceedda775e58dd541e08a116c6c53815c0bd028192f7b626800",
  },
  // OpenZeppelin Contracts v5 — Ownable
  {
    id: "openzeppelin.storage.Ownable",
    slot: "0x9016d09d72d40fdae2fd8ceac6b6234c7706214fd39c1cd1e609a0528c199300",
  },
];

describe("erc7201Slot", () => {
  for (const { id, slot } of VECTORS) {
    it(`matches the published vector for ${id}`, () => {
      expect(erc7201Slot(id)).toBe(slot);
    });
  }

  it("masks the trailing byte (location & ~0xff)", () => {
    for (const { id } of VECTORS) {
      const out = erc7201Slot(id);
      expect(out.endsWith("00")).toBe(true);
      expect(out).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it("produces distinct slots for distinct ids", () => {
    const a = erc7201Slot("a.b.c");
    const b = erc7201Slot("a.b.d");
    expect(a).not.toBe(b);
  });
});

describe("parseErc7201Annotation", () => {
  it("extracts the namespace id from a NatSpec line", () => {
    expect(parseErc7201Annotation("@custom:storage-location erc7201:foo.bar.baz")).toBe(
      "foo.bar.baz",
    );
  });

  it("returns null when no annotation is present", () => {
    expect(parseErc7201Annotation("// just a comment")).toBeNull();
  });

  it("supports dashes, underscores, dots, and digits in ids", () => {
    expect(
      parseErc7201Annotation(" * @custom:storage-location erc7201:my-app_v2.module.42 "),
    ).toBe("my-app_v2.module.42");
  });
});
