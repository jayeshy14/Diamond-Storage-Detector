# diamond-detect

A static analyzer for [EIP-2535 Diamond](https://eips.ethereum.org/EIPS/eip-2535) storage-slot collisions. Reads Foundry build artifacts and reports cases where two facets would silently corrupt each other's data through the proxy's shared storage.

## Why this tool exists

Diamond proxies `delegatecall` into many facet contracts and **all facets share the proxy's storage**. When two facets accidentally land at the same slot — by reusing a Diamond Storage namespace string, by drifting AppStorage layouts, by reusing an EIP-7201 id, or by raw assembly slot writes — the result is silent corruption: one facet's writes overwrite another's data with no error and no revert.

There is no good public tool for this. Diamond developers either hope they don't have collisions, hand-audit by listing namespaces in a spreadsheet, or copy a one-off script from a friend. `diamond-detect` fills that gap.

## Install

```sh
npm install -g diamond-detect
# or, no install:
npx diamond-detect <path>
```

Requires Node 20+.

## Quickstart

`diamond-detect` reads Foundry's `out/` directory. You need AST output and storage layouts:

```toml
# foundry.toml
[profile.default]
ast = true
extra_output = ["storageLayout"]
```

Then:

```sh
forge build
diamond-detect .
```

If everything is fine you'll see:

```
scanned 12 contract artifact(s)
✓ no storage collisions detected
```

If something is wrong you'll see one or more findings with the slot, the colliding contracts, and a hint at the cause.

## What it detects

| Kind | Severity | What it catches |
|---|---|---|
| `diamond-storage-namespace` | error | Two facets / libraries declare `bytes32 constant POSITION = keccak256("...")` with the same string. ([example](./examples/01-namespace-collision/)) |
| `appstorage-fingerprint` | error | The same fully-qualified struct (e.g. `struct LibAppStorage.AppStorage`) has different field layouts across facets — the stale-artifact / forgot-to-rebuild bug. ([example](./examples/02-appstorage-shift/)) |
| `erc7201-namespace` | error | Two contracts annotate `@custom:storage-location erc7201:<id>` with the same id. ([example](./examples/03-erc7201-collision/)) |
| `inheritance-overlap` | warn | Two facets have state variables at the same slot whose `(label, type)` differ — e.g. `Ownable._owner` vs `MyOwnable.owner`, or two unrelated contracts colliding at slot 0. |
| `inline-assembly-slot` | info | A literal slot is written via `sstore(0x42, ...)`. Usually intentional, but reported so you can confirm it doesn't overlap a computed Diamond Storage slot. |

A clean baseline is in [`examples/04-clean/`](./examples/04-clean/).

## CLI

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

By default the loader skips `lib/**`, `test/**`, `script/**`, `**/*.t.sol`, `**/*.s.sol` so forge-std, OpenZeppelin, and your test/deploy contracts don't generate noise.

## Output formats

- **Terminal** (default): coloured, scannable, one block per finding.
- **JSON** (`--json`): a stable shape suitable for piping into other tools — `{ summary, findings: [...] }`.
- **Markdown** (`--markdown`): findings grouped by kind into severity-tagged `<details>` blocks, designed for posting as a PR comment.

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
      - run: npx -y diamond-detect --markdown . > diamond-detect.md
      - uses: marocchino/sticky-pull-request-comment@v2
        with:
          path: diamond-detect.md
```

Set `--severity error` if you only want to fail CI on hard collisions and let `warn` / `info` findings ride.

## Comparison

| Tool | Diamond Storage namespaces | EIP-7201 | AppStorage drift | Inline assembly slots |
|---|---|---|---|---|
| Slither | partial (general slot collision detector, not Diamond-aware) | no | no | yes (other detectors) |
| Hand-audit / spreadsheet | yes, manually | yes, manually | hard to spot | yes |
| `diamond-detect` | yes | yes | yes | yes |

Slither is excellent at general Solidity static analysis. It doesn't speak Diamond Storage as a first-class concept — there's no detector for "two libraries with the same `keccak256("...")` constant" or "EIP-7201 id collisions." `diamond-detect` is narrow and Diamond-specific. Use both.

## Roadmap

- **Onchain mode**: point at a deployed Diamond address; resolve facets through the [Diamond Loupe](https://eips.ethereum.org/EIPS/eip-2535#diamond-loupe), pull source from Etherscan, and run the same checks against what's actually live.
- **Facet auto-detection**: infer the facet set by walking deployment scripts or naming conventions, so `--facets` becomes optional.
- **Slither plugin**: surface findings inside an existing Slither pipeline.
- **VS Code extension**: inline diagnostics on save.

## License

MIT. See [LICENSE](./LICENSE).
