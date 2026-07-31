# Delta Coinbase Guard v1.6.0 release notes

v1.6.0 adds Delta Guard Advisor: a dependency-free, local-first protected
execution copilot built on the v1.5 deterministic Coinbase spot Guard.

The release is independently built by Delta. It is not a Coinbase product,
integration, partnership, or endorsement. It does not integrate private Delta
Mandate, submit an order, or move money.

## What is new

- **Useful before connecting anything.** Start the local Advisor and run a
  complete protected BUY or SELL dry run with clearly generated facts.
- **Natural-language mandate review.** One primary composer turns a supported
  spot request into a scan-friendly Action / Maximum / Trigger / Expiry
  boundary. The user must confirm that exact protected check before evidence is
  read.
- **Plain decisions.** `PASS` means the exact proposal fits the mandate,
  `BLOCK` means verified facts are outside it, and `REVIEW` means the Guard
  cannot verify current complete evidence. Every result says no order was
  submitted.
- **Optional View-only connection.** A normal CDP View-only key can support
  point-in-time permissions, balances, exact product, BBO, and Preview checks.
  Credential material exists briefly in the form, page JavaScript, and one
  loopback request, then only in server-process memory. It is never stored in
  browser storage, a URL, logs, history, analytics, or the repository.
- **One-check conditional planner.** Save a non-executable BUY or SELL
  condition and simulate it once using an explicit fixture or one fresh
  View-only BBO check. Nothing watches, schedules, repeats, or trades.
- **Educational planning.** Compare a neutral BTC, ETH, or SOL market snapshot
  and edit an allocation canvas. Facts, locally curated source summaries,
  calculations, and user inputs remain visibly distinct. The output is not
  individualized financial advice.
- **Explicit one-leg handoff.** Selecting exactly one allocation leg and an
  explicit BUY or SELL creates a new editable protected-trade draft. It does
  not authorize, Preview, evaluate, or submit that draft.
- **Locked future boundary.** A qualified View-only `PASS` may show a neutral
  read-only explanation of controls still missing before any live order could
  be considered. Decision remains terminal; there is no confirmation,
  challenge, grant, Trade-key field, executor, or Create route.
- **Redacted activity.** Connection, protected-check, conditional, education,
  and existing Guard-history entries are merged newest-first without storing
  credentials or raw Coinbase responses.

## Security and packaging

- The server binds to loopback and uses a 256-bit page-memory capability header
  for stateful requests. It does not issue or trust cookies.
- Feature flags stop disabled routes before body parsing, session allocation,
  provider creation, or network work.
- Conditional and educational revisions are bounded; replay, tamper, expiry,
  cancellation, and late-result races fail closed.
- Oversized and slow request handling is bounded with explicit server
  timeouts.
- `./run advisor` dispatches directly to the Advisor server without importing
  the execution-capable CLI or Coinbase Create adapter.
- The deterministic release archive contains the frontend and every linked
  Advisor document. Its cold validator installs under restricted `PATH`,
  deletes extracted source, launches the managed Advisor, fetches its local
  assets/status, and confirms execution-like routes remain absent.
- Release scanning rejects credential-shaped content, binary files, and
  embedded image payloads that could conceal a secret canary.

## Unchanged hard boundaries

- Coinbase Create, order submission, transfers, and money movement are absent.
- No Trade credential field or usable final-order confirmation exists.
- Coinbase Preview is point-in-time evidence, not a fill or price guarantee.
- The receipt is local SHA-256 integrity evidence, not a production Delta or
  Coinbase signature.
- Private Delta verification, authenticated user identity, durable atomic
  grants, exact-byte Create service, kill switch, journal, reconciliation, and
  separate first-order approval remain future production prerequisites.
- Conditional plans are simulations, not monitored or unattended orders.
- Educational output is editable planning, not suitability advice or an
  automatic portfolio strategy.

## Install

Verify the versioned checksum before installing:

```sh
shasum -a 256 -c delta-coinbase-guard-v1.6.0.zip.sha256
unzip delta-coinbase-guard-v1.6.0.zip
cd delta-coinbase-guard-v1.6.0
./install
./run advisor
```

The stable release aliases remain
`delta-coinbase-guard-v1.zip` and
`delta-coinbase-guard-v1.zip.sha256`.

## Release verification

Local release-candidate checks passed:

- **65/65** focused Advisor capability, loopback authority,
  UI/layout/accessibility, and release-content checks, including **19/19**
  Advisor UI checks;
- **642/642** complete repository tests on Node 22;
- release metadata, skill, local links, JavaScript and shell syntax, CI YAML,
  and diff-integrity checks; and
- a real 320-pixel no-overflow PASS plus genuine Chrome keyboard completion
  through the locked decision. The browser controller could not set and
  verify an actual 200% zoom, so no zoom pass is claimed.

The tag must not be published until the deterministic archive, content scan,
restricted-`PATH` cold install, source-deletion Advisor launch, static asset
checks, absent execution-route probes, and CI all pass against the exact
release commit. After publication, the public archive and stable alias must
be downloaded and checked against their published SHA-256 files. The
generated manifest and GitHub release are the authoritative final evidence.

See [the Advisor demo](ADVISOR-DEMO-v1.6.md),
[security policy](../SECURITY.md), and
[eight-sprint log](ADVISOR-SPRINT-LOG.md).
