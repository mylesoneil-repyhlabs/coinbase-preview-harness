# Coinbase Guard product sprint log

This log records what each release was required to improve, what engineering
shipped, the strongest QA and target-user finding, how it was validated, and
the user-facing consequence. Claims describe the checked-in public prototype,
not private Delta or a Coinbase partnership.

## Sprint 1 — v1.5.0

### PM requirement

Make trust visible without making protection feel like configuration:

- credential-free dry run by default;
- optional user-supplied View-only Coinbase account/product/BBO/Preview facts;
- one chat-native mandate → authorization → proposal → decision journey;
- plain-English provenance, freshness, impact, recovery, and no-order status;
- exact binding, expiry, replay/tamper protection, and private redacted history;
- never Create, submit an order, persist a secret, or imply production Delta.

### Engineering decision

One `runGuardPreflight` orchestrator owns both explicit modes:

- `dry_run` uses labeled, deterministic fixtures and the local simulated Delta
  adapter;
- `view_only_preflight` uses an ephemeral View-only key through a route/method
  allowlist, then stops after deterministic policy/evidence checks and Preview.

Language-model activity is restricted to extraction, clarification, and
explanation. Typed deterministic code owns schema validation, canonical
digests, decimal arithmetic, evidence normalization/freshness, policy
decisions, endpoint allowlists, exact request/payload binding, nonce/replay,
receipts, history, and mode/boundary labels.

Receipts and history use explicit schema versions. Only allowlisted normalized
facts, hashes, local IDs, timestamps, decision semantics, and no-order state
are retained. Raw Coinbase bodies, headers, account IDs, key IDs, secrets, and
key-file paths are excluded. Local history is private, bounded to 100 entries,
and has an explicit deletion command.

### QA finding

Initial v1.5 code incorrectly collapsed some unavailable evidence into
`BLOCK`, trusted embedded digest fields during receipt verification, checked a
retry nonce before validating authorization, did not atomically serialize
concurrent same-nonce runs, and could overstate evidence on early failures.

The release gate was expanded to cover missing/stale/malformed product,
balances, BBO, and Preview; changed Preview bytes/fingerprint; expired policy;
underlying record mutation; nonce mismatch/concurrency/supersession; wrong
side/size; unavailable product; 401/403/429/outage/partial responses; and
secret-like provider text.

### Target-user finding

A fresh user should not copy a policy digest, read JSON, see an absolute path,
or answer nine jargon-heavy questions. The first draft also omitted material
slippage, partial-fill, funding, and settlement terms, while early failures
could falsely claim a proposal or evidence had been checked.

### Shipped fix

- Compact first-run choice: protected dry run or optional View-only facts.
- Conversational supported-action recognition and grouped missing constraints.
- “Mandate captured” displays every enforceable term; the skill retains the
  private plan and digest while the user replies “Authorize this mandate.”
- Default result shows complete mandate, exact proposal, one
  `PASS`/`BLOCK`/`REVIEW` reason, rounded impact, checked facts/time, recovery,
  and the truthful boundary. Hashes and paths are details-on-demand.
- View-only preflight uses only permissions, accounts, exact product, BBO, and
  Preview; no Create route or method exists in that adapter.
- Stale, missing, malformed, mismatched, rate-limited, or unavailable evidence
  produces `REVIEW`; verified mandate violations remain `BLOCK`.
- Receipt verification recomputes canonical bindings from underlying content.
  Replay validates authorization and credential scope, mismatched nonce reuse
  blocks, concurrent exact retries serialize, and expired/superseded results
  remain historical only.
- Private Guard history records redacted provenance, age, outcome, currentness,
  and no-order status without credentials or provider identifiers.

### Validation

Release validation must include:

- full Node test suite and focused v1.5 adversarial/UX tests;
- skill metadata/workflow validation and local-link checking;
- secret/content scanning and release metadata validation;
- deterministic release archive build;
- cold managed install with `node` absent from login `PATH`;
- deletion of the downloaded source followed by doctor, plan, dry run, history,
  and Create-lock checks from the installed skill.

The release entry is complete only after those checks, the release tag and
GitHub release assets are published, and the public checksum/download are
re-verified.

### User-facing impact

The no-key path should complete in under 60 seconds. Once a View-only key
exists, setup should take under three minutes and no more than two user
decisions. Every supported outcome states Dry run or View only and that no
order was submitted. Protection is visible in the result, while operational
hashes, paths, and raw normalized metadata stay out of the ordinary chat.

### Deferred by scope

- Coinbase Create, live orders, transfers, staking, derivatives, scheduling,
  multi-leg strategies, and portfolio management;
- production/private Delta verification or signing;
- independent authentication of stored Coinbase facts;
- remote telemetry or centralized history.

## Sprint 2 — patch release

Pending fresh QA and target-user review after v1.5.0.

## Sprint 3 — patch release

Pending fresh QA and target-user review after Sprint 2.

## Sprint 4 — patch release

Pending fresh QA and target-user review after Sprint 3.
