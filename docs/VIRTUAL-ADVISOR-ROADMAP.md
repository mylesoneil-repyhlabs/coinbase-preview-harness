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
It can demonstrate a separate, exact-action final-confirmation challenge for
readiness, but Create remains unavailable. The final state therefore remains
visibly locked.

Any policy, proposal, Preview fingerprint, prospective Create payload,
freshness, receipt, session, or expiry change invalidates the later state.

## Eight-sprint delivery

| Sprint | Shippable outcome | Release gate |
| --- | --- | --- |
| 0 | Roadmap, design contract, threat model, feature flags, test plan | Current v1.5.3 boundary audited; no hosting project invented |
| 1 | Actual local advisor UI and valuable credential-free dry run | Loopback launch; mandate authorization; PASS/BLOCK/REVIEW; responsive visual review |
| 2 | Session-only View-only connection and real preflight wiring | No persistence or secret leakage; exact permissions; graceful provider failures |
| 3 | Premium conditional saved-plan composer and trigger simulator | Simulation labels; timezone/expiry/revoke/one-shot; no monitoring claim |
| 4 | Educational token exploration and editable portfolio planning | Source/as-of/assumptions/risk; no suitability or automatic trade |
| 5 | Exact final-review and post-PASS confirmation readiness | Challenge binds receipt, preflight, exact payload, session, expiry; still no Create |
| 6 | Abuse, accessibility, responsive, performance, and recovery hardening | Adversarial suite and browser walkthrough clean |
| 7 | Polish, onboarding, screenshots, deployment guide, deterministic release | README truthful; archive/install/CI/public checksum green |

## Feature modes

`config/advisor-capabilities.json` is the user-visible and testable capability
contract. A feature is not enabled merely because a card exists.

- `dry_run`: default; local fixtures; no credential or network.
- `view_only_preflight`: optional; local loopback only; point-in-time Coinbase
  permissions, balances, product, BBO, and Preview.
- `conditional_plan_simulation`: saved plan and trigger simulation only.
- `educational_research`: source-labelled planning content, not advice.
- `post_pass_final_confirmation_readiness`: local consent evidence only; not a
  durable grant.
- `coinbase_create`, `live_execution`, `autonomous_execution`: disabled.

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
- no browser-storage, Create route, generic proxy, Trade-key, or secret-log
  surface is reachable;
- existing guard, install, archive, content-scan, and Node 22/24 CI checks pass;
- a clean public artifact and checksum are downloaded and re-verified.
