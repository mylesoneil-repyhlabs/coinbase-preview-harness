# Coinbase Guard v1.6 assurance and claim ledger

This is the truth boundary for demos, recordings, engineering reviews, and
partner conversations. It separates reproducible public behavior from
credential-dependent preflight, private Delta, and live execution.

## Reproducible short version

v1.6 accepts one Coinbase Advanced custodial spot BUY or SELL, identifies known
action facts, asks for missing material constraints, compiles a closed v3
policy and canonical v2 action, and pauses for explicit user authorization.

The supported family is:

- runtime-supported spot pair;
- BUY sized/funded in held quote asset or SELL sized/funded in held base asset;
- exact amount or positive agent-selected amount no greater than a maximum;
- price-bounded SOR limit IOC with partial fills;
- side-correct slippage, fee, and debit/net-proceeds bounds;
- optional one-shot BUY best-ask-at/below or SELL best-bid-at/above condition;
- one use, valid 30–600 seconds after authorization.

Default `dry_run` uses labeled local account, product, BBO, and Preview
fixtures plus the local simulated Delta adapter. A successful run ends at
consumed simulated eligibility. It does not contact Coinbase, invoke an
executor, Create an order, or observe an exchange outcome.

Optional `view_only_preflight` uses a session-only user-supplied View-only key
for permissions, complete accounts, the exact product, BBO, and one exact
Preview. A successful result is a **View-only preflight pass**, not a
production Delta decision or execution grant. It stops before Create.

The local Delta Guard Advisor adds an actual browser interface over the same
deterministic Guard. Its primary path is a credential-free protected check.
Optional progressive surfaces provide a one-check conditional simulation and
neutral educational allocation planning. None is a live broker, background
monitor, individualized recommendation, final-order confirmation, or
execution path.

## Claim ledger

| Claim | Public v1.6 status |
| --- | --- |
| Managed Codex install works after the download is deleted | Implemented and cold-install tested |
| A user can begin without credentials | Implemented; this is the default |
| Natural language becomes a closed action-specific mandate | Implemented with deterministic validation and clarification |
| The user authorizes the complete displayed mandate | Implemented procedural UX; host identity authentication remains external |
| Users must copy a digest or path | False; skill keeps both internally, details on demand |
| Generic conditional spot BUY and SELL work | Implemented |
| Pair support is dynamic rather than ETH-specific | Implemented logic; current availability depends on Coinbase/account facts |
| Another asset may silently fund or convert | Prohibited |
| Real Coinbase View-only reads and Preview exist | Implemented direct REST path; requires the user’s separate key |
| A live Coinbase MCP session is used | Not claimed; MCP is topology-only |
| Missing/stale/malformed/mismatched evidence can pass | Prohibited; result is `REVIEW` |
| A verified mandate violation is distinguishable | Implemented as `BLOCK` |
| Default Delta evaluation is real/private | False; it is a labeled local simulation |
| View-only pass is production Delta authorization | False |
| Receipt recomputes exact content bindings | Implemented local SHA-256 verification |
| Receipt is signed by Delta or Coinbase | False |
| Receipt independently authenticates Coinbase as fact source | False |
| Retry and replay are model-controlled | False; deterministic nonce/history code owns them |
| A real order can be submitted | Deliberately unavailable |
| The Advisor is an interactive local product | Implemented; dependency-free loopback UI and server |
| Browser/session authority depends on a cookie | False; page-memory capability header only |
| Credential material never enters browser memory | False; it exists briefly in the local form, JavaScript, and request |
| Credential material is stored in the browser | Prohibited; no browser storage, URL, history, analytics, or log |
| Conditional plans watch or trade later | False; saved template plus one explicitly authorized simulation check |
| Educational planning recommends what to buy | False; neutral editable planning with distinct provenance |
| An education plan authorizes a portfolio trade | False; one explicit leg and side create only a new editable draft |
| A View-only PASS advances to final confirmation | False; Decision is terminal and any What remains disclosure is read-only |

## Decision meanings

| Outcome | Meaning | Recovery/gate |
| --- | --- | --- |
| `PASS` in dry run | Exact simulated proposal and evidence satisfy the mandate and local Delta simulation | Simulated one-use eligibility is consumed; no executor/order |
| `VIEW-ONLY PREFLIGHT PASS` | Fresh, complete Coinbase View/Preview facts satisfy local deterministic checks | Inspection evidence only; Create remains unavailable |
| `BLOCK` | Verified facts show a closed mandate violation or nonce misuse | Proposal locked; change it or authorize a new mandate |
| `REVIEW` | Complete, fresh, matching evidence or binding could not be verified | Refresh or repair the evidence/key; run a new preflight |

Rate limiting, outage, malformed/revoked credentials, partial accounts,
missing product flags, stale or crossed BBO, inconsistent Preview arithmetic,
changed request bytes/fingerprint, expiry, and unknown state are
`REVIEW — unable to verify`, never `PASS`.

## What normal chat must show

The default hierarchy is:

1. `DRY RUN` or `VIEW ONLY` and `NO ORDER`;
2. complete human mandate in plain English;
3. exact typed proposal, if reached;
4. one outcome and one plain-English reason;
5. compact debit/receive/fee impact, if Preview was reached;
6. checked source facts, timestamp/age, and recovery;
7. truthful execution boundary.

Hashes, local paths, receipt bindings, normalized metadata, and record digests
are details-on-demand. An early failure must not claim a proposal, Preview,
Delta result, eligibility, or evidence it did not reach.

## Receipt and history claims

The local guard receipt binds:

- mode, nonce, issue time, and expiry;
- authorized policy and canonical action;
- exact proposal;
- normalized market, funding, and Preview evidence;
- exact Preview request bytes/transport digest;
- prospective Create payload digest, although Create is absent;
- preflight fingerprint and complete decision semantics.

Verification recomputes those bindings from underlying content. Mutating the
policy, proposal, evidence, prospective payload, failure reason, or decision
invalidates verification.

Exact retries can return a prior current result. Reusing a nonce with different
plan/authorization or credential/portfolio semantics blocks. New exact
evidence supersedes the old result; expired and superseded results remain
historical only.

History stores at most 100 redacted local entries with private permissions. It
contains hashes, local IDs, normalized summaries, provenance, age, outcome,
expiry/currentness, and no-order state. It excludes credentials, raw provider
bodies/headers, account IDs, key IDs, key paths, and arbitrary provider error
text. The unkeyed digest is local integrity evidence, not authentication.

## Generic product versus fixed showcase

The generic compiler does not support portfolio-value or post-trade exposure
caps.

The separate fixed 3,000-USDC ETH showcase uses an exposure fixture to tell a
`BLOCK → bounded RETRY → PASS` separation-of-control story. Its values,
evidence, evaluator, and receipt are deterministic fixtures. Do not describe
that exposure rule as generic compiler support, private Delta behavior, or a
live Coinbase result.

Conversely, the fixed ETH showcase is not the only supported action. Generic
logic is pair-aware and supports conditional or unconditional spot BUY/SELL.

## Unsupported claims

Do not say or imply that v1.6:

- placed, submitted, attempted, filled, or guaranteed a Coinbase order;
- integrated with or invoked private Delta;
- produced a production-signed liability receipt;
- independently authenticated Coinbase data;
- exercised live Coinbase MCP;
- supports every Coinbase pair or action;
- supports transfers, conversion, staking, recurring/GTC strategies, balance
  percentages, leverage, derivatives, onchain execution, multi-action plans,
  or generic portfolio exposure; or
- lets the agent authorize, evidence, decide, retry, or execute its own action.

Also do not say or imply that the Advisor:

- stores or cryptographically erases a key;
- uses OAuth;
- monitors a saved condition or can trade unattended;
- offers individualized financial advice, suitability, rankings, or expected
  returns;
- authorizes a portfolio, batch, or rebalance;
- provides a final live-order confirmation, grant, kill switch, durable
  executor, or Create service; or
- advances beyond the terminal Delta decision into an executable state.

The separate checked-in 5-USDC one-order profile is future live-test
blast-radius control only. It is not the economic policy, a credential
authorization, or a live-order approval.

For exact contracts, see
[COINBASE-EVIDENCE-CONTRACT.md](COINBASE-EVIDENCE-CONTRACT.md),
[MANDATE-ADAPTER-CONTRACT.md](MANDATE-ADAPTER-CONTRACT.md),
[COINBASE-CREDENTIAL-SETUP.md](COINBASE-CREDENTIAL-SETUP.md), and
[ENGINEERING-HANDOFF.md](ENGINEERING-HANDOFF.md).
