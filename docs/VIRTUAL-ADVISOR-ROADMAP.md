# Delta Guard Advisor v1.6 roadmap

## Product promise

Delta Guard Advisor is a protected execution copilot for Coinbase Advanced
Trade spot planning. A person can speak naturally, inspect an editable
plain-English mandate, authorize one check, see the exact proposal and
`PASS`/`BLOCK`/`REVIEW`, and understand what would happen without mistaking a
Preview for an order.

It is not an autonomous broker, a Coinbase product, personalized financial
advice, or a live execution service.

## Starting boundary

The v1.5.3 core already provides deterministic spot BUY/SELL policy
compilation, explicit authorization, held-fund and product checks, side-aware
BBO and Preview evidence, exact prospective Create-payload binding, local
receipts, redacted history, replay protection, and a View-only route
allowlist. Public Create is compile-time locked.

The advisor must reuse those functions instead of reimplementing the guard in
browser code. Model activity, when explicitly enabled, is limited to
extraction, clarification, and explanation. Deterministic server code owns
validation, decimal arithmetic, evidence, decisions, binding, receipts, and
mode status.

## Architecture

The repository has no `.openai/hosting.json`. v1.6 therefore uses the existing
dependency-free Node 22 architecture:

```text
same-origin browser UI
        |
        | allowlisted view models only
        v
loopback Node advisor server
        |
        +-- in-memory session / plan / credential broker
        +-- existing createExecutionPlan()
        +-- existing runGuardPreflight()
        +-- existing receipt + redacted history
        |
        +-- View-only Coinbase adapter
        |   permissions, accounts, exact product, BBO, Preview
        |
        X  no Create route, generic proxy, Trade key, or executor
```

The browser receives no private key, JWT, raw Coinbase body, account ID,
provider header, or unrestricted domain object after connection. Credential
material is never stored in browser storage, history, analytics, logs, the
repository, or a release artifact.

## Product state machine

The interface always shows the current state:

1. `Draft`
2. `Mandate review`
3. `Authorized`
4. `Proposed`
5. `Previewed`
6. `Delta evaluated`
7. `Final confirmation`
8. `Submitted / reconciled`

v1.6 can reach `Delta evaluated` in dry-run simulation or View-only preflight.
Sprint 5 can explain, in a locked live-readiness preview, what a future
post-PASS confirmation must protect. It does not create that confirmation
challenge, unlock Create, or make the product “ready to trade.” The final state
therefore remains visibly locked.

Any policy, proposal, Preview fingerprint, prospective Create payload,
freshness, receipt, session, or expiry change invalidates the later state.

## Eight-sprint delivery

| Sprint | Shippable outcome | Release gate |
| --- | --- | --- |
| 0 | Roadmap, design contract, threat model, feature flags, test plan | Current v1.5.3 boundary audited; no hosting project invented |
| 1 | Actual local advisor UI and valuable credential-free dry run | Loopback launch; mandate authorization; PASS/BLOCK/REVIEW; responsive visual review |
| 2 | Session-only View-only connection and real preflight wiring | No persistence or secret leakage; exact permissions; graceful provider failures |
| 3 | Premium conditional saved-plan composer and one-check simulator | Non-executable revisioned template; fresh 30–600s simulation authorization; no watcher, timer, scheduler, or live authorization |
| 4 | Educational market snapshot and editable allocation planning | User-selected inputs and exact provenance; one fresh editable leg handoff; no suitability, batch approval, or automatic trade |
| 5 | Locked live-readiness preview | Explain exact future post-PASS protection and missing prerequisites; no challenge, focusable confirm, Trade field, Create route, or executor import |
| 6 | Abuse, accessibility, responsive, performance, and recovery hardening | Adversarial suite and browser walkthrough clean |
| 7 | Polish, onboarding, screenshots, deployment guide, deterministic release | README truthful; archive/install/CI/public checksum green |

Current development checkpoint: Sprints 0–6 are implemented. Sprint 3 is a
non-executable conditional template and one-check simulation only. Sprint 4
is neutral educational planning with a fresh editable one-leg handoff; it
does not create Guard evidence or authorize a trade. Sprint 5 is a locked
server-derived explanation shown only for a fresh, complete, locally
receipt-verified View-only PASS. Sprint 6 replaces ambient cookie authority,
enforces operator feature stops at the server, bounds session resource use,
packages the real Advisor, and preserves the no-execution dependency closure.
Sprint 7 remains behind its polish and public-release gates.

## Feature modes

`config/advisor-capabilities.json` is the user-visible and testable capability
contract. A feature is not enabled merely because a card exists.

- `dry_run`: default; local fixtures; no credential or network.
- `view_only_preflight`: optional; local loopback only; point-in-time Coinbase
  permissions, balances, product, BBO, and Preview.
- `conditional_plan_simulation`: a saved non-executable plan plus one fresh
  explicitly authorized check; nothing is watching.
- `educational_research`: neutral source-labelled market snapshot and planning
  content, not advice.
- `portfolio_planning`: blank-start, user-directed allocation and scenario
  canvas with one explicit leg-plus-side handoff to an unauthorized draft.
- `live_readiness_preview`: a locked explanation of future prerequisites only.
- `post_pass_final_confirmation_readiness`: disabled. No final challenge or
  durable grant exists.
- `coinbase_create`, `live_execution`, `autonomous_execution`: disabled.

### Sprint 3 implementation contract

The only condition in scope is a one-shot spot trigger: BUY when fresh ask is
at or below an absolute threshold, or SELL when fresh bid is at or above one.
A saved template is non-executable. A later check requires a new, 30–600
second simulation authorization and chooses either fixture or one fresh
View-only source; it never falls back between them.

The editable browser form is the conceptual `DRAFT`; the first sealed
server/session state is `READY_FOR_SIM_AUTH`. It then progresses to
`AUTHORIZED_FOR_SIMULATION → CHECKING`, followed by
`CONDITION_NOT_MET`, `WOULD_TRIGGER_SIMULATION`, `BLOCKED`, or `REVIEW`.
`REVOKED`, `EXPIRED`, and `SUPERSEDED` are terminal, with precedence in that
order. Edits create a new revision. Revoke tombstones the revision and aborts
in-flight work. No “active,” “watching,” “triggered,” or “submitted” state,
timer, poller, recurrence, trailing condition, or multi-action plan exists.
The browser exposes only fixed 1-hour, 24-hour, or 7-day durations and derives
the absolute expiry in its resolved read-only local timezone.

For every prepared proposal, deterministic code derives two independent price
constraints from the saved mandate and fresh BBO. BUY uses
`min(absolute trigger, best ask plus allowed bps)`; SELL uses
`max(absolute trigger, best bid minus allowed bps)`. The proposal, receipt,
and proof bind the observed reference, raw BBO-derived bound, and effective
authorized limit. The UI renders all three rather than trusting an
agent-declared slippage value. At 10,000 bps, the raw SELL floor remains a
positive minimum decimal unit and the effective floor still takes the maximum
with the absolute trigger.

The server owns one-use consumption and cancellation. It consumes a matching
authorization before evidence fetch, tombstones cancellation to `REVIEW`,
aborts the in-flight provider signal, and rejects late results. If completion
wins the race, cancellation returns the already verified result so the UI
cannot falsely say it was cancelled. Expiry is a sticky terminal state even
if the wall clock later moves backward.

### Sprint 4 implementation contract

Coinbase product and BBO facts are a **market snapshot**, not token research.
Educational planning uses the exact provenance labels `Coinbase
observed`, `Generated fixture`, `Locally curated summary of primary source`,
`Calculated locally`, and `User supplied`. Coinbase-observed provenance is
issued only inside a handler-private authority from the allowlisted View-only
adapter; public normalization is structural validation, not source
attestation. Checked-in paraphrases carry publisher, canonical URL, catalog
review date, and content digest. Research never counts as Guard evidence and
missing/stale facts do not silently fall back to fixtures.

An allocation plan is session-only and versioned. The user chooses assets and
weights; the product may calculate concentration and neutral scenarios, but
never ranks assets, says “best,” makes suitability claims, or auto-buys. The
canvas begins with no planning amount, selected asset, or weight; an optional
generated mechanical example is explicitly labeled not a recommendation. The
user must acknowledge scenario assumptions, including any zero values, before
they can be labeled user-supplied. Every accepted revision obtains a new exact
snapshot of the full selected product set through the same explicit source, so
asset additions, source recovery, and expiry cannot reuse stale or incomplete
facts.

A handoff requires an explicit selection of exactly one leg and `BUY` or
`SELL`. It creates only a fresh editable protected-trade draft with visibly
editable Guard defaults for fee, slippage, and expiry. It does not authorize,
preflight, or evaluate that draft. A new mandate, fresh evidence, and separate
authorization remain required. Any plan edit invalidates that handoff.
Portfolio-wide approval, batch trades, and rebalancing remain absent.

### Sprint 5 implementation contract

The only enabled readiness capability is `live_readiness_preview=true`. Final
confirmation readiness, a durable executor, live execution, and Create remain
false. Only a fresh, complete, exact View-only `PREVIEW_PROBE_PASS` with a
verified, unexpired local receipt may show **What a future live confirmation
would protect**: the exact action, price bound, estimated economics, Preview
time and expiry, future one-order concept, and a nine-item missing-prerequisite
checklist. Dry run, `BLOCK`, `REVIEW`, stale evidence, partial bindings,
tampering, source mismatch, credential/portfolio drift, or any execution field
change omits the projection. “Orders off” remains prominent; no enabled or
focusable confirmation/order action exists.

The projection is a safe allowlisted view over a digest-sealed record. It also
requires exact equality between the supplied and bound execution digests plus
receipt-bound allowlisted facts proving View-only, non-Trade scope. It exposes
no raw Create body, client order ID, Preview ID, account ID,
credential/portfolio fingerprint, permission detail, challenge, grant, or new
digest. The local receipt is integrity evidence only, not production Delta
authorization. The advisor has no
live-readiness POST, final-confirmation, grant, claim, Create, order, submit,
place, execute, or proxy route, and its dependency closure excludes the
Coinbase execution transport.

`execution_confirmation.v2` remains preflight-readiness evidence and must not
be reused. A future production design requires a new server-authoritative
`delta.coinbase.final_review_challenge.v1` bound to session/principal,
plan/policy/action/proposal, Preview request and response, evidence, exact
prospective Create UTF-8 bytes, credential/portfolio, production Delta proof
and verifier, kill-switch epoch, expiry, and maximum uses. Its kill switch
starts `STOPPED` and any executor requires a durable journal and
reconciliation. None of that is implemented by this release.

### Sprint 6 implementation contract

One explicit same-origin `POST /api/session` creates a 256-bit random
page-memory capability. It is not a credential and is never a cookie. Every
stateful read or mutation requires the capability header; resolution and
last-used extension happen atomically, so an expiring token cannot allocate a
replacement session or reach a provider. Exact Host/Origin/Fetch-Metadata
checks still apply to each request. Reload loses the browser capability;
disconnect and server expiry erase retained provider state.

Operator-disabled View-only, conditional, research, or portfolio features
return before request-body parsing, session resolution, provider construction,
or network access. The Advisor launcher dispatches directly to
`src/advisor-server.js`; it does not load the CLI, Coinbase Create transport,
Trade credential loader, live pipeline, or execution adapter.

Conditional and education plans retain at most eight full revisions and
sixteen minimal terminal tombstones per plan. The current revision is never
compacted. In-flight conditional results, invalidated educational handoffs,
ancient revisions, and second-use attempts cannot revive or create a second
result. Request bodies fail early above the limit, server header/request/
keep-alive timeouts are explicit, mutation concurrency is bounded, and public
status/static recovery remains responsive under slow hostile bodies.

The managed archive must contain the frontend, all linked Advisor documents,
the direct entrypoint, and its narrow dependencies. Its cold gate installs
under restricted `PATH`, deletes the extracted source, launches `./run
advisor`, fetches the HTML/JavaScript/CSS/status with security headers and no
external assets or cookies, and proves every execution/readiness mutation
route remains `404`.

## Test plan

Every sprint keeps the existing Node suite green and adds focused regression
tests. The final matrix covers:

- intent clarification, mandate edits, exact authorization, all three
  decisions, history, and evidence details;
- route/method/Origin/Host/Fetch-Metadata enforcement, body limits, no CORS,
  CSP, clickjacking, path traversal, and generic-proxy denial;
- malformed, revoked, over-scoped, stale, mismatched, rate-limited, partial,
  oversized, or unavailable View-only evidence;
- secret canaries across responses, DOM, stdout/stderr, history, screenshots,
  archives, and errors;
- session isolation, disconnect, idle and absolute expiry, restart, replay,
  mutation, concurrency, and double confirmation;
- keyboard operation, visible focus, reduced motion, WCAG AA contrast,
  320-pixel layouts, 200% zoom, and status announcements;
- cold launch, first useful dry run under 60 seconds, progress within two
  seconds, bounded waits, restricted `PATH`, managed install, source deletion,
  deterministic archive, and public checksum.

## Deployment contract

The default server binds to `127.0.0.1`. This is the only v1.6 mode that may
accept a View-only credential.

A generic hosted/static deployment may expose the advisor, simulations,
research, and planning only. Credential controls and Coinbase proxy endpoints
must stay disabled. Enabling remote credential handling requires a separate
reviewed service with TLS, user authentication, tenant isolation, secret
storage, process isolation, audit controls, and a new threat model.

No deployment path may add Coinbase Create or imply unattended execution.

## Release criteria

v1.6.0 is releasable only when:

- README, security policy, roadmap, sprint log, and UI match verified behavior;
- the actual frontend launches from a clean release without a secret;
- dry-run PASS, meaningful BLOCK, and unable-to-verify REVIEW are interactive;
- optional credential entry is local/session-only, explicitly View-only, and
  independently disconnectable;
- public status and static reads allocate no session or provider; stateful
  reads require a page-memory capability created only by the explicit
  same-origin bootstrap, and no cookie is issued or accepted as authority;
- the advisor dependency closure contains no Create/order transport or
  execution adapter;
- conditional, planning, and locked-readiness surfaces satisfy the scoped
  contracts above without enabling background work or execution;
- no browser-storage, Create route, generic proxy, Trade-key, or secret-log
  surface is reachable;
- existing guard, install, archive, content-scan, and Node 22/24 CI checks pass;
- a clean public artifact and checksum are downloaded and re-verified.
