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
🔴 ERROR diamond-storage-namespace  0x84d86c34a05b71953e57fe7dafea685384b33934d9ddaebd0cf7709e74b71bab
  Diamond Storage namespace "myapp.strategies" is declared in 2 different sources, all resolving to the same slot.
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

`after/src/LibVaults.sol` declares its namespace as `"myapp.vaults"` instead of `"myapp.strategies"`. The keccak hashes are now distinct, so each library occupies its own slot.

```diff
-    bytes32 internal constant POSITION = keccak256("myapp.strategies");
+    bytes32 internal constant POSITION = keccak256("myapp.vaults");
```
