# Coinbase credential setup

Delta Coinbase Guard v1.3 needs no credential to compile a request, present a
closed policy for authorization, or run the local end-to-end simulation.

The optional credential path is narrower: a dedicated **View-only** CDP API key
lets the guard authenticate Coinbase account, product, market, and Preview
requests. It does not give the agent Trade, Transfer, or Receive authority.
Coinbase Create Order remains compile-time locked in this public build.

Never paste a Coinbase key, key ID, or private key into Codex chat, a prompt, an
environment variable, a screenshot, or this repository.

## What Coinbase publicly supports

Coinbase documents the Advanced Trade v3 API as available through CDP API keys
created by ordinary Coinbase users; no private Coinbase developer program is
required for the surfaces used here:

| Guard operation | Coinbase endpoint | Documented permission |
| --- | --- | --- |
| Verify key scope | [`GET /key_permissions`](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/data-api/get-api-key-permissions) | View |
| Discover held funds | [`GET /accounts`](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/accounts/list-accounts) | View |
| Resolve a requested pair and increments | [`GET /products/{product_id}`](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/products/get-product) | View |
| Read the current book | [`GET /best_bid_ask`](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/rest-api) | View |
| Dry-run the exact order | [`POST /orders/preview`](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/preview-orders) | View |
| Submit an order, not enabled here | [`POST /orders`](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/create-order) | Trade |

Coinbase's [API key authentication guide](https://docs.cdp.coinbase.com/coinbase-app/authentication-authorization/api-key-authentication)
describes ECDSA/ES256 CDP keys and request-bound JWTs. The harness independently
generates a short-lived JWT for each pinned Advanced Trade request.

Coinbase also publishes a local [CLI/MCP server](https://docs.cdp.coinbase.com/coinbase-for-agents/overview)
for Codex and other clients. Its standard tool set includes both
`orders_preview` and the mutating `orders_create` tool. Do not expose that
unfiltered namespace to an autonomous agent for this demo. The checked-in
adapter is an allowlisted read/Preview boundary; a production MCP deployment
needs an equivalent proxy or tool allowlist that makes Create unreachable.
This repository does not claim to have exercised a live Coinbase MCP session.

## Credential roles

| Role | Required scope | Where it may run | Current use |
| --- | --- | --- | --- |
| Planner / Preview | View only; Trade and Transfer disabled | Guard process or an allowlisted read/Preview proxy | Supported, optional |
| Future executor | View + Trade; Transfer disabled | Isolated trusted executor, never the agent process | Configuration validator only |

The guard binds a key fingerprint and the key's permissioned portfolio
fingerprint into the execution scope. It does not silently convert assets or
move funds between portfolios. A BUY requires available quote asset; a SELL
requires available base asset.

## 1. Check local readiness

```sh
./run credential-readiness
```

This command reads no key and contacts no external service. It reports the
presence of non-secret View and future-executor attestations, the credential
roles, the external-file requirement, and the locked Create boundary.

## 2. Create a dedicated View-only key

In Coinbase Developer Platform, create a new ECDSA key dedicated to this
Preview harness:

- enable **View**;
- disable **Trade** and **Transfer**;
- restrict it to the intended portfolio;
- add the narrowest available IP restriction; and
- do not reuse a production or general-purpose key.

Coinbase's current public key-permissions reference documents `can_view`,
`can_trade`, `can_transfer`, and `portfolio_uuid`. The harness validates the
documented response shape and also rejects an explicitly true `can_receive`
extension if Coinbase returns one. Because no credential was used for this
release, the first real permission check remains an isolated shadow-validation
step.

## 3. Store the key outside the repository

Keep the downloaded JSON at a permanent absolute path outside this checkout:

```sh
chmod 600 /absolute/outside-repo/coinbase_view_key.json
```

The guard rejects relative paths, symlinks, non-regular files, files owned by
another user, permissive file modes, oversized files, unknown JSON fields,
non-ECDSA P-256 keys, and keys stored inside the repository.

## 4. Validate the View-only configuration

Only after the user supplies the key separately:

```sh
./run configure-preview-credentials \
  --key-file /absolute/outside-repo/coinbase_view_key.json
```

`configure-credentials` is retained as an alias for this View-only command.
The command:

1. reads the key only from the external path;
2. signs a request-bound, 120-second ES256 JWT for Coinbase's permission
   endpoint;
3. rejects a scope that can trade or transfer; and
4. writes only a mode-`0600` attestation under ignored `runtime/`, containing
   permission booleans plus one-way key and portfolio fingerprints.

It never prints or copies the key ID or private key. It does not persist the
key-file path. Every authenticated command requires the path again.

## 5. Authorize a credential-scoped Preview

Planning writes a v1.3 plan and prints the complete policy, canonical action,
and policy digest:

```sh
./run plan --intent "<one explicit SPOT BUY or SELL request>"
```

After the user authorizes that displayed policy digest in a new message, bind
the plan to the View-only credential and portfolio:

```sh
./run bind-execution \
  --plan /absolute/path/to/plan.json \
  --confirm-policy <policy-digest> \
  --credential-role preview \
  --key-file /absolute/outside-repo/coinbase_view_key.json
```

The guard prints a second execution digest covering the plan, capability
profile, portfolio, key fingerprint, and permissions. After a separate
user-authored authorization of that digest:

```sh
./run confirm-execution \
  --bound-execution /absolute/path/to/bound-execution.json \
  --confirm-execution <execution-digest> \
  --key-file /absolute/outside-repo/coinbase_view_key.json

./run probe-execution \
  --bound-execution /absolute/path/to/bound-execution.json \
  --confirmation-receipt /absolute/path/to/confirmation-receipt.json \
  --key-file /absolute/outside-repo/coinbase_view_key.json
```

The probe performs authenticated List Accounts, Get Product, Best Bid/Ask, and
Preview requests. It requires a complete account listing and enough available
funds in the exact source asset, checks live product flags and increments,
builds the side-specific order (`quote_size` for BUY, `base_size` for SELL),
and stops at `PREVIEW_PROBE_PASS`. Preview errors are `BLOCK`; any Preview
warning is `REVIEW` and also stops.

The CLI records supplied digests but does not authenticate the person typing
them. A production host must replace that procedural pause with an
authenticated user-approval or Delta signing session.

## 6. Keep the future executor separate

Do not configure a Trade key while read/Preview validation is still underway.
The future-only command is:

```sh
./run configure-executor-credentials \
  --key-file /absolute/outside-repo/coinbase_trade_key.json
```

That key must be View + Trade with Transfer disabled, restricted to the same
isolated portfolio, and accessible only to a trusted executor outside the agent
process. Configuring it still cannot unlock Create in this repository.

The independent future live-test profile is a second, non-overridable
restriction: one `ETH-USDC` BUY, `5.00 USDC` principal, `5.50 USDC` maximum
debit, `0.50 USDC` maximum commission, 50 bps slippage, IOC, one execution, and
a 120-second window. This is operational blast-radius control for a later
explicitly approved real-money test. It is not the economic logic or product
story for generic v1.3 planning and Preview.

Create must remain disabled until all of the following exist and pass review:

- the actual private Delta policy, signer, Orchestrator, Verifier, and proof
  mapping;
- authoritative Coinbase evidence extraction;
- exact action-record, Preview, proof, and serialized Create-payload binding;
- an isolated transactional one-time grant store;
- deterministic recovery by `client_order_id`; and
- a fresh, explicit user decision authorizing the first live order.
