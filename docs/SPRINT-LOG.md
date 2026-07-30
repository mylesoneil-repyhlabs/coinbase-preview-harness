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

## Sprint 2 — v1.5.1

### PM requirement

Keep every decision trustworthy, including the moments when the Guard stops
before proposal or evidence collection. A user should receive a private,
verifiable local receipt for `BLOCK` and `REVIEW`, not only for `PASS`.

### Engineering decision

Failure records now follow the same construction order as successful pipeline
records: redact the base record first, create the receipt over those exact safe
bytes, attach the untouched receipt, then compute the outer record digest.
Global redaction rules were not weakened.

### QA finding

Independent simulated adversarial and Coinbase-engineering reviews reproduced
the same defect in v1.5.0. `failedPreflightRecord()` sealed a receipt and then
sanitized the receipt-containing object. The sanitizer replaced the
`authorization_digest` binding with `[REDACTED]`, invalidating the earlier
receipt digest. Invalid nonce, confirmation mismatch, local credential error,
nonce mismatch/currentness, and wrapper-caught View-only failures could
therefore return an unverifiable negative receipt.

### Target-user feedback

The simulated first-time-user review completed a restricted-`PATH` install and
the ordinary dry-run journey successfully. It also found that the installer's
final handoff still used old “digest authorization” and “exact PASS gate”
language. That onboarding defect is recorded for the next mini-sprint; this
sprint prioritizes the independently reproduced evidence-integrity failure
because it affects every early `BLOCK`/`REVIEW` receipt.

### Shipped fix

- Sanitize failure content before receipt creation.
- Preserve a canonical 64-character authorization binding inside the receipt.
- Verify both confirmation-mismatch `BLOCK` and local credential `REVIEW`
  receipts while retaining path/credential redaction.

### Validation

- focused preflight, presentation, and receipt-security regressions;
- full repository test suite;
- skill, links, release metadata, content scan, deterministic archive, and
  restricted-`PATH` cold install before release.

### User-facing impact

Every supported outcome now has a locally verifiable integrity receipt. The
normal chat remains compact, secrets remain redacted, and Create stays
unavailable.

## Sprint 3 — v1.5.2

### PM requirement

Make the first post-install action obvious, outcome-neutral, and usable after
the user deletes the downloaded archive. Starting the protected dry run should
not require a local documentation file, a digest, or knowledge of the result.

### Engineering decision

Keep the managed install and source-deletion model unchanged. Replace only the
installer's success handoff with a self-contained chat script: invoke the
skill, state an ordinary BUY or SELL intent, review the complete mandate, and
send a separate plain-English authorization message. Do not bias the outcome
or expose a hash.

### QA finding

Fresh simulated install QA against the shipped v1.5.1 release found a
contradiction in the success output. It first said the extracted release could
be deleted, then pointed to a recording-kit file inside that release. Its
fallback still asked for “digest authorization” and an “exact PASS gate,”
despite the v1.5 skill keeping the digest private and returning any of
`PASS`, `BLOCK`, or `REVIEW`.

### Target-user feedback

A fresh simulated first-time Codex user completed the restricted-`PATH`
install, but the final instructions did not survive the advertised cleanup
journey and implied technical ceremony the ordinary chat no longer requires.
The requested recovery was one copyable, source-independent next step with an
explicit no-order boundary.

### Shipped fix

- Put the complete protected BUY/SELL dry-run handoff directly in installer
  output.
- Ask for `Authorize this mandate` as a separate user message.
- State `PASS/BLOCK/REVIEW`, receipt status, and the no-order boundary without
  predicting the outcome.
- Remove the source-relative recording-kit dependency and obsolete digest
  language from the handoff.

### Validation

- restricted-`PATH` install output acceptance checks;
- source deletion followed by installed `doctor`;
- full repository test suite;
- skill, links, release metadata, content scan, deterministic archive, and
  cold-install validation before release.

### User-facing impact

A normal Codex user can go directly from successful install to the protected
chat flow with no improvisation, no digest handling, and no dependency on the
download they were told they could delete.

## Sprint 4 — patch release

Pending fresh QA and target-user review after Sprint 3.
