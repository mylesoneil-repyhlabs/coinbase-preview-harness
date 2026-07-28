# Coinbase v1.3 policy and evidence contract

This document describes the checked-in generic SPOT BUY/SELL contract. The
implementation is deterministic and production-shaped, but its Delta policy,
signing, evidence, proof, and receipt are simulated. It has not been validated
against the private Delta Mandate codebase.

The primary files are:

- `src/spot-action.js`;
- `src/funding.js`;
- `src/mandate/coinbase-policy.js`;
- `src/mandate/coinbase-solution.js`;
- `src/mandate/coinbase-evidence.js`;
- `src/mandate/contract.js`; and
- `src/mandate/controller.js`.

## Authorized policy parameters

`buildCoinbasePolicyBundle` maps the human-authorized v1.3 plan into these
parameters:

| Parameter | Type | Meaning |
| --- | --- | --- |
| `product_id` | string | Exact Coinbase SPOT pair |
| `base_asset` | string | Exact base asset |
| `quote_asset` | string | Exact quote asset |
| `side` | string | `BUY` or `SELL` |
| `size_field` | string | `quote_size` for BUY; `base_size` for SELL |
| `exact_size_value` | decimal string | Exact authorized side-specific size |
| `funding_asset` | string | Quote asset for BUY; base asset for SELL |
| `max_slippage_bps` | integer | Maximum adverse slippage in basis points |
| `max_commission_value` | decimal string | Maximum commission in quote asset |
| `settlement_kind` | string | `MAX_QUOTE_DEBIT` or `MIN_NET_QUOTE_PROCEEDS` |
| `settlement_value` | decimal string | Side-specific debit ceiling or net-proceeds floor |
| `action_descriptor_digest` | string | Digest of the complete canonical action |
| `portfolio_fingerprint` | string | Bound Coinbase portfolio |
| `credential_fingerprint` | string | Bound key identity |
| `expires_at_epoch_ms` | integer | Absolute evaluation deadline |

Amounts are canonical decimal strings, not floating-point numbers and not a
universal microunit integer. That distinction is required for base assets whose
valid Coinbase increment has more than six decimal places.

The checked-in source is `coinbase_spot_order_v2` with policy kind
`coinbase_spot_v2`. It is a narrow simulator contract pending validation of the
private Delta engine's actual syntax and type mapping.

## Canonical action descriptor

`delta.coinbase.spot_action.v1` is the authorization-level action description.
Its digest covers:

- Coinbase Advanced and the custodial-ledger execution domain;
- product ID, SPOT type, and exact base/quote assets;
- side;
- SOR limit IOC and partial-fill policy;
- exact size field, denomination, asset, and value;
- held-balance funding source, required amount, and
  `conversion_allowed: false`;
- fresh price reference and side-specific price direction;
- slippage, commission, and settlement limits; and
- one execution with the authorized validity start and TTL.

The descriptor is regenerated and compared at planning, proposal, solution
parsing, Delta parameter construction, and proof binding. A field addition,
deletion, or mutation changes its digest.

## Trusted input ownership

| Data | Simulation authority | Required production authority |
| --- | --- | --- |
| Closed policy and action descriptor | Compiler plus explicit digest confirmation | Authenticated user approval / signer |
| Product metadata and flags | Labeled fixture | Fresh Coinbase Get Product |
| Best bid and ask | Labeled fixture | Fresh authenticated Coinbase market read |
| Funding accounts | Labeled fixture | Complete authenticated List Accounts response |
| Preview economics and `preview_id` | Labeled fixture | One authenticated Coinbase Preview |
| Credential and portfolio fingerprints | Simulator attestation | Fresh key-permission verification |
| Delta decision and proof | Simulated adapter | Actual Delta evaluation and independent Verifier |
| One-use grant | In-memory test double | Isolated transactional store |

An agent-authored proposal is never authoritative evidence. In production, the
trusted controller gathers Coinbase responses, normalizes them, and freezes one
immutable action record before invoking Delta.

## Funding evidence

`delta.coinbase.funding_evidence.v1` contains:

```text
portfolio_fingerprint
funding_asset
required_available
available_balance
account_fingerprints[]
complete
evidence_digest
```

The account list must be complete. Only active, ready, non-deleted accounts
whose available-balance currency exactly matches the required asset contribute.
Account fingerprints commit account UUID, currency, platform, and retail
portfolio ID without copying those identifiers into the decision receipt.

For a BUY, required available funds equal the authorized maximum quote debit.
For a SELL, required available funds equal the exact base size. USD and USDC,
and every other asset symbol, remain distinct. The guard never substitutes or
converts a different balance.

Missing, malformed, incomplete, or insufficient funding evidence is `BLOCK`
before Coinbase Preview or Delta evaluation.

## Market and Preview evidence

The normalized market record includes the exact pair and assets; Coinbase
increments and min/max size bounds; best bid and ask; observation time; status;
and product flags. The pipeline rejects a non-SPOT, offline, disabled,
trading-disabled, view-only, cancel-only, post-only, or auction product. It also
rejects malformed or stale data and contradictory bounds.

The selected Preview record contains only:

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

The [Coinbase Preview reference](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/preview-orders)
documents the response's errors, warnings, estimates, and `preview_id`.
The local decision rule is:

- nonempty `errs` → `BLOCK`;
- malformed fields or violated policy economics → `BLOCK`;
- nonempty `warning` → `REVIEW` and stop; and
- otherwise → `PASS`.

The simulation solution accepts only a Preview that has empty errors and
warnings. A `REVIEW` is intentionally not submitted to the simulated Delta
adapter.

The guard derives adverse slippage instead of trusting Coinbase's optional
self-reported slippage summary:

- BUY compares estimated fill price to fresh best ask; and
- SELL compares estimated fill price to fresh best bid.

Only movement adverse to the user counts, and fractional basis points round up.

Settlement is also side-specific:

```text
BUY  = max(order_total, requested quote_size + commission_total)
SELL = min(order_total, Preview quote_size) - commission_total
```

The BUY result must not exceed `MAX_QUOTE_DEBIT`; the SELL result must not fall
below `MIN_NET_QUOTE_PROCEEDS`.

## Evidence attributes evaluated by the simulator

`extractSimulatedCoinbaseEvidence` deterministically derives the flat evidence
consumed by `coinbase_spot_order_v2`:

| Group | Fields |
| --- | --- |
| Domain | `category`, `environment`, `execution_domain` |
| Instrument | `product_id`, `base_asset`, `quote_asset`, `side` |
| Order | `order_type`, `time_in_force`, `size_field`, `size_value`, `limit_price` |
| Economics | `slippage_bps`, `slippage_within_limit`, `commission_value`, `commission_within_limit`, `settlement_kind`, `settlement_value`, `settlement_within_limit` |
| Funding | `funding_asset`, `funding_available`, `funding_required`, `funding_evidence_digest`, `funding_sufficient` |
| Authorization | `action_descriptor_digest`, `portfolio_fingerprint`, `credential_fingerprint`, `evaluated_at_epoch_ms` |
| Preview binding | `preview_id`, `preview_present`, `create_preview_id`, `preview_request_matches_create` |
| Payload binding | `create_payload_digest`, `claimed_create_payload_digest`, `preview_request_digest`, `claimed_preview_request_digest` |
| Product state | `market_status`, `trading_disabled`, `product_disabled`, `view_only` |

The simulator labels the evidence execution target as `production` because the
policy describes the prospective Coinbase production action. That label does
not make the fixtures or Delta evaluation production evidence; the receipt
separately declares `artifact_class: SIMULATED_DELTA_CONTRACT`.

## Frozen action record

After local proposal, funding, and Preview checks pass, the controller creates
`delta.coinbase.evaluation_request.v2`. It includes:

- source-intent, plan, policy, authorization, and action-descriptor bindings;
- the proposal and its digest;
- normalized market, Preview, and funding evidence plus collection time;
- an evidence digest;
- the exact Preview request and digest;
- the exact prospective Create object;
- its serialized UTF-8 JSON bytes and SHA-256 digest; and
- credential and portfolio fingerprints.

The prospective Create payload has the exact field set:

```text
client_order_id
product_id
side
order_configuration.sor_limit_ioc
preview_id
```

`sor_limit_ioc` contains `quote_size` plus `limit_price` for BUY, or
`base_size` plus `limit_price` for SELL. Supplying both size fields, neither
field, an unknown field, or a different order type is rejected.

Coinbase publicly documents both `client_order_id` and `preview_id` in its
[Create Order request](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/create-order).
The public build constructs this payload for binding tests but cannot transmit
it.

## Simulation solution

The simulator uses:

```text
coinbase-advanced://order/v2/{create-payload-sha256}?envelope={base64url-canonical-json}
```

The strict canonical envelope binds:

- the complete action descriptor;
- exact Create object and serialized bytes;
- Create-body digest;
- exact Preview request and digest; and
- claimed market, Preview, funding, collection-time, portfolio, and credential
  evidence.

The parser rejects an unknown version, noncanonical encoding, missing or extra
field, malformed decimal or timestamp, digest mismatch, BUY/SELL size mismatch,
incomplete funding, nonempty Preview errors/warnings, or evidence mismatch.

This envelope is an inspectable simulation fixture, not a trusted production
evidence channel.

## Production action locator

The production-shaped adapter instead requires an authenticated action registry
to return:

```text
coinbase-order://proposal/v1/{sha256-of-canonical-action-record}
```

The registry recomputes the digest, stores the record append-only, and returns
the same digest and locator. The evidence service resolves that immutable
record with read-only access and derives the requested evidence itself. It must
not trust the agent, accept the simulation envelope, or issue a second Preview.

The locator digest binds the complete action record. The
`create_payload_digest` separately binds the bytes intended for Coinbase.
Neither substitutes for the other.

## Delta proof and decision receipt

The local controller requires the Delta Verifier result, signed-intent fields,
proposal solution, and proof to match the authorized intent. The proof evidence
must contain exactly these nonempty string bindings:

```text
product_id
action_descriptor_digest
funding_evidence_digest
preview_id
create_payload_digest
preview_request_digest
portfolio_fingerprint
credential_fingerprint
```

`delta.coinbase.decision_receipt.v2` then binds:

- `PASS`, `BLOCK`, or `REVIEW`;
- policy and intent IDs;
- action-descriptor, exact-payload, evidence, and proof digests;
- indexed constraint failures;
- whether verification succeeded; and
- the receipt digest.

In this repository, that is a deterministic SHA-256 integrity receipt over a
simulated Delta contract. The simulator uses placeholder proof and signature
material. It is not a production Delta signature, SP1 proof, Coinbase
attestation, authenticated signer identity, or independent source-authenticity
guarantee.

Only `PASS` with verified proof material is eligible for the controller's
`EXECUTE` disposition. `BLOCK` can be retryable only when it carries explicit
constraint failures and an attempt remains. `REVIEW`, expiry, infrastructure
failure, proof mismatch, or unknown state stops.

## Pre-live shadow requirements

Before Create can be enabled, engineering must use isolated credentials to pin:

- live key-permission response fields;
- List Accounts pagination and balance semantics;
- runtime product flags, increments, and size bounds across multiple pairs;
- BUY and SELL Preview field and settlement behavior;
- Preview ID freshness, reuse, and exact Create matching;
- warning and error handling;
- `client_order_id` uniqueness and uncertain-submission recovery; and
- every digest and proof binding against the actual private Delta runtime.

Until those checks, the supported external endpoint is credentialed reads and
Preview followed by stop.
