# 04 — Clean baseline

A small project that exercises every analyzer but produces no findings. Use this as a sanity check that `diamond-detect` is wired up correctly on your machine.

The project contains:

- Two Diamond Storage libraries with distinct namespace strings (`clean.example.strategies`, `clean.example.vaults`).
- One contract with an EIP-7201 namespace (`clean.example.owned`) used nowhere else.
- No inline assembly slot writes, no AppStorage drift, no inheritance overlap.

## Run it

```sh
forge build
diamond-detect .
```

Expected output:

```
scanned 3 contract artifact(s)
✓ no storage collisions detected
```

Exit code: `0`.
