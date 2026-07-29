# Coinbase v1.4 policy and evidence contract

This document describes the checked-in generic Coinbase Advanced SPOT BUY/SELL
contract. Its deterministic controller is production-shaped, but Coinbase
responses, Delta policy execution, signing, and proof are simulated in the
credential-free path. The private Delta Mandate codebase has not been
available for compatibility validation.

Primary files:

- `config/coinbase-spot-policy.v3.schema.json`;
- `src/spot-action.js`;
- `src/funding.js`;
- `src/execution-policy.js`;
- `src/mandate/coinbase-policy.js`;
- `src/mandate/coinbase-evidence.js`;
- `src/mandate/contract.js`; and
- `src/mandate/controller.js`.

## Authorized v3 policy

`buildCoinbasePolicyBundle` maps the user-authorized plan into:

| Parameter | Meaning |
| --- | --- |
| `product_id`, `base_asset`, `quote_asset`, `side` | Exact SPOT instrument and BUY/SELL side |
| `size_field` | `quote_size` for BUY; `base_size` for SELL |
| `size_operator`, `size_value` | `EXACT` equality or positive size no greater than `MAX` |
| `funding_asset` | Quote asset for BUY; base asset for SELL |
| `max_slippage_bps` | Maximum adverse movement from the fresh side-correct BBO |
| `max_commission_value` | Maximum commission in quote asset |
| `settlement_kind`, `settlement_value` | BUY maximum quote debit or SELL minimum net quote proceeds |
| `market_condition_reference`, `operator`, `value` | Optional one-shot best-ask/best-bid absolute threshold |
| `action_descriptor_digest` | Digest of the complete canonical action |
| `portfolio_fingerprint`, `credential_fingerprint` | Bound Coinbase authority |
| `expires_at_epoch_ms` | Absolute evaluation deadline |

Amounts are canonical decimal strings, not floating-point numbers or universal
microunits.

The source is `coinbase_spot_order_v3`, policy kind `coinbase_spot_v3`.
Concrete syntax and types remain a simulator contract until checked against
private Delta.

## Canonical action descriptor

`delta.coinbase.spot_action.v2` binds:

- Coinbase Advanced custodial-ledger domain and exact SPOT pair;
- BUY or SELL;
- SOR limit IOC and partial-fill policy;
- side-correct size field, denomination, asset, `EXACT`/`MAX`, and value;
- held-balance funding source and `conversion_allowed: false`;
- fresh BBO reference and adverse side-specific limit direction;
- optional one-shot market condition;
- slippage, commission, and settlement limits; and
- one execution with validity start and TTL.

The condition may be:

```text
BUY  → BEST_ASK AT_OR_BELOW <absolute quote-asset price>
SELL → BEST_BID AT_OR_ABOVE <absolute quote-asset price>
```

It is evaluated once from fresh trusted market and Preview evidence. It does
not create a resting order or monitoring service.

Any field mutation changes the descriptor digest. The descriptor is regenerated
and compared across planning, proposal, solution parsing, policy parameters,
evidence, and proof.

## Trusted input ownership

| Data | Simulation authority | Production authority |
| --- | --- | --- |
| Policy and action descriptor | Compiler plus procedural digest confirmation | Authenticated user approval and signer |
| Product metadata and BBO | Labeled fixture | Fresh authenticated Coinbase REST read |
| Funding accounts | Labeled complete account fixture | Complete paginated List Accounts response |
| Preview economics and ID | Labeled fixture | Authenticated Coinbase Preview |
| Credential and portfolio | Simulator attestation | Fresh key-permission verification |
| Delta outcome and proof | Simulated adapter | Actual Delta evaluation and pinned cryptographic Verifier |
| One-use gate | In-memory simulation token | Isolated transactional durable grant |

The agent's proposal is never authoritative market, balance, Preview, user, or
proof evidence.

## Funding evidence

`delta.coinbase.funding_evidence.v1` contains portfolio fingerprint, funding
asset, required and available amounts, contributing account fingerprints,
completeness, and evidence digest.

The account list must explicitly be complete. Duplicate account IDs, malformed
balances, missing pagination state, conflicting portfolios, and insufficient
funds fail closed. Only active, ready, non-deleted retail accounts with an
exactly matching available-balance currency contribute.

- BUY requires held quote asset sufficient for the authorized maximum quote
  debit.
- SELL requires held base asset sufficient for the authorized size cap.

USD, USDC, and every other asset remain distinct. No implicit conversion or
portfolio transfer is allowed.

## Product, market, and Preview evidence

The normalized market record binds pair, assets, product type, increments,
min/max sizes, best bid and ask, observation time, status, and trading flags.
The controller rejects non-SPOT, offline, disabled, view-only, cancel-only,
post-only, auction, malformed, stale, crossed, or contradictory data.

The Preview record is allowlisted to:

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

The controller does not trust Preview summaries blindly. It checks:

- Preview BBO is positive, uncrossed, and within 50 bps of the trusted market
  snapshot;
- quote/base implied price agrees with estimated average fill price within
  5 bps;
- order total is coherent with quote size and commission within one quote
  increment;
- BUY slippage is derived from fresh best ask and SELL slippage from fresh best
  bid;
- the optional absolute BBO condition is satisfied in trusted and Preview
  evidence; and
- side-specific settlement stays within the authorized bound.

Decision rules:

- nonempty `errs` or malformed/incoherent economics → `BLOCK`;
- nonempty `warning` after otherwise passing → `REVIEW`; and
- otherwise → local `PASS`.

The [Coinbase Preview reference](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/preview-orders)
documents the external response surface.

## Frozen evaluation request

After local proposal, funding, and Preview checks pass, the controller freezes
`delta.coinbase.evaluation_request.v2` with:

- source intent, plan, policy, authorization, and action descriptor;
- side-specific proposal and its digest;
- normalized market, Preview, and complete funding evidence;
- authorized limit price and evidence digest;
- exact Preview request and digest;
- prospective Coinbase Create object;
- serialized UTF-8 Create bytes and SHA-256 digest; and
- credential and portfolio fingerprints.

The prospective Create body has exactly:

```text
client_order_id
product_id
side
order_configuration.sor_limit_ioc
preview_id
```

The IOC configuration contains `quote_size` and `limit_price` for BUY, or
`base_size` and `limit_price` for SELL. The public build constructs those bytes
only for exact binding and cannot transmit them.

## Simulation and production proposal locators

The simulator uses a strict canonical envelope:

```text
coinbase-advanced://order/v2/{create-payload-sha256}?envelope={base64url-canonical-json}
```

It binds the descriptor, exact prospective Create bytes, Preview request,
digests, and labeled evidence. The parser rejects unknown fields, noncanonical
encoding, malformed values, digest mismatch, side/size mismatch, incomplete
funding, Preview errors/warnings, and evidence mismatch.

Production instead requires an authenticated registry locator:

```text
coinbase-order://proposal/v1/{sha256-of-canonical-action-record}
```

The registry is append-only and controller-written. The evidence service must
resolve it read-only and derive evidence independently. The simulation envelope
is never a production evidence channel.

## Proof and receipt

The proof must contain exactly these nonempty Coinbase bindings:

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

The controller also matches signed intent, policy ID, typed attributes, and
proposal solution.

`delta.coinbase.decision_receipt.v3` binds decision, IDs, action and payload,
Preview, funding, evidence, proof digest, proof-verification attestation,
complete constraint failures, and a receipt digest.

In simulation, the proof and signature are explicit placeholders. The local
adapter returns `cryptographically_verified: false` with method
`SIMULATED_BINDING_CHECK_ONLY`. The receipt proves deterministic local
integrity only.

Production `PASS` additionally requires an injected proof verifier to return
`cryptographically_verified: true`, the exact proof digest, and the pinned
verifier identity and proof program ID.

## Deterministic gate

Only an exact verified `PASS` can reach the internal controller's `EXECUTE`
branch. In the credential-free build, that branch:

1. rechecks exact payload and evidence bindings;
2. consumes one in-memory simulation gate; and
3. ends at `EXECUTION_ELIGIBLE`.

It does not call an executor, submit an order, reconcile a fill, or produce an
exchange outcome. `BLOCK`, `REVIEW`, expiry, infrastructure error, malformed
proof, and any mismatch stop.

## Pre-live acceptance

Before Coinbase Create can be enabled, engineering must pin:

- live permission and account pagination semantics;
- runtime product flags, increments, and bounds across multiple pairs;
- BUY/SELL Preview response and settlement behavior;
- BBO and Preview coherence tolerances against real responses;
- Preview ID freshness and exact Create matching;
- warning/error behavior and `client_order_id` recovery;
- private Delta policy, status, signer, verifier, proof program, and all nine
  proof bindings; and
- durable one-time grant atomicity and uncertain-submission recovery.

Until then, credentialed use ends at reads and Preview, and the simulation ends
at eligibility without execution.
