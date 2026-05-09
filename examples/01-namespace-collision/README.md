# 01 — Diamond Storage namespace collision

Two facet-supporting libraries copy-paste the same string into their `keccak256(...)` slot constant. Both libraries' `Layout` structs land at the same storage slot in the Diamond proxy. Writes to one library silently corrupt the other's data — no revert, no error.

## Reproduce the bug

```sh
cd before
forge build
diamond-detect .
```

Expected output:

```
🔴 ERROR diamond-storage-namespace  0x99c36ecfaabf6a966b794701a986dcc2d9e35685c5442339f000114af125cb31
  Diamond Storage namespace "blok.strategies" is declared in 2 different sources, all resolving to the same slot.
  facets: LibStrategies, LibVaults
```

## See the fix

```sh
cd ../after
forge build
diamond-detect .
```

Expected output:

```
✓ no storage collisions detected
```

## What changed

`after/src/LibVaults.sol` declares its namespace as `"blok.vaults"` instead of `"blok.strategies"`. The keccak hashes are now distinct, so each library occupies its own slot.

```diff
-    bytes32 internal constant POSITION = keccak256("blok.strategies");
+    bytes32 internal constant POSITION = keccak256("blok.vaults");
```
