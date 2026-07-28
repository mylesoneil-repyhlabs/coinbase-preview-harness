# Coinbase Guard v1.3 — authentic Codex recording kit

Record the real user surface: an ordinary Codex conversation using the
installed `$delta-coinbase-guard` skill. The graphics in this repository are
presentation guides for the right side of the frame. They are not a Coinbase
UI, a delta UI, or a reconstruction of Codex.

The recommended presentation has two clearly separated tracks:

1. **Conditional mandate story:** the fixed $3,000 ETH showcase demonstrates
   `BLOCK → bounded RETRY → PASS`, bound evidence, and the deterministic
   execution boundary.
2. **v1.3 capability proof:** a second, shorter Codex recording proves that the
   generic compiler is no longer ETH-only by compiling and simulating one
   quote-funded BUY and one base-funded SELL.

The first track is a labeled, deterministic fixture. It does not run through
the generic policy compiler and is not a claim that v1.3 implements arbitrary
conditional strategies. The second track exercises the generic v1.3 action
model with labeled product, balance, market, and Preview fixtures. Neither
track contacts Coinbase or production delta.

Read the [showcase claim ledger](COINBASE-DEMO-ASSURANCE.md) before presenting
either recording.

## Install in a fresh Codex context

Download the current repository release, unzip it to a permanent directory,
and run `./install`. The direct bundle is:

<https://github.com/mylesoneil-repyhlabs/coinbase-preview-harness/releases/latest/download/delta-coinbase-guard-v1.zip>

Published SHA-256 checksum:

<https://github.com/mylesoneil-repyhlabs/coinbase-preview-harness/releases/latest/download/delta-coinbase-guard-v1.zip.sha256>

Verify the two downloads before unzipping:

```sh
shasum -a 256 -c delta-coinbase-guard-v1.zip.sha256
```

Or clone and install:

```sh
git clone https://github.com/mylesoneil-repyhlabs/coinbase-preview-harness.git \
  "$HOME/.local/share/delta-coinbase-guard"
"$HOME/.local/share/delta-coinbase-guard/install"
```

No Coinbase, delta, or OpenAI credential is needed for these recordings. The
installer links the skill to its matching harness and runs the credential-free
safety doctor. Codex normally detects the skill automatically.

If Codex does not recognize `$delta-coinbase-guard`, fully quit and reopen
Codex, start a new chat, and ask the skill to run its doctor. If an older
release is installed from another folder, run `./install --upgrade` from the
new permanent folder. The installer retargets only a verified Delta Coinbase
Guard symlink and refuses an unrelated path.

## Track A — conditional mandate story

### Copy-paste this prompt unchanged

```text
Use $delta-coinbase-guard to run the fixed conditional-allocation partner showcase.

Demonstrate this simulated mandate: allocate up to 3,000 USDC to ETH only if
ETH is at or below 3,000 USDC, estimated slippage is no more than 35 bps, fees
are no more than 15 USDC, post-trade ETH exposure stays at or below 10,000
USDC, the mandate expires after 15 minutes, and it can authorize at most one
execution.

Show the complete result directly in this chat: the closed simulated policy
and authorization status; the agent's first exact proposal; every failed
constraint; the simulated delta evaluator's BLOCK receipt; the external
controller's one bounded retry; the revised exact proposal; the simulated
delta evaluator's PASS receipt and receipt verification; exact-payload and
evidence-digest equality at the execution gate; and whether Coinbase,
production delta, or Coinbase Create were contacted.

Treat this as the fixed conditional showcase, not as a generic-compiler
capability claim. Do not open a browser or ask me to inspect a separate report.
Do not use credentials, contact Coinbase, place an order, or move money.
```

The skill runs `coinbase-demo --no-artifacts` and follows a fixed six-section
response contract. All policy, proposal, failure, receipt, proof, gate, and
no-live-order results remain visible in Codex.

### Track A panel alignment

Record the Codex window as the dominant left side. Put the matching SVG panel
on the narrower right side during editing. Hold a panel until the corresponding
result is fully readable.

| Codex moment | Companion panel | Suggested hold |
| --- | --- | ---: |
| Prompt is visible; Codex restates the fixed simulated mandate | `output/coinbase-demo-panels/01-the-human-authorizes.svg` | 15 s |
| Codex explains agent, simulated evaluator, controller, and executor roles | `output/coinbase-demo-panels/02-separation-of-control.svg` | 12 s |
| Candidate one and its six failed checks appear | `output/coinbase-demo-panels/03-attempt-1.svg` | 18 s |
| BLOCK receipt and proposal/mandate/evidence digests appear | `output/coinbase-demo-panels/04-evidence.svg` | 14 s |
| Revised candidate and PASS receipt appear | `output/coinbase-demo-panels/05-attempt-2.svg` | 17 s |
| Exact-digest equality and locked Coinbase Create boundary appear | `output/coinbase-demo-panels/06-execution-boundary.svg` | 15 s |

`output/coinbase-demo-panels/timeline.json` contains the same timings as
machine-readable editing metadata.

## Track B — generic v1.3 BUY and SELL proof

Record this as a technical appendix, not as part of the fixed conditional
story. Use one fresh Codex chat and paste each message in order. The only
manual action is copying each complete policy digest from Codex into the next
authorization message. That new message is the explicit human-authorization
boundary; the skill must not write it for you.

The exact source requests are also retained as
[recording-v1.3-buy-intent.txt](../examples/recording-v1.3-buy-intent.txt) and
[recording-v1.3-sell-intent.txt](../examples/recording-v1.3-sell-intent.txt).
The examples use different sides, pairs, quote assets, sizing fields, funding
assets, price references, and settlement bounds on purpose.

### Step 1 — establish the action inventory

```text
Use $delta-coinbase-guard. Run its credential-free doctor, then state the exact
v1.3 action inventory directly in this chat: the supported spot BUY and SELL
shapes, their side-correct sizing and held-fund rules, how product support is
validated, and the unsupported Coinbase actions that must stop.

Do not use credentials, contact Coinbase, or imply that any example pair is
currently available. End with the Coinbase Create status.
```

Expected recording evidence: generic `SPOT BUY` and `SPOT SELL`; BUY uses
`quote_size` and held quote funds; SELL uses `base_size` and held base funds;
runtime Coinbase product metadata is authoritative when credentialed; Create
is locked.

### Step 2 — compile the generic BUY

```text
Use $delta-coinbase-guard to compile only the Coinbase request between REQUEST
and END REQUEST. Preserve it verbatim. Show the source digest, complete closed
policy, canonical action descriptor, funding asset and required available
amount, policy digest, and CREATE_ENABLED status directly in this chat. Stop
at the explicit authorization prompt; do not confirm the draft for me.

REQUEST
Using my isolated Coinbase Advanced portfolio, buy SOL on SOL-USDC once now
with a price-bounded IOC limit order. Use exactly 250 USDC. Partial fill is
acceptable. Do not pay more than 25 bps above Coinbase's fresh best ask, more
than 2 USDC in commission, or more than 252 USDC total. This authorization
expires 5 minutes after I confirm it.
END REQUEST

Do not use credentials or contact Coinbase.
```

Expected draft: `SOL-USDC`, `BUY`, exact `quote_size=250 USDC`, held `USDC`
funding with `252 USDC` required, fresh-best-ask price reference, maximum quote
debit, one use, and a five-minute authorization window.

### Step 3 — authorize and simulate the BUY

Replace the placeholder with the complete digest Codex just displayed, then
send this as a new user-authored message:

```text
I authorize the closed policy with digest <BUY_POLICY_DIGEST_FROM_CODEX>.
Use the existing plan for that exact digest and run the credential-free
simulation. Return the funding check, exact agent proposal and Coinbase-shaped
payload, labeled Preview fixture, proposal and Preview decisions, simulated
Delta PASS/BLOCK/REVIEW result, complete decision receipt and proof status,
controller disposition and retry budget, exact-payload gate result, and all
Coinbase/production-delta/Create/no-money-moved status flags directly in chat.
```

Expected result for the retained fixture: simulated `PASS`, a BUY payload with
`quote_size`, a bound receipt, `EXACT_PASS_GATE=true`, and every external/live
status false. The example product and Preview are fixtures, not current
Coinbase market evidence.

### Step 4 — compile the generic SELL

```text
Use $delta-coinbase-guard to compile only the Coinbase request between REQUEST
and END REQUEST. Preserve it verbatim. Show the source digest, complete closed
policy, canonical action descriptor, funding asset and required available
amount, policy digest, and CREATE_ENABLED status directly in this chat. Stop
at the explicit authorization prompt; do not confirm the draft for me.

REQUEST
Using my isolated Coinbase Advanced portfolio, sell BTC on BTC-USD once now
with a price-bounded IOC limit order. Use exactly 0.05 BTC. Partial fill is
acceptable. Do not accept more than 30 bps below Coinbase's fresh best bid, do
not pay more than 12 USD in commission, and receive at least 4990 USD after
commission. This authorization expires 5 minutes after I confirm it.
END REQUEST

Do not use credentials or contact Coinbase.
```

Expected draft: `BTC-USD`, `SELL`, exact `base_size=0.05 BTC`, held `BTC`
funding, fresh-best-bid price reference, minimum net `USD` proceeds, one use,
and a five-minute authorization window.

### Step 5 — authorize and simulate the SELL

Replace the placeholder with the complete digest Codex just displayed, then
send this as a new user-authored message:

```text
I authorize the closed policy with digest <SELL_POLICY_DIGEST_FROM_CODEX>.
Use the existing plan for that exact digest and run the credential-free
simulation. Return the funding check, exact agent proposal and Coinbase-shaped
payload, labeled Preview fixture, proposal and Preview decisions, simulated
Delta PASS/BLOCK/REVIEW result, complete decision receipt and proof status,
controller disposition and retry budget, exact-payload gate result, and all
Coinbase/production-delta/Create/no-money-moved status flags directly in chat.
```

Expected result for the retained fixture: simulated `PASS`, a SELL payload with
`base_size`, a bound receipt, `EXACT_PASS_GATE=true`, and every external/live
status false.

### Step 6 — show the unsupported-action boundary

```text
Use $delta-coinbase-guard to classify this request without rewriting or
coercing it into a spot trade: "Transfer exactly 100 USDC from my Coinbase
portfolio to another Coinbase portfolio once."

Show the unsupported-action reason directly in chat, stop before policy
authorization or proposal, and state whether Coinbase Create is reachable.
Do not use credentials or contact Coinbase.
```

The required outcome is `UNSUPPORTED`. A transfer must never be silently
converted into a BUY or SELL.

### Track B panel alignment

| Codex moment | Companion panel | Suggested hold |
| --- | --- | ---: |
| Doctor and supported/unsupported action inventory are visible | `output/coinbase-v1.3-capability-panels/01-v1-3-action-inventory.svg` | 15 s |
| BUY policy, canonical action, held-USDC funding, and digest pause appear | `output/coinbase-v1.3-capability-panels/02-generic-buy-draft.svg` | 18 s |
| Authorized BUY simulation, bound receipt, exact PASS gate, and false live flags appear | `output/coinbase-v1.3-capability-panels/03-generic-buy-result.svg` | 18 s |
| SELL policy, canonical action, held-BTC funding, and new digest pause appear | `output/coinbase-v1.3-capability-panels/04-generic-sell-draft.svg` | 18 s |
| Authorized SELL simulation, bound receipt, exact PASS gate, and false live flags appear | `output/coinbase-v1.3-capability-panels/05-generic-sell-result.svg` | 18 s |
| Transfer rejection and locked Create boundary appear | `output/coinbase-v1.3-capability-panels/06-scope-control.svg` | 15 s |

`output/coinbase-v1.3-capability-panels/timeline.json` contains the same
timings as machine-readable editing metadata.

## Generate or verify the panels

The existing deterministic generator produces both six-panel sequences:

```sh
npm run coinbase:panels
```

The output is SVG so it stays sharp beside a zoomed Codex window. Regeneration
does not call an image model, Coinbase, delta, or any network service.

## Recording checklist

- Use Track A as the commercial story and Track B as the technical
  non-ETH-only proof; do not edit them into one implied execution.
- Start from a fresh Codex chat after installing v1.3.
- Zoom Codex until full digests, decisions, and false live-status flags remain
  readable in the final side-by-side frame.
- Paste every supplied prompt unchanged.
- For Track B, copy the complete displayed policy digest into a genuinely new
  user message. Never pre-authorize a draft or let Codex author the approval.
- Keep `SIMULATION_ONLY`, `PRODUCTION_DELTA_INVOKED=false`,
  `COINBASE_CONTACTED=false`, and `COINBASE_CREATE_INVOKED=false` visible.
- Treat SOL-USDC and BTC-USD as fixture examples in this recording. Current
  product support is established only from runtime Coinbase metadata.
- Do not open a browser, use credentials, or imply that fixture market,
  balance, or Preview data came from Coinbase.
- Cut only dead time; do not combine outputs from separate attempts into one
  apparently continuous run.
- End on unsupported-action rejection and the locked Coinbase Create boundary.

Codex cannot be screen-captured by this automation environment. The user
records the authentic Codex session; this repository deliberately does not
fabricate or reconstruct the chat UI.
