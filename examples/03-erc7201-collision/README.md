# 03 — EIP-7201 namespace collision

Two contracts each declare a struct with `@custom:storage-location erc7201:myapp.storage.access`. EIP-7201 hashes the namespace id deterministically, so both structs land at the same slot. Calls into `Permissions` will trample `AccessControl`'s role mapping.

## Reproduce the bug

```sh
cd before
forge build
diamond-detect .
```

Expected output:

```
🔴 ERROR erc7201-namespace  0xc53df2842eaee72f7d90d67a05da4516856cf2adcbeee77b14f6b19e7075d600
  EIP-7201 namespace "myapp.storage.access" is declared in 2 different sources, all resolving to the same slot.
  facets: AccessControl, Permissions
```

## See the fix

```sh
cd ../after
forge build
diamond-detect .
```

Expected output: `✓ no storage collisions detected`.

## What changed

`after/src/Permissions.sol` uses a distinct namespace id, so the two contracts hash to different slots.

```diff
- /// @custom:storage-location erc7201:myapp.storage.access
+ /// @custom:storage-location erc7201:myapp.storage.permissions
```
