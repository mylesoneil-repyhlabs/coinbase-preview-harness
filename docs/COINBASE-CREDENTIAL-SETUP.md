# Optional Coinbase View-only setup

Delta Coinbase Guard v1.6 needs no credential for installation, Advisor
startup, mandate
capture, authorization, the complete dry run, local Delta simulation, receipt,
or Guard history.

The optional credential path replaces labeled fixtures with point-in-time
Coinbase account/product/BBO/Preview facts. It is still a preflight:

- no production Delta authorization;
- no execution grant;
- no Coinbase Create;
- no order, fill, or money movement.

Never paste a Coinbase key, key ID, private key, JWT, account password, or
local key path into Codex chat, a prompt, screenshot, repository, log, or
release artifact.

## Public Coinbase surfaces used

Coinbase’s official Advanced Trade endpoint table documents these permissions:

| Guard purpose | Method and endpoint | Coinbase permission |
| --- | --- | --- |
| Check scope | `GET /api/v3/brokerage/key_permissions` | View |
| Held funds | `GET /api/v3/brokerage/accounts` | View |
| Exact product | `GET /api/v3/brokerage/products/{product_id}` | View |
| Exact BBO | `GET /api/v3/brokerage/best_bid_ask` | View |
| Exact Preview | `POST /api/v3/brokerage/orders/preview` | View |
| Create Order | `POST /api/v3/brokerage/orders` | **Trade; never called** |

Official references:

- [Advanced Trade endpoint permissions](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/rest-api)
- [Preview Order](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/preview-orders)
- [Create Order](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/create-order)
- [API-key authentication](https://docs.cdp.coinbase.com/coinbase-app/authentication-authorization/api-key-authentication)

A normal user-created CDP API key is the public path. No private Coinbase
developer access is assumed.

## Create the narrow key

In Coinbase/CDP, create a dedicated ECDSA/ES256 key for the narrowest available
portfolio and IP scope:

- View: enabled;
- Trade: disabled;
- Transfer: disabled;
- Receive: disabled.

Do not use ordinary Coinbase account credentials or a View+Trade key. Save the
downloaded JSON outside the repository and restrict it:

```sh
chmod 600 /absolute/path/outside/repository/view_key.json
```

The Guard validates:

- absolute, regular, non-symlink path;
- private file permissions;
- supported ECDSA key shape;
- current permission response;
- View present and Trade/Transfer absent;
- explicit Receive authority rejected; because the current documented response
  omits this field, an omission is recorded as unreported rather than
  misrepresented as verified false;
- portfolio scope compatible with the returned accounts.

Failure is `REVIEW — unable to verify`; it never falls back to a broader key or
silently uses simulated evidence.

## Connect in the local Advisor

Start `./run advisor`, open its printed `127.0.0.1` URL, and choose
**Connection**. Enter the complete CDP key name and ECDSA private key only in
that local page, then choose **Connect and test View only**.

This path is not OAuth. Credential material necessarily exists briefly in the
form, page JavaScript, and one same-origin loopback request. The fields are
cleared before dispatch. After receipt, accepted key material exists only in
the loopback server process until disconnect, failed validation, 15 minutes
idle, 60 minutes absolute, or process exit.

The Advisor never writes credential material to browser storage, browser
history, a URL, logs, analytics, Guard history, the repository, or remote
telemetry. JavaScript and server strings cannot be promised cryptographic
zeroization; this is a non-persistence contract.

The page session itself uses a separate high-entropy capability retained only
in page memory and sent on stateful same-origin requests. No cookie is issued
or trusted. Reloading starts a new session and loses the old page capability.

Once connected, return to the latest unchanged mandate and explicitly select
**View-only preflight**. The connection itself is not authorization. The
server rechecks permissions before each preflight, and a missing, revoked,
over-scoped, partial, stale, or unavailable source returns `REVIEW` with no
fixture fallback.

## Use the file-based CLI preflight

The normal Codex flow is:

1. state the spot BUY or SELL;
2. review the complete captured mandate;
3. reply “Authorize this mandate”;
4. ask the skill to use your View-only key for this preflight.

The skill keeps the plan path and exact policy digest private, then invokes:

```sh
./run preflight \
  --plan /absolute/private/path/from-plan \
  --confirm-policy <exact-authorized-policy-digest> \
  --view-key-file /absolute/path/outside/repository/view_key.json \
  --no-artifacts
```

No separate configure/bind/second-digest workflow is required for the
View-only preflight. Developer-only legacy seams remain under `help --all` for
integration testing; they are not the user journey.

The key file is loaded into that process only. `persistAttestation` is disabled
for this path. The private key is never copied, printed, put in an environment
variable, written to history, or placed in the receipt. Non-secret credential
and portfolio fingerprints are bound to the in-memory preflight and exact
retry semantics.

## Allowlist and network behavior

The View-only adapter exposes only:

- `listAccounts`;
- `getProduct`;
- `getBestBidAsk`;
- `previewOrder`.

Every request is checked against a fixed method, host, and route template.
Redirects are denied. There is no Create, conversion, transfer, withdrawal,
deposit, or generic request method. HTTP authentication failures, 429, 5xx,
timeouts, malformed JSON, partial pagination, product mismatch, stale BBO, and
Preview mismatch are converted to typed local `REVIEW` outcomes.

Provider-supplied text is not retained in history or receipts. The Guard
stores only a generic local code/reason and allowlisted normalized facts.

## What the result means

`VIEW-ONLY PREFLIGHT PASS` means:

- the supplied key was verified as View-only for that session;
- complete account evidence showed enough of the exact held funding asset;
- the exact product was online, enabled, spot, and increment-compatible;
- BBO evidence was fresh and side-correct;
- the exact prepared Preview request was sent to the allowlisted endpoint;
- normalized Preview economics satisfied the authorized local policy; and
- the exact policy, proposal, normalized evidence, request bytes, prospective
  Create payload, mode, nonce, fingerprint, decision, and expiry were bound.

It does **not** mean:

- Coinbase guarantees the price or future execution;
- production Delta approved or signed the action;
- stored normalized facts are independently authenticated as Coinbase-authored;
- a live grant exists;
- Create is reachable; or
- an order was submitted.

Any order-relevant change requires a new exact preflight. An expired or
superseded result stays historical only.

## Time and recovery expectations

Once a View-only key exists, the intended setup is under three minutes and at
most two user decisions: authorize the mandate, then opt into the key. The
command reports progress immediately and emits a safe heartbeat during a slow
provider request.

| Outcome | Meaning | Recovery |
| --- | --- | --- |
| `BLOCK` | Verified facts show a mandate violation | Change the proposal or authorize a new mandate |
| `REVIEW` | Evidence or binding could not be safely verified | Repair the key/provider issue or refresh evidence, then run a new preflight |
| `VIEW-ONLY PREFLIGHT PASS` | Exact point-in-time read/Preview facts satisfy local checks | Treat as inspection evidence only; Create remains unavailable |

Never retry a failed provider call by changing the pair, size, side, key,
portfolio, or endpoint under the same nonce.

## Secret-safe local data

The Guard history may retain redacted mandate/proposal summaries, local IDs,
hashes, outcome, source type, timestamps/age, expiry/currentness, and no-order
status. It excludes:

- private keys, JWTs, and raw credential JSON;
- raw key IDs and key-file paths;
- raw Coinbase responses or headers;
- account IDs and portfolio IDs;
- arbitrary provider error text.

No remote telemetry is enabled. Clear local history only after explicit user
confirmation:

```sh
./run history --clear
```

## Future live boundary

The separate checked-in 5-USDC/one-order profile is only a future live-test
blast-radius control. It is not used in the product narrative and does not
authorize credential creation, a View+Trade key, Coinbase Create, or a first
live trade.

Before any live path could be considered, engineering must integrate and
validate the private Delta verifier, authenticate the user authorization
independently, durably consume one grant, isolate a View+Trade executor key,
and obtain separate explicit authorization for the first order.
