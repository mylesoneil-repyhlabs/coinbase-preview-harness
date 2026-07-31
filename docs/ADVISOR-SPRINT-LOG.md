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

At the Sprint 2 checkpoint, public status and missing-cookie connection reads
used a non-touching lookup. Sprint 6 supersedes that ambient-cookie authority:
one explicit same-origin bootstrap creates a high-entropy page-memory
capability, and every stateful read or mutation now requires its header. No
cookie is issued or accepted as authority.

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
no allocation/provider on public status reads; cross-site rejection before
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
user-directed educational planning with exactly one fresh editable-draft
handoff;
Sprint 5 is only a locked live-readiness preview. It must not reuse
`execution_confirmation.v2`, expose a Trade field or confirm control, import
an executor, or claim “ready to trade.” A future final challenge and
fail-closed durable execution design remain outside this release.

## Sprint 3 — non-executable conditional-plan simulator

### Product Manager requirements

Deliver the premium future-condition story without implying an autonomous
broker: one saved SPOT BUY/SELL absolute BBO condition, one explicit fixture
or fresh View-only check, one short simulation authorization, a compelling
BLOCK and PASS, and a receipt/evidence trail that always ends at orders off.
The template itself must never watch, schedule, poll, recur, or authorize a
future live trade.

### Engineering-lead architecture

Added a deterministic conditional-plan core and a separate server-owned
session state machine. The pure core owns typed schemas, canonical binding,
decimal arithmetic, condition and price evaluation, proposal construction,
receipt creation, and verification. The session layer owns revision,
authorization, atomic one-use consumption, cancellation, revoke, expiry, and
late-result precedence. The browser receives only the safe plan/result view
and cannot supply a decision, receipt, evidence fact, or execution state.

The effective price constraint combines two independent user protections.
BUY uses the lower of the absolute trigger and fresh best-ask slippage
ceiling; SELL uses the higher of the absolute trigger and fresh best-bid
slippage floor. Reference price, raw BBO-derived bound, effective authorized
limit, exact proposal, evidence, authorization, and receipt are bound.

### Senior full-stack implementation

Built the real **Plans** journey: editable Action / If / Limits / Until
mandate ribbon; browser-local read-only timezone; 1-hour, 24-hour, or 7-day
duration; explicit labeled fixture versus connected View-only source;
**Save & simulate**; one-check authorization; condition-not-met, BLOCK, PASS,
and REVIEW results; irreversible revision revoke; and a proof timeline ending
at `LOCKED · no order submitted`.

The exact-proposal card makes the price decision inspectable. It shows order
type, size, limit price, fee cap, observed best ask/bid, raw slippage
ceiling/floor, and the effective bound after the absolute trigger. Provenance
is exclusive: generated fixture, Coinbase observed at time, or Coinbase
unavailable/unable to verify.

### Backend and data

Plans and their revisions are process/session-only. Edits supersede the prior
digest and abort its work. A simulation authorization lasts 30–600 seconds,
binds one plan revision and source, and is consumed synchronously before any
evidence fetch. View-only rechecks the session credential and reads only exact
product plus one BBO; failure returns a three-field unavailable object and
`REVIEW`, never fixture fallback.

Cancellation is a same-origin server mutation, not a browser illusion. It can
tombstone an authorized-but-not-started grant or abort `CHECKING`; repeated
cancellation is idempotent and records one activity item. If verified
completion wins first, the endpoint returns that exact result for truthful UI
recovery. `REVOKED`, `EXPIRED`, and `SUPERSEDED` remain terminal; `EXPIRED`
stays sticky across wall-clock rollback.

### DevOps and release review

Conditional routes are explicit and bounded. There is no conditional Create,
execute, generic proxy, watcher, scheduler, WebSocket, background task, or
execution-adapter import. The capability contract was changed only after the
focused and repository-wide gates passed. README, roadmap, design contract,
threat model, and this log were updated before the checkpoint push.

Sprint 4 educational-planning source and tests were kept untracked and outside
this isolated Sprint 3 commit.

### Designer and frontend critique

Synthetic internal critique found three material trust problems and all were
fixed: a trigger far from BBO could make a self-declared slippage value look
safe; failed View-only facts could be described as observed; and an editable
timezone label did not control `datetime-local` semantics. The shipped UI
derives the exact price bound from BBO, makes the source state exclusive, and
uses duration plus the read-only resolved browser timezone with explicit local
time/zone copy.

The first narrow-layout check found a 389-pixel overflow at a 320-pixel
viewport from non-wrapping premium/status badges. The top line now wraps,
containers use `min-width: 0`, badges wrap at 360 pixels, and exact-proposal
grids collapse to one column.

### QA

The Sprint 3 focused parallel gate passed **57/57**. It covers BUY and SELL
with either trigger or BBO slippage as the tighter constraint; 10,000-bps SELL
floor safety; 18-decimal BBO precision; semantic and cryptographic tampering;
old-receipt replay; missing/stale/crossed/source-mismatched evidence; revision,
revoke, expiry, rollback, one-use, concurrent double-submit, invalid scenario
ordering, no-session allocation, delayed-provider cancellation, completion
before cancellation, idempotent cancellation activity, exclusive provenance,
duration/timezone copy, exact proposal labels, and route/import denial.

The complete working-tree suite passed **587/587**. That run included the
separate untracked Sprint 4 educational-core tests; those files are explicitly
excluded from this checkpoint.

Real in-app browser interaction completed BUY `BLOCK → fresh authorization →
PASS` and SELL `PASS`. Both exact-proposal cards showed side-correct ask/ceiling
or bid/floor calculations, receipt verification, and execution lock. Two
additional automation attempts failed in the browser-control sandbox because
its evaluation context exposes neither `window.fetch` nor
`document.createElement`; they did not produce an application/API failure.
Cancellation ordering is therefore evidenced by the deterministic
delayed-provider server tests plus static UI recovery contract, not a
fabricated browser race.

The post-fix 320-pixel metric could not be rerun in that sandbox, and terminal
Playwright was unavailable because `npx` is not installed. The overflow defect
was fixed and statically regressed; this limitation is recorded rather than
silently treating the failed harness calls as a visual pass.

### Target-user qualitative feedback

Synthetic composite feedback only: the Action / If / Limits / Until ribbon
makes the plan understandable without schema knowledge, while the exact
three-price explanation answers the skeptical question “what price did the
guard actually permit?” Clear fixture/View-only provenance and the persistent
“nothing is watching” line prevent the premium surface from feeling like a
false autonomous-trading promise.

### Shipped impact

At the Sprint 3 checkpoint, the development branch supported a polished,
revisioned conditional SPOT
BUY/SELL template and one explicitly authorized simulation check. It can
demonstrate condition-not-met, meaningful BLOCK, exact PASS, or unable-to-
verify REVIEW with a locally verified receipt and server-owned replay/cancel
protection. Saved monitoring, unattended execution, Coinbase Create, Trade
credentials, production Delta, research, portfolio planning, and live-order
readiness were disabled at that checkpoint.

## Sprint 4 — neutral educational planning and one editable-draft handoff

### Product Manager requirements

Make exploration useful without turning it into advice or an implicit
purchase. The user must choose the assets, weights, scenario assumptions,
source, one handoff leg, and trade side. The product may describe a market
snapshot and calculate concentration or a mechanical scenario, but it must
never rank assets, assess suitability, recommend a portfolio, authorize a
batch, or auto-buy.

The acceptance language is deliberately non-executable:
`PLAN VALID FOR EDITING · NO TRADE AUTHORIZED`, followed only after an explicit
handoff by `DRAFT CREATED · NOT AUTHORIZED · ORDERS OFF`.

### Engineering-lead architecture

Added a deterministic educational-planning core plus a separate session-owned
plan layer. Browser requests carry only narrow user inputs or an opaque plan
ID, exact revision, one leg ID, and explicit `BUY` or `SELL`. The server owns
source selection, snapshot construction, versioning, digests, calculations,
handoff state, and redacted view models.

Coinbase provenance is a capability, not a shape. A handler-private authority
brands only normalized results returned by the injected allowlisted View-only
adapter. The public market normalizer performs structural validation only.
Direct normalized objects, lookalikes, JSON clones, and values from another
authority cannot become `Coinbase observed`.

### Senior full-stack implementation

Built the real **Plans → Educational planning** workspace. It starts blank:
no planning amount, asset, weight, scenario attribution, handoff leg, or side
is selected. An explicit **Load mechanical example · not a recommendation**
control can fill a 10,000 USDC BTC/ETH example for editing without creating a
plan. It also clears any stale input error so corrected values are not paired
with obsolete recovery copy.

The user chooses `Generated fixture` or one fresh connected View-only
product/BBO snapshot. Cards render market and educational provenance
separately, including the exact checked-in label
`Locally curated summary of primary source`, publisher, catalog review date,
content digest, and canonical source link. A compact risk disclosure says
digital-asset prices can be volatile, liquidity and availability can change,
scenarios are not forecasts, and the tool does not assess suitability.

The allocation canvas uses asset-specific accessible labels. Scenario values,
including zero, become `User supplied` only after explicit acknowledgement.
One explicit leg plus `BUY` or `SELL` creates a new editable draft. The Advisor
composer receives that text only when the user chooses to edit it; no implicit
plan, authorization, preflight, Preview, or Delta request occurs.

### Backend and data

Educational snapshots, plans, revisions, handoffs, and activity are
process/session-only. Fixture and View-only modes are exclusive; stale,
missing, partial, malformed, or unavailable View-only facts return `REVIEW`
without fixture fallback or observed provenance. Research remains ineligible
as Guard evidence.

Every accepted revision first resolves the current opaque plan/revision and
then obtains a fresh snapshot for the complete newly selected product set from
the same explicit source. Adding an asset, retrying a View-only outage, or
editing after expiry therefore cannot reuse incomplete or stale facts.

Checked-in educational summaries carry canonical publisher/URL,
`catalog_reviewed_at`, and a content digest rather than pretending they were
retrieved live. Local concentration and scenario calculations have their own
provenance. A rejected or unacknowledged scenario is omitted from the returned
artifact instead of being mislabeled as user supplied.

The handoff consumes one current plan revision atomically. Fee, slippage, and
expiry suggestions are labeled `Editable Guard defaults`; they are not
inherited or authorized user constraints. BUY drafts are quote-sized. SELL
drafts are base-sized from the hypothetical educational allocation and
observed planning price, explicitly not a holding or execution fact.

### DevOps and release review

Education routes are explicit same-origin mutations and contain no Coinbase
Create, execution, generic proxy, background monitor, balance, Preview, or
Trade-key path. Provider calls are dependency-injected fakes in tests; no real
credential or external network was used. Capability flags for educational
research and portfolio planning were enabled only after the vertical UI/API
path, redaction, provenance, and adversarial tests passed.

README, security policy, roadmap, design contract, threat model, and this log
were updated before the isolated Sprint 4 checkpoint. Sprint 5 work remains
outside this commit.

### Designer and frontend critique

Synthetic internal review—not customer proof—found four important trust
problems during the sprint: a preselected 60/40 allocation looked like a
recommendation; the first leg and `BUY` side could be inferred; checked-in
paraphrases could visually inherit a Coinbase badge; and untouched zero
scenarios could be called user supplied. The shipped surface starts blank,
requires explicit scenario acknowledgement, separates every provenance class,
and requires both one leg and side.

The Activity view now merges and sorts redacted CLI Guard history with newer
session connection, conditional, and education events instead of silently
hiding one stream. At 320 pixels, the compact safety strip and single-column
education entry remained visible in the in-app browser.

### QA

The focused deterministic core/session/UI gate passed **49/49**. The focused
education/advisor server gate passed **26/26**. The complete working-tree suite
passed **611/611**.

Coverage includes blank defaults; explicit example loading; scenario
acknowledgement omitted, false, or string-forged; zero-value provenance;
accessible asset-specific labels; explicit leg plus side; BUY and SELL draft
shapes; forged facts, source labels, digests, IDs, and revisions; direct
normalizer and cross-authority attacks; cross-session and second handoff;
View-only outage/partial/stale data with no fallback; education IDs rejected by
advisor authorization; asset-add refresh, expired-fixture refresh, and
View-only `REVIEW` recovery; and proof that handoff performs no advisor
authorization or preflight.

Real in-app browser interaction completed the blank-input recovery, explicit
mechanical-example load, acknowledged 60/40 scenario plan, separate provenance
cards, missing leg/side recovery, explicit ETH `SELL` handoff, and editable
Advisor prefill. The result remained `NOT AUTHORIZED` with Orders off. A
320×800 screenshot confirmed the responsive safety context. The browser
harness did not expose reliable script-evaluation width metrics; the supported
screenshot and static responsive tests were used instead, and that limitation
is recorded rather than treated as a pass.

A final live recheck confirmed the visible risk disclosure, blank required
planning amount, blank zero-value allocation inputs, unchecked scenario
acknowledgement, and that loading the mechanical example alone fills 10,000
USDC while keeping acknowledgement unchecked and clearing the prior
blank-input error. The tab closed successfully; an attempted optional browser-runtime
finalizer was unsupported by the harness and had no application or validation
impact.

### Target-user qualitative feedback

Synthetic composite feedback only: starting with an empty canvas avoids the
feeling that the advisor has already chosen a portfolio. Separate provenance
badges and the short risk note make it clear which facts came from Coinbase,
which explanation was curated locally, what was calculated, and what the user
supplied. Requiring one leg and side feels like deliberate planning, while the
draft-only handoff preserves a low-friction path back to the protected trade
flow.

### Shipped impact

The development branch now supports a neutral market snapshot and editable
allocation-planning experience with five explicit provenance classes, an
honest risk boundary, and one fresh editable BUY/SELL draft handoff. No trade
is authorized, no portfolio plan becomes Guard evidence, and no automatic or
portfolio-wide transaction exists. Saved monitoring, unattended execution,
Coinbase Create, Trade credentials, production Delta, and post-PASS
live-order readiness remain disabled.

## Sprint 5 — locked future live-confirmation explanation

### Product Manager requirements

Explain the commercial value of exact post-PASS protection without pretending
the current product can place an order. Only a fresh, complete connected
View-only PASS may show what a future live confirmation would protect. The
normal user must see exact action/economics/freshness, Orders off, and the
missing production controls—not an enabled confirmation, Trade-key field,
grant, or “ready to trade” claim.

### Engineering-lead architecture

Added one pure server-side projection to the existing allowlisted advisor
result view. It creates no endpoint, POST, session identity, challenge, grant,
credential mode, executor import, or browser-derived state. The capability
loader and server status projection both fail startup if
`post_pass_final_confirmation_readiness`, `durable_executor`,
`live_execution`, `autonomous_execution`, or `coinbase_create` becomes true.
The only enabled execution-adjacent flag is
`live_readiness_preview=true`.

The projection requires exact View-only PROBE mode/status/decision, a
receipt-verified and unexpired `PASS`, canonical action integrity, matching
proposal descriptor, all four authenticated Coinbase source records, complete
account/funding evidence, PASS proposal and Preview checks, exact Preview
request/transport binding, bound prospective Create digest, matching
credential/portfolio scope, current preflight, one-use policy, and untouched
adapter/order/gate fields. The record digest is mandatory and recomputed;
supplied and bound execution digests must be present and equal; and allowlisted
permission facts must prove a View-only, non-Trade key. Confirmation time plus
the authorized TTL must equal policy expiry, and receipt/preflight expiry may
not outlive it. Malformed, contradictory, expired, or future clocks fail
closed.

### Senior full-stack implementation

The PASS result now renders **What a future live confirmation would protect**
immediately after `No order submitted`, before receipt detail. It shows
`DESIGN PREVIEW · LOCKED`, `ORDERS OFF`, the exact action and limit, estimated
economics, Preview check/expiry, a future one-order concept with no challenge
or grant, and all nine missing production prerequisites. Every prerequisite is
visibly marked `Missing`.

The card has no button, link, input, positive tabindex, confirm/place/submit
copy, or client-side reconstructed binding. The browser requires both the
capability flag and exact server projection. The old disabled live-order
button was replaced by static `Orders off · no live confirmation available`
status.

### Backend and data

The returned DTO contains only allowlisted policy/action/economics/time labels
and boolean binding summaries. It excludes raw Create bytes, client order ID,
Preview ID, account ID, raw Coinbase response, credential/portfolio
fingerprint, bound permission details, final-review challenge, execution
confirmation, and grant ID. Estimated impact is re-derived from the exact
Preview evidence rather than trusting a mutable settlement display field.

The local Guard receipt remains local SHA-256 integrity evidence. It is not a
production Delta signature or execution authorization. View-only PROBE stops
before production Delta, so the UI correctly lists production Delta
verification as missing and never treats `execution_confirmation.v2` as final
order confirmation.

### DevOps and release review

No route was added. Explicit regressions keep live-readiness,
final-confirmation, final-review-challenge, grant, claim, execute, Create,
orders, submit, place, and proxy paths at `404`. The existing dependency-
closure test still proves the advisor cannot import the Coinbase execution
REST adapter or `createCoinbaseExecutionAdapter`.

README, security policy, roadmap, design contract, threat model, capability
contract, and this log were updated before the isolated Sprint 5 checkpoint.
The public version remains v1.5.3 until Sprints 6–7 and the actual release
archive gates complete.

### Designer and frontend critique

Synthetic internal review—not customer proof—found that a disabled “Live order
unavailable” button still looked like a latent action, and that “before
anything becomes eligible” overstated the current state. The shipped revision
uses static Orders-off status and says the mandate is inspected before any
future live confirmation could be considered.

The explanation uses progressive disclosure: it gives the exact action,
economics, freshness, and missing-control checklist without hashes or schema
ceremony. At mobile width its facts and prerequisite list stack to one column.

### QA

Focused capability/UI/dependency tests passed **26/26**. Focused loopback,
redaction, route, View-only integration, and tamper tests passed **24/24**.
An additional direct-pipeline scope gate passed **8/8**, for **58/58** focused
tests overall. The complete repository suite passed **620/620**. Local links,
skill metadata, v1.5.3 release metadata, and diff integrity also passed.

Adversarial coverage mutates the policy, canonical action, exact proposal,
Preview request and response, normalized evidence, prospective Create digest,
credential scope, portfolio scope, every Coinbase provenance class, account
completeness, proposal/Preview decisions, nonce, preflight fingerprint,
receipt, timestamps, adapter state, order ID, transmitted-body digest, and
one-time-gate state. Every mutation omits the projection. Feature-disabled,
dry-run, missing-connection REVIEW, expired, future-clock, and invalid-clock
paths likewise fail closed.

The final adversarial pass also removed an optional-integrity seam: missing or
blank top-level record digests, resealed contradictory boundary/source facts,
receipt-unbound settlement mutation, and a mismatched supplied execution
digest, expired policy window, or shifted confirmation time all omit the
projection. A Trade-enabled credential is rejected before any PROBE adapter
call. The mutation harness reseals every non-digest case so it exercises the
deeper receipt and semantic invariants rather than stopping at the outer
digest. A source regression proves the released advisor view-model contains no
debug-readiness environment branch or console logging.

An independent read-only Sprint 5 security audit reported GO: strict
capability fail-close, fresh complete receipt-verified View-only PASS only,
no sensitive material leakage, no new readiness/execution/Create/proxy route
or executor import, and a static locked UI with no interactive order control.
This is internal synthetic assurance, not customer or third-party
certification.

The supported in-app browser completed the actual credential-free example:
empty composer → example fill → mandate review → one-check authorization →
verified PASS, with `No order submitted`, no readiness card on dry run, and
static Orders-off status. At a 320×800 viewport, inner, body, and document
width were all 320 pixels, horizontal overflow was false, the compact
`Dry run / Coinbase off / Orders off` bar remained visible, the unfocused
composer was 46 pixels high, and the console had zero warnings or errors.
No real credential was used; the View-only locked card is covered by the
injected fake-provider server integration and static DOM contract rather than
fabricating provider evidence in the browser.

One browser locator waited for the literal text `MANDATE CAPTURED` while the
accessible region was named `Mandate captured`; it timed out, then a fresh DOM
snapshot confirmed the mandate was already rendered correctly. The
subsequent supported interaction completed. This was test-harness locator
case mismatch, not an application or API failure.

### Target-user qualitative feedback

Synthetic composite feedback only: the locked card answers “what would a real
confirmation eventually protect?” without turning a successful View-only
check into a trading CTA. The missing-prerequisite list makes the security gap
concrete, while keeping it behind a successful optional connection means the
credential-free first experience stays fast and calm.

### Shipped impact

The development branch can now explain the exact future execution boundary
after a qualified View-only PASS while remaining non-actionable. It does not
issue authorization, eligibility, a challenge, grant, Trade credential,
production Delta proof, Create request, order, or money movement. Orders
remain off.

## Sprint 6 — authority, abuse, accessibility, and packaged-app hardening

### Product Manager requirements

Make the credential-capable local Advisor releasable without turning safety
into visible friction: useful dry run first, optional View-only connection,
one compact Orders-off boundary, responsive recovery, and no credentialed
release while ambient loopback authority, feature-disable gaps, unbounded
session data, or a source-only frontend package remains.

### Engineering-lead architecture

Replaced the loopback cookie with an explicit 256-bit random capability
returned by `POST /api/session` and held only in the open page’s JavaScript
memory. Cookies are neither issued nor accepted. Every stateful read and
mutation requires the custom capability header plus the existing exact
Host/Origin/Fetch-Metadata contract. A new atomic session-store `touch`
operation resolves and extends only an existing unexpired token; it cannot
fall through to allocation.

Capability flags are now server-enforced operator stops before body parsing,
session resolution, provider construction, or network access. The View-only,
conditional, research, and portfolio paths fail closed when disabled. The
Advisor entrypoint dispatches directly to `src/advisor-server.js`, avoiding
the execution-capable CLI dependency graph.

### Senior full-stack implementation

The browser bootstraps one private page session, sends the capability only as
a same-origin header, clears it on expiry, and never silently replays a failed
state-changing request. The UI preserves the default dry run and disables
controls whose server capability is off.

A fresh View-only PASS can still show only the static locked future-readiness
explanation. At Preview expiry the card demotes itself to an expired,
non-focusable recovery message and the rail returns to
`Preview expired · locked`; no confirmation or order control appears. The
fourth rail state is named **Future preview**, not final action.

The hard-coded 320-pixel document minimum was removed after constrained
browser testing exposed horizontal overflow below that width. The existing
single-column responsive rules now operate at the controller’s 240-pixel
minimum while the normal 320-pixel experience remains intact.

### Backend and data

Conditional and educational plans now retain at most eight full revisions and
sixteen minimal terminal tombstones per plan. The current revision is always
retained. Conditional compaction aborts old in-flight work; a late signed
result cannot revive revision 1 after 100 edits. Educational invalidated-
handoff metadata is capped, redacted, and non-replayable. Same-session plans
compact independently.

Oversized request bodies fail immediately and close rather than continuing to
drain. Header, request, keep-alive, and connection-check timeouts are explicit;
POST concurrency is bounded while public status and static assets remain
available for recovery. No remote telemetry or sensitive request logging was
added.

### DevOps and release review

`./run advisor` now dispatches directly before the CLI can import Coinbase
REST, Create adapters, Trade credential loaders, or the live pipeline. The
release allowlist and managed installer require `web/index.html`,
`web/app.js`, `web/styles.css`, `src/advisor-server.js`, and every
README-linked Advisor design/security document. Archive scanning includes the
frontend, and credential-canary tests construct their markers at runtime so
test coverage does not place credential-shaped source in the artifact.

The cold validator installs under restricted `PATH`, deletes the extracted
source, launches the managed Advisor, fetches HTML/JavaScript/CSS/status,
checks security headers, no cookies, no external assets, and locked status,
then probes GET and POST on execution, Create, order, proxy,
live-readiness, final-review, grant, and claim routes for `404`.

The first committed-candidate build passed this complete cold gate under Node
24: **157** allowlisted text files, **1,766,162** bytes, deterministic archive
and content scan, managed install under restricted `PATH`, extracted-source
deletion, direct Advisor launch, UI/JavaScript/CSS/status fetches, and absent
execution routes. It intentionally retained the public v1.5.3 package metadata;
Sprint 7 owns the coordinated v1.6.0 metadata, tag, and release.

### Designer and frontend critique

Synthetic internal review—not customer proof—found three concrete trust
issues: a cookie could be replayed across loopback ports; the terminal banner
said “no credentials” even though an optional View-only connection exists;
and an expired locked card added a focusable recovery button that violated the
non-actionable S5 contract. The shipped revision removes cookie authority,
says **Dry run default · optional View-only connection**, and keeps expired
recovery static.

Credential copy now says exactly where a key exists: briefly in the form,
page JavaScript, and one same-origin loopback request, then in server-process
memory after receipt. It does not claim that the browser never sees the key.

### QA

The focused Sprint 6 session/security/UI/revision/credential/direct-launch gate
passed **72/72**. The adjacent conditional and education core/API/session gate
passed **85/85**. The complete repository suite passed **640/640**.

Coverage includes missing/cookie/cross-server/cross-port capability attempts;
the exact idle-expiry allocator race; feature stops before body/session/
provider work; no `Set-Cookie`; secret-canary redaction; 32 slow loopback
bodies; early oversized-body close; explicit timeouts; 100 conditional edits;
400 educational handoff/revise cycles; minimal tombstones; late PASS and stale
handoff replay; static locked-readiness expiry; direct Advisor dependency
closure; and all absent Create/execution routes.

An independent read-only security recheck initially found the atomic-expiry
race and release-scanner canary conflict. After correction it reported GO
with no remaining P0/P1: **157/157** focused tests, **64/64** authority probes,
**65/65** reachability probes, and the same **640/640** full suite. This is
internal synthetic assurance, not third-party certification.

Real Chrome interaction at 320×900 completed example fill, Tab from the
composer to **Prepare mandate**, Enter activation, Tab through **Edit intent**
to **Authorize for one check**, and Enter to a locked PASS. Document width and
scroll width remained 320 pixels, the safety bar remained present, `No order
submitted` was visible, and no interactive order control existed. The app
console had no warning or error from the loopback origin.

The browser controller did not expose a working browser-zoom setting: two
supported zoom-key attempts left the reported viewport and device pixel ratio
unchanged. That limitation is not counted as a 200% browser-zoom pass.
Replacement constrained evidence used the controller’s 240-pixel minimum,
where client and scroll width both remained 240 with no horizontal overflow,
plus the genuine 320-pixel keyboard path above. The previous 320-pixel CSS
minimum was removed specifically to make zoom/reflow safer.

### Target-user qualitative feedback

Synthetic composite feedback only: the private page session is invisible in
the ordinary flow, so stronger authority does not add onboarding work.
“Optional View-only connection” is more credible than “no credentials,” and
static expiry recovery feels safer than a button inside a future-order design
card. The persistent safety bar and keyboard-operable one-check path keep
Delta protection understandable without exposing hashes or session details.

### Shipped impact

Sprint 6 turns the development Advisor into a bounded, packageable,
operator-stoppable local product while preserving the dry-run-first
experience. It adds no Coinbase Create, Trade credential, final-confirmation
challenge, execution grant, durable executor, order, money movement, or
production Delta integration. Sprint 7 still owns final UX consolidation,
version metadata, public archive/checksum, CI evidence, and release.
