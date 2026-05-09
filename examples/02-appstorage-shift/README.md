# 02 — AppStorage struct drift

Two facets each pull in a library called `LibAppStorage`, but from different files. The two libraries define `struct AppStorage` with different field orders. Both facets reference the type label `struct LibAppStorage.AppStorage`, so the proxy's storage gets read and written with two different mental models — `FacetB.pause()` flips a bool at slot 1, but `FacetA.setCurator()` overwrites that slot with an address.

In a real codebase, this divergence usually arises when one facet is rebuilt against an updated `AppStorage` and another isn't. The shape of the bug — same fully-qualified struct name, different field layouts — is identical.

## Reproduce the bug

```sh
cd before
forge build
diamond-detect .
```

Expected output (truncated):

```
🔴 ERROR appstorage-fingerprint  n/a
  struct LibAppStorage.AppStorage has 2 divergent layouts across 2 sources —
    only in version A: curator@1+0:t_address;
    only in version B: paused@1+0:t_bool, curator@1+1:t_address.
  facets: FacetA, FacetB
```

## See the fix

```sh
cd ../after
forge build
diamond-detect .
```

Expected output: `✓ no storage collisions detected`.

## What changed

`after/` collapses the two `LibAppStorage` files into a single canonical one at `src/lib/LibAppStorage.sol`. Both facets import it. The struct is defined exactly once.

```diff
- import {LibAppStorage} from "./oldlib/LibAppStorage.sol";  // FacetA
- import {LibAppStorage} from "./newlib/LibAppStorage.sol";  // FacetB
+ import {LibAppStorage} from "./lib/LibAppStorage.sol";     // both
```
