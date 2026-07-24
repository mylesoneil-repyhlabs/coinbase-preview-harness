# Delta Coinbase Guard

> Turn a natural-language Coinbase trade request into an explicit policy,
> surface its exact digest for host-mediated authorization, and
> deterministically gate the proposed action before money can move.

[![CI](https://github.com/mylesoneil-repyhlabs/coinbase-preview-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/mylesoneil-repyhlabs/coinbase-preview-harness/actions/workflows/ci.yml)

[**Download Delta Coinbase Guard V1 (.zip)**](https://github.com/mylesoneil-repyhlabs/coinbase-preview-harness/releases/latest/download/delta-coinbase-guard-v1.zip)
· [View the seven-step workflow](output/pdf/delta-coinbase-guard-v1-workflow.pdf)
· [Engineering handoff](docs/ENGINEERING-HANDOFF.md)

[![Delta Coinbase Guard workflow](output/playwright/delta-coinbase-guard-v1/step-01-intent.png)](output/pdf/delta-coinbase-guard-v1-workflow.pdf)

## What it is

Delta Coinbase Guard is an installable Codex skill and local Coinbase Advanced
Trade harness. It turns a one-off request such as “buy exactly 5 USDC of ETH”
into a closed, reviewable policy; records the exact digest supplied by the
calling host; deterministically proposes a policy-compliant order; and makes
the execute-or-stop decision outside model-controlled logic.

The included V1 lets anyone run the complete workflow as a credential-free
simulation. With an isolated Coinbase API key, it can also call Coinbase’s
real read and **Preview** endpoints to validate the exact prospective order.

> **V1 cannot place an order or move funds.** Coinbase Create is compile-time
> locked until Delta engineering connects the production seam to real delta
> Mandate services and a durable one-time grant store. No credential, prompt,
> plugin, environment variable, or CLI flag can unlock it.

This is an independent Delta prototype, not a Coinbase product or endorsement.

## Install

Requirements:

- macOS or Linux
- [Node.js 22+](https://nodejs.org/)
- Codex
- Git only if you use the clone option

No Coinbase, Delta, or OpenAI credentials are needed for the default
simulation.

### Option A: clone and install

```sh
git clone https://github.com/mylesoneil-repyhlabs/coinbase-preview-harness.git \
  "$HOME/.local/share/delta-coinbase-guard"
"$HOME/.local/share/delta-coinbase-guard/install"
```

### Option B: download the release

1. [Download the V1 bundle](https://github.com/mylesoneil-repyhlabs/coinbase-preview-harness/releases/latest/download/delta-coinbase-guard-v1.zip).
2. Unzip it into a permanent folder.
3. In Terminal, enter that folder and run:

```sh
./install
```

If the executable bit was removed during download, run `bash install`.

The installer:

1. verifies Node.js 22+;
2. links the skill into `${CODEX_HOME:-~/.codex}/skills`;
3. runs the local safety doctor; and
4. never reads credentials or contacts Coinbase.

Keep the repository in the same location after installation because the Codex
skill links back to its matching harness.

Start a new Codex session after installation.

## Run it

Paste this into Codex:

```text
Use $delta-coinbase-guard to plan and safely simulate:

Using my isolated Coinbase Advanced portfolio, use exactly 5 USDC to buy ETH
on ETH-USDC once now with a price-bounded IOC limit order. Partial fill is
acceptable. Do not pay more than 50 bps above Coinbase's fresh best ask, more
than 0.50 USDC in commission, or more than 5.50 USDC total. This authorization
expires 2 minutes after I confirm it.
```

The skill will:

1. preserve the source request;
2. compile every material term into a closed policy or fail for clarification;
3. display the complete policy and its digest;
4. pause while the calling host obtains and supplies a new user-authored
   confirmation of that exact digest;
5. deterministically propose and evaluate one candidate through the
   production-shaped Delta lifecycle;
6. return a deterministic pass, fail, or stop result; and
7. report that Coinbase Create was unreachable and uninvoked.

The simulation uses synthetic signatures, evidence, and proof. They are
clearly labeled and must never be described as a production Delta verdict.

## What V1 supports

| Dimension | Public V1 |
| --- | --- |
| Venue | Coinbase Advanced Trade |
| Product | `ETH-USDC` spot |
| Side | `BUY` |
| Principal | Exact amount, no more than `5 USDC` |
| Order | Quote-sized SOR limit IOC |
| Slippage | At most `50 bps` above fresh best ask |
| Commission | At most `0.50 USDC` |
| All-in debit | At most `5.50 USDC` |
| Confirmation artifact | One candidate, one use, fixed 120-second window |
| Default mode | Credential-free simulation |
| Optional mode | Coinbase reads + real Preview, then stop |

Transfers, withdrawals, sends, conversions, leverage, margin, derivatives,
recurring orders, conditional strategies, GTC orders, unrestricted market
orders, and on-chain actions are rejected.

## How the guard works

```mermaid
flowchart LR
  U["Natural-language request"] --> P["Closed policy"]
  P --> H["Host supplies confirmed digest"]
  H --> A["Deterministic proposer"]
  A --> D["Mandate adapter evaluates outside model"]
  D -->|"verified simulated pass"| V["SIMULATED_RESULT"]
  D -->|"anything else"| S["STOP"]
  A --> C["Optional Coinbase Preview"]
  C -->|"local checks pass"| Q["PREVIEW_PROBE_PASS, then STOP"]
```

The default V1 compiler and order proposer are deterministic. An optional model
compiler can draft the policy, but its output still passes the same closed
local validator and remains unconfirmed.

The CLI verifies that a supplied digest equals the displayed artifact. It
cannot prove who supplied that digest. The calling host must authenticate the
human confirmation; production should replace this procedural boundary with a
Delta-native signer or approval session.

Similarly, the skill instructs the model not to read or receive a Coinbase
private key and the harness accepts only an absolute key-file path. Public V1
does not provide OS- or process-level credential isolation from a local Codex
session. Production must keep the Trade credential behind a separate broker or
service boundary.

The public V1 decision rule is:

```text
verified simulated success + matching synthetic proof -> SIMULATED_RESULT
Coinbase Preview and every local check pass            -> PREVIEW_PROBE_PASS, then STOP
anything else                                          -> STOP
```

Public V1 evaluates exactly one candidate. Automatic multi-attempt retry is not
implemented. Engineering can add bounded retry only after defining how each
new candidate receives a fresh authorized intent and attempt history.

## Optional Coinbase Preview probe

The credentialed probe is for integration testing, not trading. Use a new,
isolated Coinbase ECDSA/ES256 key with:

- View and Trade enabled;
- Transfer and Receive disabled;
- the narrowest available portfolio and IP restrictions; and
- the downloaded key JSON stored outside this repository with mode `0600`.

Never paste the key into chat. Pass only its absolute local file path when the
skill asks for it.

The probe binds the reviewed policy to the key and portfolio, requires a
second exact human confirmation, calls Coinbase reads and Preview, runs local
economic and payload checks, and stops before Delta production composition or
Coinbase Create.

`PREVIEW_PROBE_PASS` means only that Preview and local checks passed. It does
not mean Delta issued a production proof or Coinbase executed a trade.

## Engineering handoff

Start with [docs/ENGINEERING-HANDOFF.md](docs/ENGINEERING-HANDOFF.md).

Engineering should retain the compiler, reviewed-plan format, Coinbase order
construction, exact-byte binding, deterministic controller, reconciliation,
and recovery paths. The intended production change is narrow:

1. connect the existing adapter port to an authenticated Delta signer, the real
   Orchestrator, and an operationally independent Verifier;
2. supply trusted Coinbase evidence through an immutable action registry;
3. replace `src/integration/production-composition.js` in source with reviewed
   internal composition and its private execution capability;
4. supply an isolated, transactional, one-time grant store; and
5. pass the tamper, replay, concurrency, uncertainty, and recovery suite before
   enabling one tiny internal live profile.

Exact contracts:

- [Delta adapter contract](docs/MANDATE-ADAPTER-CONTRACT.md)
- [Coinbase evidence contract](docs/COINBASE-EVIDENCE-CONTRACT.md)

## Develop and verify

```sh
./run doctor
pnpm test
pnpm run check:skill
pnpm run check:links
```

The repository includes 143 unit, adversarial, replay, and bypass tests plus a
seven-page simulated workflow.

## Repository map

```text
install                               local Codex skill installer
skills/delta-coinbase-guard/          installable agent workflow
config/                               closed policy schema and safety ceiling
docs/ENGINEERING-HANDOFF.md           production integration start-here
src/intent-compiler.js                deterministic + optional model compiler
src/execution-pipeline.js             deterministic fail-closed controller
src/coinbase-rest.js                  reads/Preview + locked Create transport
src/mandate/                          Delta adapter, controller, and simulator
src/reconciliation.js                 uncertainty and recovery checks
test/                                 143 safety and behavior tests
output/                               screenshots and workflow PDF
runtime/                              ignored local plans and private reports
```

## Coinbase references

- [Coinbase for Agents skill](https://docs.cdp.coinbase.com/coinbase-for-agents/skill.md)
- [Advanced Trade authentication](https://docs.cdp.coinbase.com/api-reference/authentication)
- [API key permissions](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/accounts/get-api-key-permissions)
- [Preview Order](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/preview-orders)
- [Create Order](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/create-order)
