# Coinbase policy and evidence contract

The checked-in V1 policy source lives in
`src/mandate/coinbase-policy.js`. It deliberately uses the vocabulary on
current Delta main:

- `parameters { ... }`;
- `parameters.<name>`;
- a fixed category constraint; and
- only boolean, signed-integer, and string evidence.

The production source of truth must be one `SchemaSpec` in
`CoinbaseSpotHooks`, following the existing `kalshi_wc26.rs` pattern. It should
derive both the policy-engine `EvidenceSchema` and the evidence-service
`ExtractionSchema` from the same field declarations.

## Parameters authorized by the user

| Field | Type | Unit or meaning |
| --- | --- | --- |
| `product_id` | string | Exact Coinbase product |
| `base_asset` | string | Exact base asset |
| `quote_asset` | string | Exact quote asset |
| `side` | string | Exact side |
| `exact_quote_size_microunits` | int | Quote asset × 1,000,000 |
| `max_slippage_bps` | int | Basis points |
| `max_commission_microunits` | int | Quote asset × 1,000,000 |
| `max_all_in_debit_microunits` | int | Quote asset × 1,000,000 |
| `portfolio_fingerprint` | string | Authorized portfolio binding |
| `credential_fingerprint` | string | Authorized execution-key binding |
| `expires_at_epoch_ms` | int | Trusted absolute deadline |

These become the `attrs` of a Delta `Intent` using the policy-engine
`ObjectValue` wire representation. No float crosses this boundary.

## V1 evidence schema

| Field | Type | Production authority |
| --- | --- | --- |
| `category` | string enum | `CoinbaseSpotHooks`, fixed to `COINBASE_ADVANCED_SPOT_ORDER` |
| `environment` | string enum | Trusted action registry/executor |
| `execution_domain` | string enum | Trusted action registry/executor |
| `product_id` | string | Exact frozen Create body |
| `base_asset`, `quote_asset` | string | Fresh Coinbase product response |
| `side` | string enum | Exact frozen Create body |
| `order_type`, `time_in_force` | string enum | Exact frozen order configuration |
| `quote_size_microunits` | int | Exact frozen order configuration |
| `limit_price_microunits` | int | Exact frozen order configuration |
| `slippage_bps` | int | Trusted Preview versus trusted market snapshot |
| `commission_microunits` | int | Trusted Coinbase Preview |
| `all_in_debit_microunits` | int | Exact-decimal `max(order_total, quote_size + commission_total)` |
| `portfolio_fingerprint` | string | Trusted action registry and Coinbase account binding |
| `credential_fingerprint` | string | Trusted executor registration |
| `evaluated_at_epoch_ms` | int | Evidence-service clock |
| `preview_id`, `create_preview_id` | string | Trusted Preview and exact Create body |
| `preview_present` | bool | Derived, never defaulted |
| `preview_request_matches_create` | bool | Extractor recomputation |
| `create_payload_digest` | string | Extractor hash of exact serialized Create bytes |
| `claimed_create_payload_digest` | string | Immutable solution/action-record binding |
| `preview_request_digest` | string | Extractor hash of request derived from Create |
| `claimed_preview_request_digest` | string | Immutable solution/action-record binding |
| `market_status` | string enum | Fresh Coinbase product response |
| `trading_disabled`, `product_disabled` | bool | Fresh Coinbase product response |

The hook may include `limit_price_microunits` for receipts and future policy
versions even though the V1 policy controls price through the independently
derived slippage cap.

Coinbase's optional self-reported `slippage` field is deliberately excluded
from the canonical evidence envelope. V1 derives `slippage_bps` from the
trusted Preview `est_average_filled_price` and the independently fetched fresh
market `best_ask`; it never trusts the venue's optional summary value.

There is intentionally no `usage_index` evidence constraint. Current Delta
`ExtractionRequest` provides the solution and requested attributes, not the
intent ID needed to establish attempt/use count. Replay prevention remains in
Orchestrator proposal state and the executor's single atomic execution-grant
record unless
engineering introduces a trusted attempt registry.

## Solution format

The simulator uses:

```text
coinbase-advanced://order/v1/{create-payload-sha256}?envelope={base64url-canonical-json}
```

The envelope is strict, versioned, and canonical. It binds:

- the exact Create object;
- the exact serialized Create bytes;
- their SHA-256 digest;
- the Preview request and digest; and
- simulator-only evidence claims.

This embedded envelope is simulation-only. Production uses:

```text
coinbase-order://proposal/v1/{sha256-of-canonical-action-record}
```

`prepareProposal({ actionRecord })` sends the closed
`delta.coinbase.evaluation_request.v1` record to an authenticated trusted action
registry. The registry recomputes `digest(actionRecord)`, stores the record
append-only under that digest, and must return exactly:

```json
{
  "solution": "coinbase-order://proposal/v1/<action-record-digest>",
  "action_record_digest": "<action-record-digest>"
}
```

The trusted executor has already called Coinbase Preview once, frozen its
Preview ID into the exact Create bytes, and included the Preview response and
market snapshot in the action record. The production extractor resolves that
same immutable record and must not call Preview again. It verifies trusted
registration provenance, exact field sets, freshness, Preview/Create
consistency, market state, and every digest; then it derives the flat evidence
with deterministic exact-decimal logic. It never treats an agent-authored claim
or the simulation envelope as production evidence.

The locator digest binds the whole action record. The separate
`create_payload_digest` binds the exact UTF-8 Coinbase Create body. Both are
required and must not be conflated.

## Proof-to-execution binding

The current SP1 public values commit the policy ID, parameter hash, and evidence
hash, but not the proposal directly. Therefore V1 requires all of the following:

1. exact Create digest is independently extracted evidence;
2. the policy constrains the relevant digest/Preview consistency booleans and
   equalities;
3. Verifier outcome and Proof carry the exact submitted proposal, intent ID,
   policy ID, and typed intent attributes;
4. the controller requires the exact six-field Proof binding set: product ID,
   Preview ID, Create-body digest, Preview-request digest, portfolio
   fingerprint, and credential fingerprint;
5. the executor recomputes the outgoing Create-body digest immediately before
   submission; and
6. the Coinbase transport returns the digest of the body bytes it actually
   sent. A missing or mismatched transport digest is
   `SUBMISSION_UNCERTAIN`.

The local controller checks proof presence and binding equality. Cryptographic
SP1 verification is performed by the independent Verifier.

Adding the proposal hash directly to SP1 public values remains the stronger
long-term hardening described in `ENGINEERING-HANDOFF.md`.

## Coinbase Preview behavior to verify in shadow

The public [Preview Order](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/preview-orders)
and [Create Order](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/create-order)
references expose the Preview response and `preview_id` input but do not define
all lifecycle guarantees this integration needs. Before live execution,
engineering must empirically pin Preview ID freshness, reuse, Create-payload
matching, and error behavior in the shadow suite. The harness remains
fail-closed with a short local freshness window and never requests a second
Preview for the same candidate.
