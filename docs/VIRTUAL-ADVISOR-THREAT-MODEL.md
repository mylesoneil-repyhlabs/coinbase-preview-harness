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
- Strings cannot be guaranteed to be zeroized; the product claims
  non-persistence, not cryptographic erasure.
- Permission verification requires View and rejects Trade, Transfer, and any
  explicitly reported Receive authority.
- Coinbase’s current permission response does not document Receive; omission
  is shown as “not reported,” never “verified off.”
- Each View-only preflight rechecks current key permissions.

## Server controls

- Bind to `127.0.0.1` by default.
- Exact Host, Origin, Fetch Metadata, method, content type, and route checks.
- No CORS, wildcard route, redirect, generic proxy, or user-controlled upstream
  URL.
- High-entropy session token, same-origin custom header, inactivity expiry,
  bounded concurrency, and request-size limits.
- Strict CSP, `frame-ancestors 'none'`, `base-uri 'none'`,
  `form-action 'self'`, no-referrer, no-sniff, COOP, and CORP.
- Fixed typed client errors; no raw provider text, stack, key field, path,
  request body, header, or identifier.
- View models are explicit allowlists. Raw guard records are not sent directly.
- DOM uses safe text rendering rather than untrusted HTML.

## Execution controls

There is no Create endpoint. The web service must not import or expose the
execution adapter, a Trade credential loader, a generic Coinbase request, or
CLI execution.

A later post-PASS confirmation challenge binds:

```text
advisor session
authorized policy and exact proposal digests
normalized Preview/evidence fingerprint
fresh Delta decision receipt digest
prospective exact Create-request bytes digest
expiry
```

It is local readiness evidence only. It is not a durable one-use grant and
cannot submit anything. Any bound-field change or replay invalidates it.

The existing `execution_confirmation.v2` object is preflight-readiness
evidence only: it can be produced before Coinbase reads and does not bind the
post-Preview proposal, evidence, Delta receipt, Create bytes, or advisor
session. The advisor must not label or render it as final-order confirmation.

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
| Double final confirmation | Session challenge consume-once | Second attempt rejected |
| Generic Coinbase/Create route | No route/import plus source scan | Unreachable |
| Hosted credential collection | Hosted mode disables credential routes | Credential-free only |

## Privacy and retention

Active web plans remain in process memory. The web journey does not call the
legacy raw-plan writer. Only the existing redacted Guard history may persist by
default; it is owner-only, count-bounded, inspectable, and explicitly
deletable.

Saved conditional and portfolio plans are local non-executable planning
objects. Persistence is opt-in and stores no credential, account ID, provider
body, authorization receipt, or execution eligibility.

## Deployment

The reviewed credential boundary is loopback only. A hosted build is demo,
research, planning, and simulation only. Remote credential support requires a
separate security design with TLS, identity, tenant isolation, reviewed secret
handling, and operational controls. It is not a configuration toggle for this
release.
