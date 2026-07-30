# Coinbase v1.5 policy, evidence, and receipt contract

This document describes the checked-in Coinbase Advanced SPOT BUY/SELL guard.
The public build has two explicit modes:

| Mode | External facts | Delta path | Terminal PASS state |
| --- | --- | --- | --- |
| `dry_run` | Labeled local account, product, BBO, and Preview fixtures; no Coinbase call | Local simulated Delta adapter and placeholder proof only | `EXECUTION_ELIGIBLE` after consuming a one-process simulation token |
| `view_only_preflight` | A user-supplied View-only key reads permissions, accounts, the exact product, BBO, and one exact Preview | No production or simulated Delta evaluation | `PREVIEW_PROBE_PASS` |

Neither state can invoke Coinbase Create. A Preview is point-in-time evidence,
not execution or a price guarantee. The private Delta Mandate codebase has not
been available for compatibility validation.

The primary implementation files are:

- `config/coinbase-spot-policy.v3.schema.json`;
- `src/spot-action.js`, `src/funding.js`, `src/market.js`, and
  `src/execution-policy.js`;
- `src/execution-pipeline.js` and `src/preflight.js`;
- `src/coinbase-rest.js`;
- `src/guard-receipt.js` and `src/dry-run-history.js`; and
- `src/mandate/coinbase-policy.js`, `src/mandate/coinbase-evidence.js`,
  `src/mandate/contract.js`, and `src/mandate/controller.js`.

## Versioned artifacts

| Artifact | Checked-in version |
| --- | --- |
| intent compilation | `delta.coinbase.compilation.v3` |
| taxonomy | `digital-asset-spot-order.v3` |
| execution plan | `delta.coinbase.execution_plan.v3` |
| canonical action | `delta.coinbase.spot_action.v2` |
| proposal | `delta.coinbase.proposal.v2` |
| funding evidence | `delta.coinbase.funding_evidence.v2` |
| execution record | `delta.coinbase.execution_record.v3` |
| preflight binding | `delta.coinbase.preflight_binding.v1` |
| frozen Delta evaluation request | `delta.coinbase.evaluation_request.v2` |
| simulated Delta decision receipt | `delta.coinbase.decision_receipt.v3` |
| public Guard receipt | `delta.coinbase.guard_receipt.v1` |
| redacted local history | `delta.coinbase.dry_run_history.v1` |
| nonce claim/result | `delta.coinbase.nonce_claim.v1` / `delta.coinbase.nonce_result.v1` |

Older plans, confirmations, evidence, and receipts must be regenerated. The
runtime rejects an older execution-plan schema rather than upgrading an
authorization silently.

## Deterministic ownership

A language model may extract a natural-language request, ask for missing
material constraints, or explain a result. It is not an authority for policy,
market, balance, Preview, decision, receipt, replay, or execution state.

Typed deterministic code owns:

- closed-schema validation and canonical SHA-256 digests;
- decimal arithmetic, precision, increments, and product bounds;
- route and method allowlists;
- evidence normalization and freshness checks;
- `PASS`, `BLOCK`, and `REVIEW`;
- exact Preview/prospective-Create binding;
- nonce claims, replay, supersession, receipts, and history; and
- the visible `dry_run` / `view_only_preflight` / no-order boundary.

## Authorized policy and canonical action

`buildCoinbasePolicyBundle` maps the user-authorized plan into:

| Parameter | Meaning |
| --- | --- |
| `product_id`, `base_asset`, `quote_asset`, `side` | Exact SPOT instrument and BUY/SELL side |
| `size_field` | `quote_size` for BUY; `base_size` for SELL |
| `size_operator`, `size_value` | `EXACT` equality or positive size no greater than `MAX` |
| `funding_asset` | Quote asset for BUY; base asset for SELL |
| `max_slippage_bps` | Maximum adverse movement from the side-correct BBO |
| `max_commission_value` | Maximum commission in quote asset |
| `settlement_kind`, `settlement_value` | BUY maximum quote debit or SELL minimum net quote proceeds |
| `market_condition_reference`, `operator`, `value` | Optional one-shot best-ask/best-bid threshold |
| `action_descriptor_digest` | Digest of the complete canonical action |
| `portfolio_fingerprint`, `credential_fingerprint` | Bound Coinbase authority |
| `expires_at_epoch_ms` | Absolute evaluation deadline |

Amounts are canonical decimal strings, not floating-point numbers or universal
microunits. Concrete Delta policy syntax remains a simulator contract until it
is checked against private Delta.

`delta.coinbase.spot_action.v2` binds:

- the Coinbase Advanced custodial-ledger domain and exact SPOT pair;
- BUY or SELL;
- SOR limit IOC and partial-fill policy;
- the side-correct size field, denomination, asset, `EXACT`/`MAX`, and value;
- held-balance funding with `conversion_allowed: false`;
- the side-correct BBO reference and limit direction;
- optional BUY best ask at-or-below or SELL best bid at-or-above;
- slippage, commission, and settlement limits; and
- one use with a validity start and TTL.

The optional market condition is evaluated once. It does not create a resting
order, monitor, scheduler, or recurring strategy. Any action-field mutation
changes the descriptor digest.

## View-only credential and route boundary

The composite preflight reads the key file for that process, verifies
`can_view: true` and `can_trade/can_transfer/can_receive: false`, and calls the
credential verifier with attestation persistence disabled. It retains only
non-secret credential and portfolio fingerprints in the sanitized record.
Secrets, key IDs, key-file paths, JWTs, headers, raw provider bodies, and raw
account IDs are not written to the Guard receipt or history.

Permission verification uses the fixed
`GET /api/v3/brokerage/key_permissions` route. The separate frozen View-only
adapter exposes only:

```text
GET  /api/v3/brokerage/accounts
GET  /api/v3/brokerage/products/{PRODUCT-ID}
GET  /api/v3/brokerage/best_bid_ask
POST /api/v3/brokerage/orders/preview
```

The client denies redirects, applies a five-second request timeout, limits
response size, sanitizes provider failures, and does not retry onto another
route. The adapter has no Create, transfer, or money-movement method. The
general Create adapter is separately capability-gated, and the public
production composition never returns that module-private capability.

## Funding evidence

`delta.coinbase.funding_evidence.v2` contains:

```text
portfolio_fingerprint
funding_asset
required_available
available_balance
account_fingerprints[]
complete
evidence_digest
```

Only active, ready, non-deleted consumer accounts whose balance currency
exactly matches the funding asset can contribute. BUY requires held quote
asset sufficient for the authorized maximum debit; SELL requires held base
asset sufficient for the authorized size. USD, USDC, and every other asset
remain distinct. No conversion or portfolio transfer is inferred.

Missing or malformed accounts, incomplete pagination, duplicate account IDs,
currency contradictions, invalid balances, missing or mismatched portfolio
scope, and ambiguous portfolios produce `REVIEW`. Complete evidence showing
that the funding asset is not held, the balance is insufficient, or the
account platform is unsupported produces `BLOCK`.

## Product, market, Preview, and freshness

The normalized market record binds pair, assets, product type, increments,
min/max sizes, best bid and ask, the Coinbase pricebook observation time,
status, and required trading flags.

- Missing, malformed, mismatched, crossed, or contradictory product/BBO facts
  produce `REVIEW`.
- A verified non-SPOT, offline, disabled, trading-disabled, view-only,
  cancel-only, post-only, or auction product produces `BLOCK`.
- `limit_only` is recorded but is not itself a block because the supported
  action is a limit IOC order.

The allowlisted Preview facts are:

```text
order_total
commission_total
quote_size
base_size
est_average_filled_price
best_bid
best_ask
preview_id
errs[]
warning[]
```

The controller checks that:

- Preview BBO is positive, uncrossed, and within 50 bps of the trusted BBO;
- quote/base implied price agrees with average fill price within 5 bps;
- order total, quote size, and commission agree within one quote increment;
- Preview side/size equals the exact proposal;
- BUY slippage uses best ask and SELL slippage uses best bid;
- the optional market condition still holds; and
- commission and side-specific settlement stay inside the mandate.

Missing/malformed Preview data, a provider `errs` entry, invalid economics,
BBO drift, a missing Preview ID, or an invalid warning shape means the facts
cannot be trusted and produces `REVIEW`. A nonempty valid warning array also
produces `REVIEW`. Verified side/size, market-condition, slippage, commission,
or settlement violations produce `BLOCK`.

The capability profile currently allows at most 5,000 ms from the Coinbase BBO
observation time and 10,000 ms from local Preview receipt. The proposal is
valid for at most 30 seconds and never beyond the authorized policy. The
preflight expiry is the earliest of policy expiry, proposal expiry, BBO expiry,
and Preview expiry. It is rechecked immediately before a View-only PASS.

Source provenance is explicit:

- BBO uses `COINBASE_PRICEBOOK_TIME`;
- accounts and product use local request/receipt times because those responses
  do not supply the bound provider observation time used by this harness; and
- Preview uses local request/receipt time.

Those source times are bound into the preflight fingerprint. A stored API fact
is not independently authenticated by the receipt.

## Exact Preview and prospective Create binding

After funding, product, market, proposal, and Preview checks pass, the
controller:

1. serializes the exact Preview request with `JSON.stringify`;
2. hashes those UTF-8 bytes;
3. in `view_only_preflight`, requires the adapter's POST host, path, method,
   and sent-body digest to match;
4. fingerprints the allowlisted normalized Preview response;
5. constructs, but cannot transmit, one prospective Create body; and
6. hashes the prospective Create UTF-8 bytes.

The prospective body contains exactly:

```text
client_order_id
product_id
side
order_configuration.sor_limit_ioc
preview_id
```

Its IOC configuration contains BUY `quote_size` or SELL `base_size`, plus
`limit_price`. The preflight fingerprint binds:

```text
mode
nonce_digest
policy_digest
action_descriptor_digest
proposal_digest
preview_request_digest
preview_transport_body_digest
preview_response_fingerprint
evidence_digest
prospective_create_payload_digest
accounts/product/BBO/Preview source times
```

Changing any order-relevant field, the selected Preview facts, or a bound
source time changes the fingerprint and invalidates the old exact result.

The `dry_run` path additionally freezes
`delta.coinbase.evaluation_request.v2`, which contains the policy, action,
proposal, normalized evidence, exact Preview object, prospective Create bytes,
and their digests before calling the simulated Delta adapter.

## Guard receipt and verification

Both modes and all typed failure paths return
`delta.coinbase.guard_receipt.v1`. It contains:

- mode, issued/expiry times, nonce digest, provenance, and no-order boundary;
- the plain `PASS`, `BLOCK`, or `REVIEW` decision, one reason, recovery action,
  and decision digest;
- recomputable policy, proposal, normalized-evidence, Preview-request,
  prospective-Create, preflight, and authorization digests;
- a completeness label; and
- a digest of the complete receipt.

For an early failure, unavailable fields receive deterministic placeholder
digests and `binding_completeness` is
`PARTIAL_UNAVAILABLE_EVIDENCE`; the receipt does not pretend that a proposal or
external evidence was checked.

`verifyGuardReceipt(receipt, record)`:

1. recomputes the receipt digest;
2. requires receipt, record, and boundary modes to agree;
3. recomputes each binding from underlying record content rather than trusting
   stored digest fields;
4. re-fingerprints selected Preview facts and the decision; and
5. verifies the execution-record digest when present.

This verifier establishes local tamper evidence for that receipt/record pair.
It does not check whether the receipt is still current, authenticate a stored
Coinbase response independently, or turn the receipt into a production Delta
signature. Currentness is a separate history check.

The receipt proof classes are deliberately narrow:

```text
dry_run             → LOCAL_SIMULATION_DIGEST
view_only_preflight → LOCAL_INTEGRITY_DIGEST_OVER_NORMALIZED_VIEW_ONLY_FACTS
```

Both carry the same limitation: local SHA-256 integrity evidence, not a
production Delta signature and not independent authentication of Coinbase
data.

## History, nonce replay, and supersession

When history is enabled, the Guard writes immutable
`delta.coinbase.dry_run_history.v1` entries under:

```text
${XDG_STATE_HOME:-$HOME/.local/state}/delta/coinbase-guard/history
```

The directory must be user-owned mode `0700`; files must be regular,
user-owned mode `0600`. Symlinks, foreign ownership, and unexpected
permissions are rejected. The store keeps at most 100 entries and can be
cleared explicitly.

History retains only:

- a closed-policy summary and policy/source-intent digests;
- a compact proposal summary and digest;
- outcome, reason, recovery, mode, provenance, evidence time/age/fingerprint;
- no-order state; and
- local receipt, nonce, semantic, supersession, and integrity digests.

It excludes raw credentials, key or account IDs, headers, raw Coinbase bodies,
and remote telemetry.

Nonce claims and results are created atomically in the same private directory:

- the same nonce plus the identical semantic digest can return its prior
  current history result;
- the same nonce with a different plan, authorization, mode, or credential
  scope produces `BLOCK`;
- a concurrent identical nonce waits up to five seconds for the single result,
  then returns `REVIEW` if it is still pending; and
- an expired, missing, or superseded prior result returns `REVIEW`, not current
  eligibility.

A newer entry in the same authorization/credential scope whose preflight
fingerprint differs records the older receipt digest as superseded. Because
the fingerprint includes the nonce, a fresh run with a new nonce normally
becomes the current result even if market values did not move.

`assertReceiptActiveInHistory` checks expiry, exact local presence, nonce and
expiry agreement, and later supersession. `verifyGuardReceipt` alone does not
perform this currentness check. This local mechanism is not the durable,
transactional one-time grant required for production execution.

## Delta proof seam

Only `dry_run` invokes the checked-in simulated Delta adapter. Its proof and
signature are explicit placeholders; its v3 decision receipt reports
`cryptographically_verified: false` and
`SIMULATED_BINDING_CHECK_ONLY`.

The simulated/production-shaped Delta seam expects these nine nonempty
Coinbase bindings:

```text
product_id
action_descriptor_digest
authorized_limit_price
funding_evidence_digest
preview_id
create_payload_digest
preview_request_digest
portfolio_fingerprint
credential_fingerprint
```

Production `PASS` would additionally require authenticated authorization,
actual Delta evaluation, exact proof-artifact verification, and a pinned
verifier identity and proof program. None is claimed by the public Guard
receipt. `view_only_preflight` stops before this seam.

## Gate and pre-live acceptance

In `dry_run`, only the simulated exact `PASS` can consume the in-memory
simulation gate and end at `EXECUTION_ELIGIBLE`. In
`view_only_preflight`, deterministic exact `PASS` ends at
`PREVIEW_PROBE_PASS`; no execution eligibility or Delta decision is created.
`BLOCK`, `REVIEW`, expiry, infrastructure failure, tamper, replay mismatch, and
binding mismatch stay locked.

Before Coinbase Create can be enabled, engineering must still validate:

- live permission, pagination, product, BBO, and Preview semantics;
- provider observation/freshness semantics for every relied-on endpoint;
- exact Preview/Create and Preview-ID behavior across BUY/SELL pairs;
- private Delta policy, authorization, status, signer, verifier, proof
  program, and all nine bindings;
- authenticated append-only evidence storage;
- a durable transactional one-time grant and isolated executor; and
- uncertain-submission reconciliation by `client_order_id`.

Until then, credentialed use ends at reads and Preview. No public path submits
an order, reconciles a fill, or reports an exchange outcome.
