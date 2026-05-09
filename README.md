# diamond-detect

A static analyzer for [EIP-2535 Diamond](https://eips.ethereum.org/EIPS/eip-2535) storage-slot collisions. Reads your Foundry build artifacts and reports cases where two facets would silently corrupt each other through the proxy's shared storage.

```sh
npx diamond-detect .
```

## Why this tool exists

A Diamond proxy `delegatecall`s into many facet contracts, and **every facet shares the proxy's storage**. When two facets accidentally land at the same slot — by reusing a Diamond Storage namespace, by drifting AppStorage layouts, by reusing an EIP-7201 id, or by writing literal slots in inline assembly — the result is silent corruption: one facet's writes overwrite another's data with no error and no revert.

Slither catches general storage issues but doesn't speak Diamond. Most teams either hand-audit by spreadsheet or rely on a one-off script. `diamond-detect` is a focused, Diamond-specific analyzer you can drop into CI in three lines of YAML.

## Should you use it?

You should use it if:

- Your project deploys an EIP-2535 Diamond, or treats some contracts as facets sharing a single proxy's storage.
- You use Foundry to build (`out/` artifacts).
- You want to catch namespace, AppStorage, EIP-7201, or inline-assembly slot collisions before they hit mainnet.

You probably don't need it if you have only a handful of facets that all consume one canonical `LibAppStorage` and you read every storage layout diff manually. Even then, it's a 5-minute install — worth running once.

## Install

```sh
npm install -g diamond-detect    # global, then run `diamond-detect`
# or:
npx diamond-detect <path>        # no install
```

Requires Node 20+ and Foundry.

## First run

### 1. Configure Foundry to emit AST + storage layout

`diamond-detect` needs both. Easiest way is via `foundry.toml`:

```toml
[profile.default]
ast = true
extra_output = ["storageLayout"]
```

(Or pass `--ast --extra-output storageLayout` to `forge build` each time.)

### 2. Build

```sh
forge build
```

This populates `out/` with artifact JSON files that include the AST and storage layout for every contract.

### 3. Scan

```sh
diamond-detect .
```

If everything is fine you'll see:

```
scanned 12 contract artifact(s)
✓ no storage collisions detected
```

If something is wrong you'll see one or more findings with the slot, the colliding contracts, and a hint at the cause:

```
ERROR diamond-storage-namespace  0x84d86c34a05b71953e57fe7dafea685384b33934d9ddaebd0cf7709e74b71bab
  Diamond Storage namespace "myapp.strategies" is declared in 2 different sources, all resolving to the same slot.
  facets: LibStrategies, LibVaults
  at src/LibStrategies.sol
  at src/LibVaults.sol

1 error(s), 0 warning(s)
```

Exit code is `1` whenever a finding meets your `--severity` threshold (default `warn`), `0` otherwise, `2` on internal errors.

## What it detects

Run [`examples/`](./examples/) to see each one in action — every example ships a buggy `before/` and a fixed `after/`.

| Kind | Severity | What it catches |
|---|---|---|
| `diamond-storage-namespace` | error | Two libraries declare `bytes32 constant POSITION = keccak256("...")` with the same string. ([01-namespace-collision](./examples/01-namespace-collision/)) |
| `appstorage-fingerprint` | error | The same fully-qualified struct (e.g. `struct LibAppStorage.AppStorage`) has different layouts across facets — the stale-artifact / forgot-to-rebuild bug. ([02-appstorage-shift](./examples/02-appstorage-shift/)) |
| `erc7201-namespace` | error | Two contracts annotate `@custom:storage-location erc7201:<id>` with the same id. ([03-erc7201-collision](./examples/03-erc7201-collision/)) |
| `inheritance-overlap` | warn | Two facets have state at the same slot whose `(label, type)` differ — e.g. `Ownable._owner` vs `MyOwnable.owner`. |
| `inline-assembly-slot` | info | A literal slot is written via `sstore(0x42, …)`. Usually intentional, but reported so you can confirm it doesn't overlap a computed Diamond Storage slot. |

A clean baseline that exercises every analyzer and produces no findings is in [`examples/04-clean/`](./examples/04-clean/).

## Configuring for your project

### Scope to your real facets with `--facets`

By default `diamond-detect` analyzes every contract in `src/`. Diamond projects often have non-facet contracts there too — registries, factories, libraries — and the inheritance-overlap analyzer can produce noisy advisories for them. Tell it where your facets actually live:

```sh
diamond-detect --facets 'src/facets/**' .
```

This restricts the facet-shared-storage analyzers (`inheritance-overlap`, `appstorage-fingerprint`) to that glob. Other analyzers still scan the whole project.

### Default ignores

These paths are skipped automatically because they're never facets:

```
lib/**
test/**
script/**
**/*.t.sol
**/*.s.sol
```

Add your own with `--ignore <glob>` (repeatable). Disable the defaults entirely with `--no-default-ignore`.

### Severity thresholds in CI

```sh
diamond-detect --severity error .   # exit 1 only on errors
diamond-detect --severity warn .    # default: exit 1 on warns + errors
diamond-detect --severity info .    # exit 1 on anything
```

## CLI reference

```
diamond-detect <path>                    Foundry project root or src/ folder
  --json                                 Machine-readable JSON
  --markdown                             GitHub-flavored Markdown (PR-friendly)
  --severity <info|warn|error>           Exit-code threshold (default: warn)
  --ignore <glob>                        Skip source paths matching this glob (repeatable)
  --no-default-ignore                    Don't skip lib/, test/, script/, *.t.sol, *.s.sol
  --facets <glob>                        Restrict facet-shared-storage analyzers
                                         (inheritance-overlap, appstorage-fingerprint)
                                         to source paths matching this glob (repeatable)
```

## Output formats

- **Terminal** (default): coloured, one block per finding, summary footer.
- **JSON** (`--json`): a stable shape suitable for piping into other tools.

  ```json
  {
    "summary": { "facetCount": 12, "errors": 1, "warnings": 0, "info": 0 },
    "findings": [
      {
        "kind": "diamond-storage-namespace",
        "severity": "error",
        "slot": "0x...",
        "message": "...",
        "facets": ["LibStrategies", "LibVaults"],
        "locations": [{ "file": "src/LibStrategies.sol" }],
        "detail": { "namespaces": ["myapp.strategies"], "declarations": [...] }
      }
    ]
  }
  ```

- **Markdown** (`--markdown`): findings grouped by kind into severity-tagged `<details>` blocks. Designed for posting as a PR comment.

## CI integration

Drop this into `.github/workflows/diamond-detect.yml`:

```yaml
name: diamond-detect

on:
  pull_request:

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: foundry-rs/foundry-toolchain@v1
      - run: forge build
      - run: npx -y diamond-detect --markdown --facets 'src/facets/**' . > diamond-detect.md
      - uses: marocchino/sticky-pull-request-comment@v2
        with:
          path: diamond-detect.md
```

Tighten with `--severity error` if you only want to fail CI on hard collisions.

## Troubleshooting

**"warning: no AST found in any artifact"** — your build didn't include AST output. Set `ast = true` in `foundry.toml` (under `[profile.default]`) and rebuild. Without AST, the namespace, EIP-7201, and inline-assembly analyzers can't run; only storage-layout-based ones (`appstorage-fingerprint`, `inheritance-overlap`) will fire.

**"Foundry out/ directory not found"** — you haven't run `forge build` yet, or you pointed `diamond-detect` at the wrong directory. Pass either the project root (the directory with `foundry.toml`) or any subdirectory of it.

**Scans `0` artifacts** — the loader is filtering everything. If your facets live under non-standard paths (e.g. `src/diamond/**` and you also have files in `lib/diamond-3-hardhat/`), check whether the default-ignore is hiding them. Use `--no-default-ignore` to confirm, then add narrower `--ignore` patterns.

**Lots of `inheritance-overlap` warnings on registries / factories** — those are non-facet contracts. Scope the analyzer with `--facets 'src/facets/**'` (or wherever your facets live).

**Findings only when I rebuild?** — `forge build` is incremental. If you change a struct definition but don't touch the consumers, their artifacts stay stale and the analyzer doesn't see the new layout. Wipe with `forge clean && forge build` if you suspect drift.

## Comparison

| Tool | Diamond Storage namespaces | EIP-7201 ids | AppStorage drift | Hardcoded sstore slots |
|---|---|---|---|---|
| Slither | partial — general slot detector, not Diamond-aware | no | no | yes (separate detector) |
| Hand-audit / spreadsheet | yes, manually | yes, manually | hard to spot | yes |
| `diamond-detect` | yes | yes | yes | yes |

Slither remains excellent for general Solidity static analysis. Use both.

## Roadmap

- **Onchain mode**: point at a deployed Diamond address; resolve facets through the [Diamond Loupe](https://eips.ethereum.org/EIPS/eip-2535#diamond-loupe), pull source from Etherscan, and run the same checks against what's actually live.
- **Facet auto-detection**: infer the facet set by walking deployment scripts or naming conventions, so `--facets` becomes optional.
- **Slither plugin**: surface findings inside an existing Slither pipeline.
- **VS Code extension**: inline diagnostics on save.

Issues and PRs welcome at the [repo](https://github.com/jayeshy14/Diamond-Storage-Detector).

## License

MIT. See [LICENSE](./LICENSE).
