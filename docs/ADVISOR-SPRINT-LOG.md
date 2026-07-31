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
