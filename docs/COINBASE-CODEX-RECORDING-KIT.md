# Coinbase Guard v1.4 — authentic Codex recording kit

Record the real user surface: a fresh Codex conversation using the installed
`$delta-coinbase-guard` skill. Do not reconstruct or fabricate the Codex UI.

The strongest recording has two clearly labeled parts:

1. **v1.4 product flow:** natural-language conditional BUY, explicit digest
   authorization, exact agent proposal, simulated Delta decision and receipt,
   and `EXECUTION_ELIGIBLE` with no executor.
2. **control story:** the separate fixed showcase demonstrates an initial
   `BLOCK`, one controller-owned retry, and a revised `PASS`.

The generic flow supports `EXACT`/`MAX` and the one-shot side-correct BBO
condition. Its policy does not include a portfolio exposure cap. The fixed
showcase includes an exposure fixture for storytelling only.

Read [the claim ledger](COINBASE-DEMO-ASSURANCE.md) before recording.

## Install in a fresh context

Download the latest release archive and checksum:

<https://github.com/mylesoneil-repyhlabs/coinbase-preview-harness/releases/latest/download/delta-coinbase-guard-v1.zip>

<https://github.com/mylesoneil-repyhlabs/coinbase-preview-harness/releases/latest/download/delta-coinbase-guard-v1.zip.sha256>

Verify, unzip, and install:

```sh
shasum -a 256 -c delta-coinbase-guard-v1.zip.sha256
unzip delta-coinbase-guard-v1.zip
cd delta-coinbase-guard-v1.4.0
./install
```

The installer copies a versioned allowlist into a managed user-data directory
and points the Codex skill at that copy. After `./install` succeeds, the
downloaded directory may be deleted. This is a useful cold-install check: the
skill should still run its doctor after the source folder is gone.

No Coinbase, Delta, or OpenAI credential is needed. The installer first uses a
compatible Node.js on `PATH`, then checks Codex Desktop's per-user bundled
runtime cache, so a separate Node install is usually unnecessary. If Codex does
not recognize the skill, fully quit and reopen Codex, start a new chat, and ask
it to run the guard's doctor.

## Part 1 — generic conditional v1.4 flow

Explicit authorization requires two user messages. Do not collapse them:
seeing the compiled policy before authorizing its digest is part of the product
boundary.

### Message 1 — compile and stop

Paste this unchanged:

```text
Use $delta-coinbase-guard for this Coinbase request. Preserve the request
verbatim, compile it into the complete closed policy and canonical Coinbase
action, and show everything directly in this chat. Show the source digest,
EXACT or MAX size semantics, held funding asset, one-shot market condition,
fee/slippage/settlement limits, validity, action-descriptor digest, policy
digest, and Coinbase Create status. Then stop at the explicit authorization
pause; do not authorize the draft for me.

REQUEST
Using my isolated Coinbase Advanced portfolio, use up to 3000 USDC to buy ETH
on ETH-USDC once now with a price-bounded IOC limit order. Only if Coinbase's
fresh best ask is at or below 3000 USDC. Partial fill is acceptable. Do not pay
more than 35 bps above Coinbase's fresh best ask, more than 15 USDC in
commission, or more than 3015 USDC total. This authorization expires 10
minutes after I confirm it.
END REQUEST

Do not use credentials, contact Coinbase, or open a browser.
```

Expected draft evidence:

- `ETH-USDC`, BUY, `MAX 3000 USDC`, `quote_size`;
- held USDC with the maximum quote-debit requirement;
- `BEST_ASK AT_OR_BELOW 3000 USDC`;
- SOR limit IOC, partial fill acceptable, 35 bps, 15 USDC commission, 3015
  USDC maximum debit, ten-minute TTL, one use;
- `delta.coinbase.spot_action.v2`; and
- a complete policy digest followed by a hard pause.

The same intent is retained in
[conditional-buy-intent.txt](../examples/conditional-buy-intent.txt).

### Message 2 — authorize and simulate

Copy the complete digest from Codex into this new user-authored message:

```text
I authorize the closed policy with digest <POLICY_DIGEST_FROM_CODEX>.

Use only the existing plan for that exact digest. Run the credential-free
simulation with no separate browser report. Show directly in chat: the
authorized v3 policy and v2 action; agent proposal; labeled account, product,
market and Preview fixtures; proposal and Preview decisions; simulated Delta
PASS/BLOCK/REVIEW result; proof-verification method and whether it is
cryptographic; complete v3 receipt; bounded controller disposition; exact
payload and evidence binding; final status; and all Coinbase, external
executor, production Delta, Create, fill and money-moved flags.
```

Expected successful fixture result:

- the proposed quote size is positive and no greater than the authorized
  maximum;
- fresh ask and Preview evidence meet the one-shot condition;
- proposal and Preview checks pass;
- simulated Delta returns `PASS`;
- local placeholder proof is binding-checked but
  `cryptographically_verified: false`;
- the exact evaluated payload reaches `EXECUTION_ELIGIBLE`; and
- external executor, Coinbase, production Delta, Create, fill, and money moved
  are all false or absent.

Do not describe the result as `FILLED`, `SUBMITTED`, or a live price claim.

### Part 1 companion panels

Keep Codex dominant on the left. Align these persistent right-side guides to
the actual chat moments; extend a hold if Codex takes longer rather than
cutting an authorization step:

| Codex moment | Companion panel | Hold |
| --- | --- | ---: |
| Doctor and v1.4 action inventory | `output/coinbase-v1.4-capability-panels/01-v1-4-action-inventory.svg` | 15 s |
| Conditional BUY policy and authorization pause | `output/coinbase-v1.4-capability-panels/02-conditional-buy-draft.svg` | 18 s |
| BUY receipt, proof class, and eligibility boundary | `output/coinbase-v1.4-capability-panels/03-conditional-buy-result.svg` | 18 s |
| Optional conditional SELL policy | `output/coinbase-v1.4-capability-panels/04-conditional-sell-draft.svg` | 18 s |
| Optional SELL receipt and locked gate | `output/coinbase-v1.4-capability-panels/05-conditional-sell-result.svg` | 18 s |
| Unsupported action and compile-time Create lock | `output/coinbase-v1.4-capability-panels/06-scope-control.svg` | 15 s |

`output/coinbase-v1.4-capability-panels/timeline.json` contains the same
sequence. These are presentation guides, not a product UI.

## Part 2 — fixed BLOCK → RETRY → PASS control story

Paste this as one separate prompt:

```text
Use $delta-coinbase-guard to run the fixed conditional-allocation partner
showcase.

Demonstrate this simulated mandate: allocate up to 3,000 USDC to ETH only if
ETH is at or below 3,000 USDC, estimated slippage is no more than 35 bps, fees
are no more than 15 USDC, post-trade ETH exposure stays at or below 10,000
USDC, the mandate expires after 15 minutes, and it can make at most one action
eligible in this simulated trace.

Show the complete result directly in chat: authorized simulated policy; first
exact proposal; every failed constraint; BLOCK receipt; external controller's
one bounded retry; revised proposal; PASS receipt and receipt verification;
payload/evidence digest equality; execution eligibility; and whether an
external executor, Coinbase, production Delta, or Create was invoked.

Label the exposure check as fixed-showcase-only. Do not claim it is a generic
v1.4 compiler feature. Do not use credentials, contact Coinbase, open a
browser, place an order, or move money.
```

The skill runs `coinbase-demo --no-artifacts`. The right-side companion panels
are sequenced one-for-one:

| Codex moment | Companion panel | Hold |
| --- | --- | ---: |
| Simulated mandate and digest | `output/coinbase-demo-panels/01-the-human-authorizes.svg` | 15 s |
| Agent, evaluator, controller, executor separation | `output/coinbase-demo-panels/02-separation-of-control.svg` | 12 s |
| Attempt one and six failures | `output/coinbase-demo-panels/03-attempt-1.svg` | 18 s |
| BLOCK receipt and bound evidence | `output/coinbase-demo-panels/04-evidence.svg` | 14 s |
| Revised proposal and PASS | `output/coinbase-demo-panels/05-attempt-2.svg` | 17 s |
| Exact gate and no-execution boundary | `output/coinbase-demo-panels/06-execution-boundary.svg` | 15 s |

`output/coinbase-demo-panels/timeline.json` contains the same timings.

## Optional SELL appendix

To prove side-correct symmetry, repeat Part 1 with
[conditional-sell-intent.txt](../examples/conditional-sell-intent.txt). The
draft must show:

- `BTC-USD`, SELL, `MAX 0.50000000 BTC`, `base_size`;
- held BTC funding;
- `BEST_BID AT_OR_ABOVE 60000 USD`; and
- minimum net USD proceeds.

Do not splice BUY and SELL outputs together as one apparent execution.

## Unsupported-action close

End with:

```text
Use $delta-coinbase-guard to classify this request without rewriting it into a
trade: "Transfer exactly 100 USDC from my Coinbase portfolio to another
Coinbase portfolio once." Show the result and Coinbase Create status directly
in chat. Do not use credentials or contact Coinbase.
```

Required outcome: `UNSUPPORTED`, no policy authorization, no proposal, Create
locked.

## Recording checklist

- Start from a fresh Codex chat and the managed v1.4 install.
- Keep the real chat dominant and readable.
- Paste prompts unchanged.
- Send the policy digest in a genuinely new user-authored message.
- Keep `SIMULATION_ONLY`, `cryptographically_verified: false`,
  `EXECUTION_ELIGIBLE`, `SIMULATED_EXECUTOR_INVOKED=false`,
  `EXCHANGE_OUTCOME_OBSERVED=false`, `COINBASE_CONTACTED=false`, and
  `COINBASE_CREATE_INVOKED=false` visible.
- Treat every account, product, market, Preview, and Delta value as a fixture.
- State that direct REST is implemented and Coinbase MCP is topology-only.
- Do not imply a generic exposure policy, exchange fill, live price, production
  Delta result, signed receipt, or live order.
- Cut only dead time; never combine separate attempts into one implied trace.

Codex cannot be screen-captured by this automation environment. The user
records the authentic session; the repository intentionally does not fabricate
the chat UI.
