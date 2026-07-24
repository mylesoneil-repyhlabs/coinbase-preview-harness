# Proposed delta gate contract for Coinbase execution

This document specifies the client contract expected by the local Coinbase
execution harness. It is intentionally explicit so delta engineering can map
the harness to an existing evaluator or identify the smallest adapter needed.

> **Status:** proposed and locally test-covered. It has not been exercised
> against a production delta endpoint, production authorization token, or
> production signing key. The harness must remain in simulation until that
> mapping is reviewed and a credentialed Preview-only probe succeeds.

## Purpose

Coinbase Preview Order is evidence; it is not authorization. The delta gate
answers one question:

> Does this exact Coinbase Create Order payload satisfy the human-confirmed
> policy, using this fresh market and preview evidence, for this confirmed
> Coinbase credential and portfolio?

A positive answer is a single-use, short-lived capability. It does not allow
the executor to rewrite the order or create a different one.

## Transport

The harness sends:

```http
POST ${DELTA_GATE_URL}
Authorization: Bearer ${DELTA_GATE_TOKEN}
Content-Type: application/json
```

Requirements:

- `DELTA_GATE_URL` must use HTTPS.
- Redirects are rejected.
- Request timeout is 20 seconds.
- The response must be JSON and no larger than 256 KiB.
- Any network failure, non-2xx response, malformed JSON, or invalid decision
  blocks before Coinbase Create Order.

The bearer token is read from the environment and is not written to reports or
runtime state.

## Evaluation request

Schema version: `delta.coinbase.evaluation_request.v1`

Representative shape:

```json
{
  "schema_version": "delta.coinbase.evaluation_request.v1",
  "requested_at": "2026-07-23T18:00:00.000Z",
  "plan_id": "uuid",
  "execution_digest": "sha256",
  "execution_confirmed_at": "2026-07-23T17:59:00.000Z",
  "policy_expires_at": "2026-07-23T18:01:00.000Z",
  "source_intent_digest": "sha256",
  "policy": {
    "venue": "COINBASE_ADVANCED",
    "environment": "PRODUCTION",
    "execution_domain": "COINBASE_CUSTODIAL_LEDGER",
    "product_type": "SPOT",
    "product_id": "ETH-USDC",
    "base_asset": "ETH",
    "quote_asset": "USDC",
    "side": "BUY",
    "order_type": "SOR_LIMIT_IOC",
    "size": {
      "denomination": "QUOTE",
      "asset": "USDC",
      "operator": "EXACT",
      "value": "5"
    },
    "partial_fill_policy": "ALLOW",
    "limits": {
      "max_slippage_bps": 50,
      "max_commission": { "asset": "USDC", "value": "0.50" },
      "max_all_in_debit": { "asset": "USDC", "value": "5.50" }
    },
    "validity": {
      "starts": "ON_EXECUTION_CONFIRMATION",
      "ttl_seconds": 120
    },
    "usage": { "max_executions": 1 }
  },
  "policy_digest": "sha256",
  "proposal": {
    "schema_version": "delta.coinbase.proposal.v1",
    "proposal_id": "uuid",
    "created_at": "2026-07-23T18:00:00.000Z",
    "expires_at": "2026-07-23T18:00:30.000Z",
    "action": {
      "product_id": "ETH-USDC",
      "side": "BUY",
      "type": "limit",
      "time_in_force": "IOC",
      "quote_size": "5",
      "limit_price": "3015.00"
    },
    "proposal_digest": "sha256"
  },
  "proposal_digest": "sha256",
  "evidence": {
    "market": {
      "product_id": "ETH-USDC",
      "product_type": "SPOT",
      "base_asset": "ETH",
      "quote_asset": "USDC",
      "base_increment": "0.00000001",
      "quote_increment": "0.01",
      "price_increment": "0.01",
      "best_bid": "2999.00",
      "best_ask": "3000.00",
      "observed_at": "2026-07-23T18:00:00.000Z",
      "product_flags": {
        "is_disabled": false,
        "trading_disabled": false,
        "cancel_only": false,
        "limit_only": false,
        "post_only": false,
        "auction_mode": false
      }
    },
    "preview": {
      "order_total": "5.25",
      "commission_total": "0.25",
      "quote_size": "5",
      "base_size": "0.00166113",
      "est_average_filled_price": "3010.00",
      "best_bid": "2999.00",
      "best_ask": "3000.00",
      "slippage": "0.003333",
      "preview_id": "coinbase-preview-id",
      "errs": [],
      "warning": []
    },
    "collected_at": "2026-07-23T18:00:00.000Z"
  },
  "evidence_digest": "sha256",
  "preview_request": {
    "product_id": "ETH-USDC",
    "side": "BUY",
    "order_configuration": {
      "sor_limit_ioc": {
        "quote_size": "5",
        "limit_price": "3015.00"
      }
    }
  },
  "preview_request_digest": "sha256",
  "create_payload": {
    "client_order_id": "uuid",
    "product_id": "ETH-USDC",
    "side": "BUY",
    "order_configuration": {
      "sor_limit_ioc": {
        "quote_size": "5",
        "limit_price": "3015.00"
      }
    },
    "preview_id": "coinbase-preview-id"
  },
  "create_payload_serialized": "{\"client_order_id\":\"uuid\",\"product_id\":\"ETH-USDC\",\"side\":\"BUY\",\"order_configuration\":{\"sor_limit_ioc\":{\"quote_size\":\"5\",\"limit_price\":\"3015.00\"}},\"preview_id\":\"coinbase-preview-id\"}",
  "create_payload_digest": "sha256",
  "credential_binding": {
    "portfolio_fingerprint": "sha256",
    "credential_fingerprint": "sha256"
  }
}
```

Policy, proposal, preview-request, evidence, and execution digests are SHA-256
over the harness's canonical JSON representation. `create_payload_digest` is
different by design: it is SHA-256 over the UTF-8 bytes in
`create_payload_serialized`, which is the exact string passed as Coinbase's
HTTP request body. The bridge must also parse that string and require it to
match `create_payload`. It must not replace `client_order_id`, `preview_id`, or
the Create payload. It evaluates that exact action and returns the expected
bindings below.

## Signed decision

Schema version: `delta.coinbase.decision.v1`

The response is a closed object with exactly these top-level fields:

```json
{
  "schema_version": "delta.coinbase.decision.v1",
  "decision_id": "uuid",
  "decision": "ALLOW",
  "evaluated_at": "2026-07-23T18:00:01.000Z",
  "expires_at": "2026-07-23T18:00:11.000Z",
  "bindings": {
    "plan_id": "uuid",
    "execution_digest": "sha256",
    "execution_confirmed_at": "2026-07-23T17:59:00.000Z",
    "policy_expires_at": "2026-07-23T18:01:00.000Z",
    "policy_digest": "sha256",
    "proposal_digest": "sha256",
    "evidence_digest": "sha256",
    "create_payload_digest": "sha256",
    "portfolio_fingerprint": "sha256",
    "credential_fingerprint": "sha256",
    "client_order_id": "uuid",
    "preview_id": "coinbase-preview-id"
  },
  "checks": [
    { "id": "policy.product", "result": "PASS" },
    { "id": "policy.size", "result": "PASS" },
    { "id": "policy.economics", "result": "PASS" },
    { "id": "policy.validity", "result": "PASS" }
  ],
  "reason_codes": [],
  "authorization": {
    "algorithm": "Ed25519",
    "key_id": "delta-signing-key-id",
    "audience": "delta-coinbase-executor",
    "jti": "unique-single-use-id",
    "signature": "base64url-ed25519-signature"
  }
}
```

The response is accepted only when:

- `decision` is exactly `ALLOW`;
- every binding exactly equals the locally calculated value;
- `checks` is non-empty and every named result is exactly `PASS`;
- `reason_codes` is empty;
- `evaluated_at` and `expires_at` are valid and ordered;
- the decision is currently unexpired and its total lifetime is at most 30
  seconds;
- `authorization.algorithm` is `Ed25519`;
- `authorization.audience` is `delta-coinbase-executor`;
- `authorization.key_id` matches `DELTA_DECISION_KEY_ID` when that optional pin
  is configured;
- `authorization.jti` is present and has not been consumed; and
- the signature verifies using `DELTA_DECISION_PUBLIC_KEY_FILE`.

The signature is calculated over canonical JSON for the complete decision with
`authorization.signature` replaced by an empty string. Any unknown, missing,
or mismatched decision field fails closed.

## Binding semantics

The binding set prevents four classes of substitution:

1. **Intent, policy, or validity substitution:** `plan_id`,
   `execution_digest`, `execution_confirmed_at`, `policy_expires_at`, and
   `policy_digest`.
2. **Agent-action substitution:** `proposal_digest`.
3. **Evidence substitution:** `evidence_digest` and `preview_id`.
4. **Execution substitution:** `create_payload_digest`, `client_order_id`,
   `portfolio_fingerprint`, and `credential_fingerprint`.

The executor compares all bindings to values calculated locally; it does not
trust values echoed by the bridge.

## One-time use and failure behavior

Immediately before Create Order, the executor records both through sequential
exclusive file-creation writes:

- the human-confirmed `plan_id`; and
- the signed delta authorization `jti`.

Exclusive file creation makes either identifier one-time-use in this local
single-process harness. These two writes are not a transaction or a
crash-durable database commit: if the second write fails, the plan remains
consumed and Create stays blocked. A reused identifier also blocks.

Failures before those grants are consumed are `BLOCKED` and do not invoke
Create Order. Once the grants are consumed and a Create request is attempted,
a timeout, transport error, or malformed/unbound response becomes
`SUBMISSION_UNCERTAIN`. That state must be reconciled using the existing
`client_order_id`; it must never trigger a new order with a fresh ID.
The harness persists the exact payload and exposes a read-only
`reconcile-execution` command that scans Coinbase List Orders for that client
ID, then reruns Get Order and List Fills validation. It cannot call Create.

After Coinbase accepts the Create request, the harness calls Get Order and
List Fills. It binds the returned order ID, client order ID, product, side, and
SOR limit IOC configuration to the authorized Create payload, then checks
actual principal, commission, all-in debit, average price, and per-fill prices.
Complete pagination and coherent summed fill size, notional, fees, and
terminal aggregates are required before reporting a completed outcome.
Completed outcomes are `FILLED`, `PARTIAL_FILL`, or `NO_FILL`. Pending or
unreadable outcomes remain explicitly unresolved; an observed economic
violation is `EXECUTION_POLICY_BREACH`, not a retroactive block.

## Integration checklist for delta engineering

- [ ] Confirm whether an existing evaluator accepts the request shape directly.
- [ ] Map any production mandate/policy representation to
      `digital-asset-spot-order.v1` without weakening a constraint.
- [ ] Define the stable HTTPS route and bearer-token lifecycle.
- [ ] Provision a non-production Ed25519 signing key and publish its public key
      out of band.
- [ ] Confirm canonical JSON for semantic digests and raw UTF-8 SHA-256 for
      `create_payload_serialized` byte-for-byte.
- [ ] Confirm unique JTI generation, maximum 30-second decision lifetime, and
      key rotation behavior.
- [ ] Return explicit named `PASS` checks on `ALLOW`; return no partial or
      warning-only authorization.
- [ ] Run a signed fixture through the harness.
- [ ] Run `probe-execution` and confirm `PREVIEW_PROBE_PASS` with the intended
      key and portfolio before configuring this bridge for Create.
- [ ] Review the generated JSON/HTML record before enabling Create.

Until these checks are complete, use `./run simulate`; do not present the
bridge as a production delta receipt or the harness as live-ready.
