# diamond-detect

A static analyzer for [EIP-2535 Diamond](https://eips.ethereum.org/EIPS/eip-2535) storage-slot collisions. Reads your Foundry build artifacts and reports cases where two facets would silently corrupt each other through the proxy's shared storage.

```sh
npx diamond-detect .
```

## Why this tool exists

A Diamond proxy `delegatecall`s into many facet contracts, and **every facet shares the proxy's storage**. When two facets accidentally land at the same slot, whether by reusing a Diamond Storage namespace string, by hardcoding the same precomputed slot, by computing the same ERC-7201 namespace inline, by drifting AppStorage layouts, by reusing an EIP-7201 id, or by writing a literal slot directly in inline assembly, the result is silent corruption where one facet's writes overwrite another's data with no error and no revert.

Slither catches general storage issues but doesn't speak Diamond. Most teams either hand-audit by spreadsheet or rely on a one-off script. `diamond-detect` is a focused, Diamond-specific analyzer you can drop into CI in three lines of YAML.

## Should you use it?

You should use it if:

- Your project deploys an EIP-2535 Diamond, or treats some contracts as facets sharing a single proxy's storage.
- You use Foundry to build (`out/` artifacts).
- You want to catch namespace, AppStorage, EIP-7201, or inline-assembly slot collisions before they hit mainnet.

You probably don't need it if you have only a handful of facets that all consume one canonical `LibAppStorage` and you read every storage layout diff manually. Even then, it's a 5-minute install that is worth running once.

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

If everything is fine you'll see a confirmation, plus every storage region the tool verified so you can see it actually inspected each one and that they all sit on distinct slots:

```
✔ no storage collisions detected  ·  8 artifacts scanned

Verified 4 storage regions, each on its own slot:

  • myapp.vaults                       erc7201      0x84d86c…b71bab  LibVaults    src/LibVaults.sol:12
  • myapp.strategies                   namespace    0xa1b2c3…445566  LibStrategies  src/LibStrategies.sol:9
  • AAVE_STORAGE_SLOT                   precomputed  0x340080…215700  AaveFacet    src/facets/AaveFacet.sol:28
  • diamond.standard.diamond.storage   namespace    0xc8fcad…2c131c  LibDiamond   src/libraries/LibDiamond.sol:8

Every facet keeps to its own namespace, and no two regions share a slot. Nicely done.
```

If something is wrong you'll get one diagnostic per collision, with a code frame pointing at the exact line in every colliding file, the shared slot, and a hint at the cause:

```
error[diamond-storage-namespace]: Diamond Storage namespace "myapp.strategies" is declared in 2 different sources, all resolving to the same slot.
  ╭─[src/LibStrategies.sol:5:5]
    │
  5 │     bytes32 internal constant POSITION = keccak256("myapp.strategies");
    ·     ────────────────────────────────────────────────────────────────── slot 0x84d86c…b71bab
    ╰─
  ╭─[src/LibVaults.sol:8:5]
    │
  8 │     bytes32 internal constant POSITION = keccak256("myapp.strategies");
    ·     ────────────────────────────────────────────────────────────────── same slot here
    ╰─
  = facets: LibStrategies, LibVaults
  = slot:   0x84d86c34a05b71953e57fe7dafea685384b33934d9ddaebd0cf7709e74b71bab
  = help:   give every facet a unique storage seed; never reuse a namespace string, precomputed slot, or formula across facets

✖ 1 error  ·  2 artifacts scanned
```

Exit code is `1` whenever a finding meets your `--severity` threshold (default `warn`), `0` otherwise, `2` on internal errors.

## What it detects

Run [`examples/`](./examples/) to see each one in action, since every example ships a buggy `before/` and a fixed `after/`.

| Kind | Severity | What it catches |
|---|---|---|
| `diamond-storage-namespace` | error | Two facets resolve to the same Diamond Storage slot, whether the slot comes from `keccak256("...")`, a hardcoded precomputed literal (`bytes32 constant S = 0x..`), the inline ERC-7201 formula written without an annotation, or a direct `assembly { x.slot := <literal> }`. All four representations are compared in one space, so a literal in one facet that matches a formula or namespace in another is caught too. ([01-namespace-collision](./examples/01-namespace-collision/)) |
| `appstorage-fingerprint` | error | The same fully-qualified struct (e.g. `struct LibAppStorage.AppStorage`) has different layouts across facets, the stale-artifact or forgot-to-rebuild bug. ([02-appstorage-shift](./examples/02-appstorage-shift/)) |
| `erc7201-namespace` | error | Two contracts annotate `@custom:storage-location erc7201:<id>` with the same id. ([03-erc7201-collision](./examples/03-erc7201-collision/)) |
| `inheritance-overlap` | warn | Two facets have state at the same slot whose `(label, type)` differ, for example `Ownable._owner` vs `MyOwnable.owner`. |
| `inline-assembly-slot` | info | A literal slot is written via `sstore(0x42, …)`. Usually intentional, but reported so you can confirm it doesn't overlap a computed Diamond Storage slot. |

A clean baseline that exercises every analyzer and produces no findings is in [`examples/04-clean/`](./examples/04-clean/).

## Configuring for your project

### Scope to your real facets with `--facets`

By default `diamond-detect` analyzes every contract in `src/`. Diamond projects often have non-facet contracts there too (registries, factories, libraries), and the inheritance-overlap analyzer can produce noisy advisories for them. Tell it where your facets actually live:

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
diamond-detect <path>                    Foundry project root or src/ folder (omit with --onchain)
  --onchain <address>                    History mode: replay the deployed Diamond's
                                         DiamondCut log and check every facet ever registered
  --rpc <url>                            RPC endpoint for --onchain ($RPC_URL_ARB / $RPC_URL)
  --etherscan-key <key>                  Etherscan API key for --onchain ($API_KEY_ETHERSCAN)
  --chainid <n>                          Chain id for --onchain (default: 42161, Arbitrum One)
  --json                                 Machine-readable JSON
  --markdown                             GitHub-flavored Markdown (PR-friendly)
  --severity <info|warn|error>           Exit-code threshold (default: warn)
  --ignore <glob>                        Skip source paths matching this glob (repeatable)
  --no-default-ignore                    Don't skip lib/, test/, script/, *.t.sol, *.s.sol
  --facets <glob>                        Restrict facet-shared-storage analyzers
                                         (inheritance-overlap, appstorage-fingerprint)
                                         to source paths matching this glob (repeatable)
  --allow-missing-ast                    Downgrade the "no artifact has an AST" hard
                                         failure to a warning and continue
```

## Output formats

- **Terminal** (default): a code-frame diagnostic per collision that underlines the exact slot declaration in every colliding file, with `= facets / = slot / = help` notes and a coloured summary footer. A clean run instead lists every storage region it verified, with its slot and location, so you can confirm nothing was skipped. Colour is auto-disabled when the output is piped or running in CI.
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
        "locations": [{ "file": "src/LibStrategies.sol", "line": 5, "src": "120:54:0" }],
        "detail": { "namespaces": ["myapp.strategies"], "variableNames": ["POSITION"], "declarations": [...] }
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

**"error: no AST found in any artifact" (exit 2)**: your build didn't include AST output, so the namespace, EIP-7201, and inline-assembly analyzers can't run and only the storage-layout-based ones (`appstorage-fingerprint`, `inheritance-overlap`) would fire. Rather than pass CI green on that partial scan, the tool **fails closed** with exit 2. Set `ast = true` in `foundry.toml` (under `[profile.default]`) and rebuild. If you deliberately want a storage-layout-only scan, pass `--allow-missing-ast` to downgrade this to a warning and continue.

**"Foundry out/ directory not found"**: you haven't run `forge build` yet, or you pointed `diamond-detect` at the wrong directory. Pass either the project root (the directory with `foundry.toml`) or any subdirectory of it.

**Scans `0` artifacts**: the loader is filtering everything. If your facets live under non-standard paths (e.g. `src/diamond/**` and you also have files in `lib/diamond-3-hardhat/`), check whether the default-ignore is hiding them. Use `--no-default-ignore` to confirm, then add narrower `--ignore` patterns.

**Lots of `inheritance-overlap` warnings on registries / factories**: those are non-facet contracts. Scope the analyzer with `--facets 'src/facets/**'` (or wherever your facets live).

**Findings only when I rebuild?** `forge build` is incremental. If you change a struct definition but don't touch the consumers, their artifacts stay stale and the analyzer doesn't see the new layout. Wipe with `forge clean && forge build` if you suspect drift.

## Comparison

| Tool | Diamond Storage namespaces | Precomputed / inline-formula slots | EIP-7201 ids | AppStorage drift | Hardcoded assembly slots |
|---|---|---|---|---|---|
| Slither | partial, a general slot detector that is not Diamond-aware | no | no | no | partial, raw `sstore` only |
| Hand-audit / spreadsheet | yes, manually | error-prone by hand | yes, manually | hard to spot | yes, manually |
| `diamond-detect` | yes | yes | yes | yes | yes |

Slither's storage layout does not model Diamond namespaced storage, which lives at hashed slots reached through assembly, so it cannot see a Diamond storage collision at all. It remains excellent for general Solidity static analysis, so run both.

## History mode (on-chain)

A static scan only sees the facets that compile today. A Diamond that has been live for years has had facets added and removed, and **storage persists after a facet is removed** — its slots still hold data that a newly added facet can collide with. So the real collision space is every storage region the proxy has *ever* used, not just today's source tree.

History mode reconstructs that full set from the chain itself:

```sh
diamond-detect --onchain 0x06eb18FC187Ec0Bf4687e6783DC8cDcB2AD8F97B \
  --chainid 42161 \
  --rpc "$RPC_URL_ARB" \
  --etherscan-key "$API_KEY_ETHERSCAN"
```

What it does:

1. **Replays the `DiamondCut` event log** — an immutable record of every facet ever cut in or out — to recover every facet address ever registered, removed ones included. The log is read from Etherscan's logs endpoint (paginated server-side) rather than `eth_getLogs`, because free RPC tiers cap `eth_getLogs` to as few as 10 blocks, which makes a from-deployment scan of a 20M+ block chain impossible.
2. **Fetches each facet's verified source** from Etherscan and **recompiles it with its exact solc version** (recovered from the verified build) so the AST and storage layout match what was actually deployed.
3. Runs the **same five analyzers** over the union. Shared libraries keep their canonical source path, so a `LibDiamond` bundled into every facet collapses to one region and never false-positives against itself; two facets that *independently* declare the same namespace are still caught.

`--rpc` defaults to `$RPC_URL_ARB` or `$RPC_URL`, `--etherscan-key` to `$API_KEY_ETHERSCAN`, and `--chainid` to `42161` (Arbitrum One). A `.env` in the working directory is loaded automatically.

Limitations: facets whose source is unverified on Etherscan are skipped (and reported), and history mode reasons about the union of declared layouts — it flags drift and shared-slot reuse, but it does not replay actual storage writes, so it cannot prove a removed facet's leftover *data* currently overlaps a live region, only that their layouts would collide if co-resident.

## Roadmap

- **Facet auto-detection**: infer the facet set by walking deployment scripts or naming conventions, so `--facets` becomes optional.
- **Slither plugin**: surface findings inside an existing Slither pipeline.
- **VS Code extension**: inline diagnostics on save.

Issues and PRs welcome at the [repo](https://github.com/jayeshy14/Diamond-Storage-Detector).

## License

MIT. See [LICENSE](./LICENSE).
