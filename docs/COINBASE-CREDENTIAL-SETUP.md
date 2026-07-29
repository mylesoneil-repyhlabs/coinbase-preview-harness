# Coinbase credential setup

Delta Coinbase Guard v1.4 needs no credential to install, compile a request,
show a closed policy, or run the end-to-end simulation.

The optional credential path is narrower: a dedicated **View-only** CDP API
key lets the direct REST adapter authenticate account, product, market, and
Preview requests. It does not give the agent Trade, Transfer, or Receive
authority. Coinbase Create Order remains compile-time locked.

Never paste a Coinbase key, key ID, private key, or JWT into Codex chat, a
prompt, an environment variable, a screenshot, or this repository.

## Public Coinbase surfaces used

| Guard operation | Coinbase endpoint | Documented permission |
| --- | --- | --- |
| Verify key scope | [`GET /key_permissions`](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/data-api/get-api-key-permissions) | View |
| Discover held funds | [`GET /accounts`](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/accounts/list-accounts) | View |
| Resolve products | [`GET /products`](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/products/list-products) and [`GET /products/{product_id}`](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/products/get-product) | View |
| Read the current book | [`GET /best_bid_ask`](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/rest-api) | View |
| Dry-run the order | [`POST /orders/preview`](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/preview-orders) | View |
| Submit an order, unavailable here | [`POST /orders`](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/create-order) | Trade |

Coinbase's [API-key authentication guide](https://docs.cdp.coinbase.com/coinbase-app/authentication-authorization/api-key-authentication)
describes ECDSA/ES256 CDP keys and request-bound JWTs. The adapter generates a
short-lived JWT for each pinned Advanced Trade REST request.

Coinbase also documents a local
[CLI/MCP server](https://docs.cdp.coinbase.com/coinbase-for-agents/overview).
This repository has not exercised that MCP. Its implemented network path is the
allowlisted direct REST adapter above. A future MCP deployment needs an
equivalent proxy or tool allowlist that makes mutating tools such as
`orders_create` unreachable to the agent.

## Install once, then discard the download

Run `./install` from the unpacked release or clone. v1.4 copies an explicit
allowlist into a versioned managed directory under
`${XDG_DATA_HOME:-$HOME/.local/share}/delta/coinbase-guard/versions/` and links
the Codex skill to that managed copy. It accepts Node.js 22+ from `PATH` or,
when Codex Desktop supplies one, its per-user runtime cache.

After installation succeeds, the downloaded archive or clone can be deleted.
The installed skill does not depend on that source directory. Reinstalling the
same intact version is idempotent; same-version drift is rejected, and
`./install --upgrade` retargets only a verified Coinbase Guard skill symlink.

The command snippets below are relative to the managed harness path printed by
the installer. In normal Codex use, ask `$delta-coinbase-guard` to run the
corresponding command; the skill resolves its managed harness automatically.

## Credential roles

| Role | Required scope | Where it may run | Current use |
| --- | --- | --- | --- |
| Planner / Preview | View only; Trade and Transfer disabled | Guard process or allowlisted read/Preview proxy | Supported, optional |
| Future executor | View + Trade; Transfer disabled | Isolated trusted executor, never the agent process | Configuration validator only |

A BUY uses held quote asset. A SELL uses held base asset. The guard binds
one-way key and portfolio fingerprints and never converts or substitutes a
different balance.

## 1. Check credential-free readiness

```sh
./run doctor
./run credential-readiness
```

These commands read no key and contact no external service. They report the
installed contracts, credential attestation presence, and locked Create
boundary.

## 2. Create a dedicated View-only key

In Coinbase Developer Platform, create a new ECDSA key dedicated to the
Preview harness:

- enable **View**;
- disable **Trade** and **Transfer**;
- restrict it to the intended isolated portfolio;
- add the narrowest available IP restriction; and
- do not reuse a production or general-purpose key.

The first real permission check remains a shadow-validation step because this
release was validated without a user credential.

## 3. Keep the key outside the repository

Use a permanent absolute path outside the checkout and managed install:

```sh
chmod 600 /absolute/outside-repo/coinbase_view_key.json
```

The guard rejects relative paths, symlinks, non-regular files, wrong ownership,
permissive modes, oversized files, unknown JSON fields, and non-ECDSA P-256
keys. It opens the same non-symlink file descriptor it validates to reduce
path-swap risk.

## 4. Validate the View-only configuration

Only after the user supplies the key separately:

```sh
./run configure-preview-credentials \
  --key-file /absolute/outside-repo/coinbase_view_key.json
```

`configure-credentials` remains an alias. The command:

1. reads the key only from the external file;
2. signs a request-bound, short-lived ES256 JWT for Coinbase permissions;
3. rejects Trade, Transfer, or an explicitly true Receive capability; and
4. atomically writes only a mode-`0600` non-secret attestation under ignored
   `runtime/`.

It never prints or copies key material and does not persist the key-file path.
Every authenticated command requires that path again.

## 5. Compile and authorize a credential-scoped Preview

The compiler supports one SPOT BUY or SELL with `EXACT` or `MAX` sizing and an
optional side-correct one-shot BBO condition:

```sh
./run plan --intent-file /absolute/path/to/conditional-buy-intent.txt
```

The command prints the complete v3 policy, v2 action descriptor, funding
source, optional condition, and policy digest. It then stops.

After a trusted host receives a new user-authored message authorizing that
exact digest:

```sh
./run bind-execution \
  --plan /absolute/path/to/plan.json \
  --confirm-policy <policy-digest> \
  --credential-role preview \
  --key-file /absolute/outside-repo/coinbase_view_key.json
```

The guard prints an execution digest covering the plan, capability profile,
portfolio, key fingerprint, and permissions. After a second user-authored
confirmation:

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

The direct REST probe verifies complete account pagination, exact held funding,
product state and increments, fresh best bid/ask, the optional market
condition, side-correct sizing, and coherent Preview economics. Preview errors
become `BLOCK`; any warning becomes `REVIEW`; a clean result stops at
`PREVIEW_PROBE_PASS`.

It does not run private Delta or Coinbase Create. The CLI validates digest
equality but does not authenticate the author of a chat message.

## 6. Keep any future Trade key isolated

The future-only validator is:

```sh
./run configure-executor-credentials \
  --key-file /absolute/outside-repo/coinbase_trade_key.json
```

That key must be View + Trade with Transfer disabled, restricted to the same
isolated portfolio, and available only to a trusted external executor.
Configuring it cannot unlock Create in this repository.

Before Create can be enabled, engineering still needs:

- the actual private Delta policy, signer, Orchestrator, pinned cryptographic
  Verifier, proof program, and proof mapping;
- authoritative Coinbase evidence extraction;
- exact action, Preview, proof, and serialized Create-payload binding;
- an isolated transactional one-time grant store;
- deterministic recovery by `client_order_id`;
- security review and credentialed shadow evidence; and
- a new explicit user decision for the first live order.

The separate 5-USDC, one-order profile is future live-test blast-radius control
only. It is not the generic v1.4 policy or demo narrative.
