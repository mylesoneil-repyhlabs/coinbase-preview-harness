# Security policy

Delta Coinbase Guard handles authorization data and may be connected to
credentials capable of placing real trades. Treat security defects as
potentially high impact even when they are found in simulation mode.

## Reporting a vulnerability

Do not open a public issue or pull request for a suspected vulnerability.
Use GitHub's private vulnerability-reporting flow from the repository's
**Security** tab. If that option is unavailable, contact the maintainers
through an existing private channel and ask for a secure reporting path
without including exploit details.

Never send API private keys, seed phrases, access tokens, credential files,
full authorization receipts, or unsanitized execution records in a report.
Include the affected commit, reproduction steps using fixtures or dummy
credentials, impact, and any suggested mitigation.

The maintainers will acknowledge a private report, assess severity and scope,
coordinate a fix, and agree on disclosure timing with the reporter. Please
allow a reasonable remediation window before public disclosure.

## Supported version

Only the latest v1.6 patch release on the default branch is supported. This is
a local protected-trade planning and preflight product, not a production
custody or trading service.

## Operator safety

- Keep Coinbase credentials outside the repository and pass credential paths
  only at runtime. The default flow needs no credential. For optional real
  reads and Preview, use a dedicated portfolio and a View-only key with Trade,
  Transfer, and Receive disabled. The composite Guard preflight does not persist
  its attestation or key. A future Trade key belongs only in an isolated
  executor.
- Do not commit anything under `credentials/` or `runtime/`. Generated
  execution reports can contain sensitive trading metadata and are written
  under ignored `runtime/artifacts/` with user-only permissions.
- A simulation artifact is not evidence of a real Delta decision or Coinbase
  order. Simulation HTML is labeled `SIMULATION_ONLY`; its local receipt is a
  SHA-256 integrity artifact and its placeholder proof is explicitly not
  cryptographically verified.
- A View-only receipt is local integrity evidence over redacted normalized
  facts. It is not a Coinbase signature, production Delta authorization,
  execution grant, or price guarantee.
- Local Guard history is bounded and private. It must never contain raw
  provider bodies/headers, account or key IDs, credential paths, private key
  material, JWTs, or arbitrary provider error text. No remote telemetry is
  enabled by default.
- Install from a pinned release and verify its SHA-256 file. The installer
  creates an integrity-manifested managed copy and rejects credential-shaped
  paths, private-key material, provider tokens, binaries, and unexpected
  source drift.
- Keep real order creation disabled until Delta engineering replaces the
  integration seam with the production verifier pinned to an approved identity
  and proof program, authenticated external user authorization, signer,
  registry, and durable one-time authorization store, and completes the
  acceptance checks documented in this repository.
- If submission status is uncertain, reconcile by the existing client order ID.
  Do not retry Create Order blindly.

If credentials may have been exposed, revoke them in Coinbase immediately,
create a new least-privileged key, and review account and portfolio activity
before continuing.

## Advisor v1.6 boundary

The advisor adds a loopback web interface, not a browser-side trading client.
The implemented credential-capable server binds to `127.0.0.1`; credential
material necessarily exists transiently in the connection form, page
JavaScript, and one same-origin loopback request. The fields are cleared before
dispatch. Once received, the accepted key material remains only in
server-process memory and is cleared on disconnect, expiry, failure, or
process exit. It must never enter browser storage, browser history, URLs, logs,
Guard history, screenshots, analytics, or release assets.

Browser authority is a high-entropy capability returned by one same-origin
session bootstrap and retained only in page memory. Every stateful read and
mutation requires the capability header. Cookies are never issued and have no
authority; missing, expired, cross-server, and cross-port capabilities fail
closed. Reloading the page discards the browser-held capability.

A hosted/static advisor is credential-free. Remote credential handling
requires a separate reviewed service and threat model. A visible one-check
control does not add a Coinbase Create route: public Create, live orders,
durable grants, and unattended execution remain unavailable.

### Locked live-readiness boundary

`features.live_readiness_preview` enables only a server-derived, neutral
**What remains** explanation for a fresh, complete, locally receipt-verified
View-only `PASS`. It does not
enable post-PASS final confirmation, an authenticated execution principal, a
production Delta verifier, a Trade credential, a durable one-use grant or
journal, a kill switch, exact-byte Create transport, reconciliation, or first-
order approval.

Decision remains terminal. The projection is omitted on dry run, `BLOCK`,
`REVIEW`, expiry, partial or future-dated evidence, binding/source/scope
mismatch, tampering, or any sign
that an adapter, gate, or order field changed. Its browser DTO exposes only a
safe action/economics/time summary and missing-prerequisite labels. It excludes
raw Coinbase bodies and IDs, Create bytes, fingerprints, challenges, and
grants. A missing or invalid sealed-record digest, mismatched supplied
execution digest, or permission scope other than View-only fails closed before
projection. Confirmation time, authorized TTL, policy expiry, preflight
expiry, and receipt expiry must also agree relationally. Those internal
permission and timing facts are receipt/record-bound but never returned to the
browser. There is no live-readiness mutation,
final-confirmation, grant, claim, Create, order, submit, place, execute, or
proxy route.

The local `guard_receipt.v1` proves local integrity only. It is not a
production Delta signature or live-order authorization.

### Educational-planning boundary

Educational planning is a session-only planning surface, not Guard evidence,
investment advice, an authorization, or an execution path.

- The browser may submit only the selected source mode, product identifiers,
  user-selected weights, explicitly acknowledged scenario assumptions, and
  later an opaque plan ID, exact revision, one leg ID, and explicit `BUY` or
  `SELL` choice. It cannot submit trusted market facts, provenance, digests,
  status, decisions, or receipts.
- Coinbase-observed provenance can be created only inside the advisor
  handler's private View-only authority from the injected allowlisted adapter.
  The exported market normalizer validates structure only and is not a
  provenance credential. Direct normalized objects, lookalikes, clones, and
  cross-authority values fail closed.
- A fixture request remains `Generated fixture`. A View-only request either
  returns fresh, exact `Coinbase observed` product/BBO facts or `REVIEW —
  unable to verify`; it never silently falls back to a fixture.
- Every accepted revision refreshes the complete selected product set through
  the plan's same explicit source before replacing the old revision. Asset-set
  changes, expired facts, and recovery from a provider `REVIEW` cannot reuse
  the prior snapshot.
- Checked-in educational paraphrases are labeled
  `Locally curated summary of primary source` and carry a publisher,
  canonical URL, catalog review date, and content digest. They are not
  represented as live retrievals or Coinbase observations.
- Allocation and scenario calculations are local educational output. The
  initial canvas has no planning amount, selected asset, weight, handoff leg,
  or side.
  Scenario values—including an untouched zero—are called `User supplied`
  only after explicit acknowledgement.
- A handoff consumes one current plan revision and creates only a new editable,
  unauthorized one-action draft. Slippage, fee, and expiry values are visible
  editable Guard defaults, not inherited user constraints. Fresh mandate
  preparation, evidence, and separate authorization are still required.

Education routes hold plans and handoff state only in the same bounded,
expiring server session. They do not import an execution adapter, call
Preview, create an order, or confer one-use execution eligibility.
