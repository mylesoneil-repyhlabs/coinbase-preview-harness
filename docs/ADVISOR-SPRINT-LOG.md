# Delta Guard Advisor v1.6 sprint log

This is an implementation and review record. Synthetic findings are labelled
and are not Coinbase, customer, partner, or market evidence.

## Sprint 0 — roadmap and foundation

### Product Manager requirements

Ship a protected execution copilot, not an autonomous broker: useful without a
credential, conversational first, editable mandate, explicit state machine,
and no loss of the v1.5.3 exact-payload/no-Create boundary.

### Engineering-lead architecture

Keep the dependency-free Node 22 ESM core. Add a same-origin loopback server
and static client; the browser handles presentation only. Reuse
`createExecutionPlan`, `runGuardPreflight`, receipts, and redacted history.
No `.openai/hosting.json` exists, so no Sites project is invented.

### Senior full-stack implementation

Added the versioned advisor capability contract and actionable roadmap,
design, and threat-model documents. Defined the eight-sprint state and
release journey before UI code.

### Backend and data

Active web plans and credentials will be in-memory. Existing redacted history
remains the only default persistence. Separate versioned conditional and
portfolio planning objects cannot become executable without creating and
authorizing a new one-action mandate.

### DevOps and release review

Local loopback is the credential-capable target. Hosted/static is
credential-free. The release must add the frontend to explicit archive and
managed-install allowlists, retain restricted-`PATH` validation, and keep
Create absent.

### Designer and frontend critique

Use one consultation workspace, four destinations, persistent trust strip,
conversation-dominant layout, calm warm-paper/deep-ink system, progressive
disclosure, and accessible decision semantics. Avoid dashboards, terminal
tropes, fake balances, and co-branding.

### QA

Established security, functional, browser, accessibility, responsive,
performance, install, and release gates. Highest-risk regression: a visible
Confirm control must never create an order route or imply a fill.

### Target-user qualitative feedback

Synthetic composite feedback only: a privacy-conscious spot user would try
the no-key dry run, identified the editable mandate as the trust moment, and
would connect only after a clear View-only permission test. They would reject
a hosted secret form or a conditional plan described as “active” without a
real monitor.

### Shipped impact

The team now has a single product, design, security, and release contract.
The existing v1.5.3 behavior is unchanged at this milestone.

## Sprint 1 — usable credential-free advisor

### Product Manager requirements

Deliver immediate value without a key: one calm conversational entry, a short
composer, an explicit protected example, a plain-English mandate review, a
separate proposal, all three Guard outcomes, and an unmissable no-order
boundary. Future features must be visibly `Preview` or `Coming soon`, never
dead-end controls that imply a live route.

### Engineering-lead architecture

Added a dependency-free Node 22 loopback service and static frontend. The
browser owns presentation only; deterministic server code reuses
`createExecutionPlan`, `runGuardPreflight`, local receipt verification, and
redacted history. A single checked-in capability contract drives server status
and keeps unshipped features disabled.

Session controls now match the contract: 15-minute idle and 60-minute absolute
expiry, explicit destroy/clear hooks, secret-disposal callbacks, least-recently
used capacity eviction, and cleanup on server close. Cross-site API traffic is
rejected before session allocation.

### Senior full-stack implementation

Built the real Advisor, Plans, Activity, and Connection surfaces; persistent
mode/connection/orders-off context; editable mandate card; one-check
authorization; proposal, decision, impact, provenance, receipt, and recovery
views; deliberate `BLOCK → retry → PASS`; safe `REVIEW`; and a private activity
view. Added `./run advisor` so the managed Codex runtime works even when
`node` is absent from the shell `PATH`.

### Backend and data

The same-origin API is an explicit allowlist for status, plan, one-check
authorization, two labeled fixture stories, and redacted activity. Plans and
session activity remain memory-only. The server does not send raw Guard
records, policy digests, account identifiers, provider bodies, or secret
material to the browser.

### DevOps and release review

The server binds only to `127.0.0.1`; static serving canonicalizes both the web
root and final target and rejects symlink escape. Mutations require exact Host,
Origin, Fetch Metadata, JSON, and `X-Delta-Advisor: 1`; bodies and concurrent
requests are bounded. CSP, no-store, no-referrer, no-sniff, frame denial, COOP,
CORP, and a no-CORS/no-proxy route boundary remain enforced.

### Designer and frontend critique

Synthetic internal critique identified an overly dense first prompt,
insufficiently plain decision meanings, future-feature dead ends, lost mobile
safety context, and weak long-wait recovery. The shipped revision starts with
an empty compact composer and explicit protected example, explains `PASS` as
fits mandate, `BLOCK` as outside mandate, and `REVIEW` as unable to verify,
compares observed facts with allowed boundaries, elevates `NO ORDER SUBMITTED`,
keeps the safety strip visible on narrow layouts, and shows a visible safe-wait
state while conflicting actions are disabled.

### QA

Release-blocking review found that an older mandate card could read the newest
mutable plan and authorize the wrong item. Authorization is now bound to the
card's immutable `plan_id`; stale cards are invalidated, and all conflicting
controls share one visible pending lock. Result rendering fails closed unless
the normalized outcome is exactly `PASS` and the receipt verifies.

Additional adversarial coverage includes hostile Host/Origin/Fetch Metadata,
missing custom header, body limits, malformed requests, method confusion,
static traversal and intermediate-symlink escape, cross-site session-allocation
resistance, concurrency saturation, session isolation, replay, capability
truth, and local evidence redaction. REVIEW fixture evidence is described as
generated and verified locally, not persisted.

### Target-user qualitative feedback

Synthetic composite feedback only: the revised first screen makes the no-key
example discoverable without making the user parse an expert prompt. The
plain-English decision meaning and observed-versus-allowed comparison improve
trust; the persistent orders-off state prevents the polished interface from
being mistaken for a live broker.

### Shipped impact

The branch contains a usable, interactive protected-execution consultation
that reaches mandate review, deterministic dry-run evaluation, receipt, and
recovery without a credential. Coinbase Create, live orders, production Delta,
View-only advisor connection, saved monitoring, research, portfolio planning,
and final-order confirmation remain disabled at this milestone.

## Sprint 2 — session-only Coinbase View preflight

### Product Manager requirements

Keep the no-key dry run first. Make a real account-aware check optional,
explicit, and useful without asking the user to understand transport details:
connect one normal-user View-only key locally, see exactly what it can read,
choose View-only on one mandate, and retain an unmissable no-order boundary.
A requested real-data check must never silently turn into a fixture result.

### Engineering-lead architecture

Added a narrow server-process credential broker and a separate View-only REST
transport. The browser can send credential material only to one same-origin
connect route; it never receives it back. The provider verifies exact
permissions on connect and before every borrow, permits one concurrent
preflight, binds the borrow to the current generation/scope, exposes an abort
signal, and revalidates immediately before the result can be accepted.

Public status, connection status, and activity reads use a non-touching
session lookup. A missing cookie returns a fixed disconnected DTO without
opening a session, creating a provider, or setting a cookie. Only an accepted
same-origin plan or connect POST creates one.

### Senior full-stack implementation

Built the Connection journey with precise View-only consent, non-OAuth copy,
key name and ECDSA private-key fields, immediate field clearing, progress,
redacted errors, permission/freshness/expiry status, and
**Disconnect and erase session key**. A connected mandate still defaults to
Dry run; the user must explicitly select View-only preflight before the one
check. Connection changes invalidate visible mandate authorizations.

Results distinguish `SIMULATED_FIXTURE_NOT_COINBASE`,
`COINBASE_VIEW_ONLY_READS_AND_PREVIEW`,
`COINBASE_VIEW_ONLY_CHECK_INCOMPLETE`, and
`VIEW_ONLY_NO_COINBASE_EVIDENCE`. A View-only PASS is described as local
deterministic Guard evaluation; production Delta was not contacted.

### Backend and data

Credential material is validated as one CDP ECDSA P-256 key and held only in
the server process. It expires after 15 minutes idle, 60 minutes absolute,
disconnect, replacement, hard permission failure, clock rollback, or process
exit. Scheduled cleanup does not depend on another browser request.
JavaScript strings are not claimed to be zeroized.

The View-only adapter can call only permissions, accounts, exact product, BBO,
and `POST /orders/preview`. Browser DTOs contain allowlisted normalized facts
and redacted activity only—never a key, fingerprint, account ID, provider
body/header, JWT, local path, or raw Guard record. Persistent history is
disabled for advisor View-only runs; a redacted session activity item is
appended only after the credential lease remains current.

### DevOps and release review

The network path is dependency-injected in tests; no real credential or
Coinbase request was used. Redirects, user-controlled origins/routes,
Create/order methods, generic proxying, and execution-adapter imports are
absent. A dependency-closure regression proves the advisor cannot reach the
existing execution transport. The capability flag was enabled only after the
end-to-end, redaction, failure, and import-boundary suite passed.

### Designer and frontend critique

Synthetic internal review found that making View-only automatic would blur
consent and make a polished result look more live than it is. The shipped
design keeps Dry run selected, separates connection from authorization, states
what will be read before entry, labels Preview as point-in-time rather than an
order or price guarantee, and keeps Mode, View only, and Orders off visible.
Connection failure always leaves the useful no-key path available.

### QA

The focused integration and adversarial suite passed **104/104**. It covers:
no allocation/cookie/provider on status reads; cross-site rejection before
allocation; session isolation; connect/disconnect; redacted end-to-end
account/product/BBO/Preview; no silent fallback; missing connection;
reconnect/disconnect/expiry/clock/scope races; bounded concurrency; revoked,
over-scoped, malformed, rate-limited, and unavailable permissions; stale,
partial, malformed, or mismatched facts; Preview-body fingerprint mutation;
replay; exact PASS plus verified-receipt rendering; no secret leakage; and
dependency closure with Create unreachable.

Independent read-only security review found no P0/P1 issue after the capability
flag was aligned. Its defense-in-depth finding was also shipped: the server
view now downgrades any claimed `PASS` with a missing, malformed, or
unverifiable exact receipt to explicit `REVIEW`, rather than relying on the
browser to fail closed.

The first in-app browser automation call failed because validation invoked
navigation on the inspection helper instead of the tab object. The local
server had not returned a UI/API error. The corrected browser-control path
reloaded the current app and completed the real interaction: empty start →
example fill → mandate review → one-check authorization → verified PASS with
observed-versus-allowed facts and no-order lock. The Connection view was also
inspected at a 320 CSS-pixel viewport (equivalent to a 640-pixel layout at
200% zoom): document width stayed at 320 pixels, the compact
Dry run/Coinbase off/Orders off strip remained present, fields were empty with
safe autocomplete attributes, and the browser console had zero warnings or
errors. This records an infrastructure/control invocation error and its tested
replacement, not a skipped visual gate.

The first repository-wide run then failed six managed-install cases because
the empty credential textarea used a literal PEM header as placeholder text.
The release scanner correctly treated that secret-shaped string as private-key
material. The placeholder now says what to paste without embedding a PEM
header; the credential contract and scanner both remain strict. This was a UI
copy defect with release impact, not a scanner bypass.

### Target-user qualitative feedback

Synthetic composite feedback only: the connection screen feels specific
enough to make a security decision because it names the five reads, says “not
OAuth,” and shows expiry and erase controls. Keeping the dry run immediately
usable makes View-only feel like an optional confidence upgrade rather than an
onboarding tax.

### Shipped impact

The development branch now supports a real optional local/session-only
Coinbase View connection and account-aware one-check preflight while retaining
the credential-free default. Coinbase Create, Trade credentials, production
Delta, live orders, money movement, saved monitoring, educational planning,
and final-order confirmation remain disabled.

### Accepted guardrails for later sprints

Internal/synthetic reviews—not customer proof—set narrower release contracts:
Sprint 3 is a non-executable revisioned template and one fresh authorized
simulation check, never a watcher; Sprint 4 is neutral market-snapshot and
user-directed educational planning with exactly one fresh mandate handoff;
Sprint 5 is only a locked live-readiness preview. It must not reuse
`execution_confirmation.v2`, expose a Trade field or confirm control, import
an executor, or claim “ready to trade.” A future final challenge and
fail-closed durable execution design remain outside this release.
