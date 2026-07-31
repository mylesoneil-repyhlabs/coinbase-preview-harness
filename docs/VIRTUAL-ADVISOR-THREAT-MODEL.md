# Delta Guard Advisor threat model

## Assets

- Human instruction and explicit authorization.
- Closed policy, exact proposal, Preview request, prospective Create bytes,
  decision, receipt, freshness, and replay state.
- Optional Coinbase key name and ECDSA private key.
- Redacted local history.
- The compile-time locked execution boundary.

## Trust boundaries

1. Browser presentation and input.
2. Same-origin loopback Node server.
3. In-process session store and deterministic guard.
4. Coinbase View-only endpoints.
5. Future private Delta and executor systems, which are absent.

The browser is not trusted to decide policy, arithmetic, evidence, or
eligibility. The server never accepts a client-supplied decision, digest,
permission attestation, Preview, receipt, or execution state as authoritative.

## Credential contract

- Default: no credential.
- View-only input is accepted only by the loopback server.
- No localStorage, sessionStorage, IndexedDB, service worker, analytics,
  browser URL, query string, log, history record, screenshot, or release
  artifact may contain a credential.
- Credentials are retained only in server-process memory until disconnect,
  idle expiry, absolute expiry, failed validation, or process exit.
- A scheduled expiry clears the reference even if the browser makes no further
  request. Clock rollback fails closed and clears the connection.
- Strings cannot be guaranteed to be zeroized; the product claims
  non-persistence, not cryptographic erasure.
- Permission verification requires View and rejects Trade, Transfer, and any
  explicitly reported Receive authority.
- Coinbase’s current permission response does not document Receive; omission
  is shown as “not reported,” never “verified off.”
- Each View-only preflight rechecks current key permissions.
- One View-only preflight may borrow a connection at a time. Disconnect,
  expiry, replacement, or scope change aborts the active lease and prevents a
  late result from being recorded as current.

## Server controls

- Bind to `127.0.0.1` by default.
- Exact Host, Origin, Fetch Metadata, method, content type, and route checks.
- No CORS, wildcard route, redirect, generic proxy, or user-controlled upstream
  URL.
- High-entropy session token, same-origin custom header, inactivity expiry,
  bounded concurrency, and request-size limits.
- Public status, connection status, activity reads, hostile requests, and
  unknown routes do not allocate a session, credential provider, or cookie.
  Only an accepted same-origin plan or connection mutation creates a session.
- Strict CSP, `frame-ancestors 'none'`, `base-uri 'none'`,
  `form-action 'self'`, no-referrer, no-sniff, COOP, and CORP.
- Fixed typed client errors; no raw provider text, stack, key field, path,
  request body, header, or identifier.
- View models are explicit allowlists. Raw guard records are not sent directly.
- DOM uses safe text rendering rather than untrusted HTML.
- The advisor imports a dedicated View-only transport exposing only accounts,
  exact product, BBO, and `POST /orders/preview`. A dependency-closure test
  excludes the Coinbase execution adapter and any Create/order method.
- Conditional-plan grants are server-owned and atomically consumed before an
  evidence request. Cancel, revoke, edit, and disconnect abort provider work;
  expiry is checked before result acceptance and discards a late result. None
  can restore eligibility or overwrite a terminal state. Cancellation before
  `CHECKING` tombstones the matching `AUTHORIZED_FOR_SIMULATION` grant, and
  cancellation after verified completion returns that completed result rather
  than rewriting history.
- Conditional proposal verification recomputes the side-correct BBO slippage
  bound and its intersection with the absolute trigger. Reference price, raw
  bound, effective limit, proposal, evidence, authorization, and receipt are
  bound; rehashed semantic tampering still fails verification.

## Execution controls

There is no Create endpoint. The web service must not import or expose the
execution adapter, a Trade credential loader, a generic Coinbase request, or
CLI execution.

A future production implementation would need a new server-authoritative
`delta.coinbase.final_review_challenge.v1`. It must be created only after
Preview and production Delta PASS, return only an opaque identifier plus safe
summary to the browser, and bind:

```text
advisor session and authenticated principal
plan, policy, canonical action, and exact proposal
Preview request and response plus normalized evidence
exact prospective Create UTF-8 bytes
credential and portfolio identity
production Delta proof and pinned verifier
kill-switch epoch
expiry and maximum uses
```

That challenge does not exist in this release. Sprint 5 may show a locked
live-readiness preview explaining these protections, but final-confirmation
readiness, a durable executor, Create, and live execution remain false.

The existing `execution_confirmation.v2` object is preflight-readiness
evidence only: it can be produced before Coinbase reads and does not bind the
post-Preview proposal, evidence, Delta receipt, Create bytes, or advisor
session. The advisor must not label or render it as final-order confirmation.

A future kill switch starts `STOPPED`, fails closed, is rechecked at challenge
issuance, confirmation, claim, and send, and increments an epoch that
invalidates outstanding grants. Any possible Create also requires a durable
journal and reconciliation for uncertain send and restart. None of those
controls can be represented by a browser-only confirmation button.

Future execution requires all of:

- production Delta verification pinned to an approved identity/program;
- authenticated external user authorization;
- isolated View+Trade credential with no transfer authority;
- durable atomic one-use grant store;
- server-side exact-byte Create;
- kill switch and reconciliation;
- separate explicit user authorization for the first real order.

## Key threats and expected result

| Threat | Control | Result |
| --- | --- | --- |
| Cross-origin request or DNS rebinding | Host/Origin/Fetch Metadata/custom header | Reject before body handling |
| XSS or clickjacking | CSP, no third-party code, frame denial, text rendering | No credential or action exposure |
| Credential in logs/history | No request logging, fixed errors, redacted DTOs, canary tests | Release fails |
| Over-scoped/revoked key | Permission endpoint and exact View-only assertion | `REVIEW`, disconnect, no order |
| Stale/missing/mismatched evidence | Endpoint freshness and exact binding | `REVIEW`, never `PASS` |
| Policy/proposal/payload mutation | Canonical digest recomputation | `BLOCK` or `REVIEW`; later state invalidated |
| Nonce replay or concurrent duplicate | Existing nonce claims and history | One current result or fail closed |
| Conditional double-submit or cancel race | Atomic one-use consume; server cancel tombstone; late-result discard | One result, or `REVIEW`; never a second check |
| Clock rollback after plan expiry | Sticky server-owned `EXPIRED` tombstone | Cannot revise, authorize, or restart |
| Forged PASS or confirmation | No final-confirmation route; future challenge requires pinned production proof | Remains `LOCKED` |
| Double final confirmation | No final-confirmation route; future durable challenge must consume atomically | Remains `LOCKED` |
| Kill-switch race or uncertain send | No send path; future executor requires epoch checks, durable journal, reconciliation | No order |
| Generic Coinbase/Create route | No route/import plus source scan | Unreachable |
| Hosted credential collection | Hosted mode disables credential routes | Credential-free only |

## Privacy and retention

Active web plans, View-only credentials, and advisor View-only activity remain
in process memory. The advisor disables persistent history for a real
View-only run and records only a redacted session activity entry after the
credential lease remains current. The separate CLI Guard history may persist
by default; it is owner-only, count-bounded, inspectable, and explicitly
deletable.

Advisor conditional plans are session-only non-executable planning objects in
the current implementation. They are destroyed with the session or process
and store no credential, account ID, provider body, or execution eligibility.
Future portfolio persistence remains unimplemented.

## Deployment

The reviewed credential boundary is loopback only. A hosted build is demo,
research, planning, and simulation only. Remote credential support requires a
separate security design with TLS, identity, tenant isolation, reviewed secret
handling, and operational controls. It is not a configuration toggle for this
release.
