# Examples

Each subdirectory is a self-contained Foundry project that demonstrates one collision type. Three of them ship a `before/` (the bug) and an `after/` (the fix); the fourth is a clean baseline.

| Example | Analyzer | What it shows |
|---|---|---|
| [01-namespace-collision](./01-namespace-collision/) | `diamond-storage-namespace` | Two libraries copy-paste the same `keccak256("…")` slot string. |
| [02-appstorage-shift](./02-appstorage-shift/) | `appstorage-fingerprint` | Two facets reference `struct LibAppStorage.AppStorage` but the underlying struct has different fields. |
| [03-erc7201-collision](./03-erc7201-collision/) | `erc7201-namespace` | Two contracts share the same `@custom:storage-location erc7201:…` id. |
| [04-clean](./04-clean/) | — | Sanity baseline. Zero findings, exit 0. |

## Running them

Every example needs Foundry's AST output. Each project's `foundry.toml` already sets `ast = true`, so `forge build` is enough:

```sh
cd examples/01-namespace-collision/before
forge build
diamond-detect .
```

The `before/` projects exit with a non-zero status (they have findings); `after/` and `04-clean/` exit 0.

## Smoke test on a real Diamond

The detector is also exercised against the [BlokC-Diamond](https://github.com/jayeshy14/BlokC-Diamond) repository. The default scan surfaces three advisory `inheritance-overlap` warnings on standalone (non-facet) registries; scoping to actual facets silences them:

```sh
diamond-detect --facets 'src/facets/**' /path/to/BlokC-Diamond
# scanned 22 contract artifact(s)
# ✓ no storage collisions detected
```
