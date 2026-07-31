# Coinbase Guard v1.6 — authentic Codex recording kit

Record the real surface: a fresh Codex conversation using the installed
`$delta-coinbase-guard` skill. Do not reconstruct, fabricate, or screen-capture
a fake Codex UI. Keep the real chat dominant on the left. The supplied SVGs
are explanatory right-hand presentation guides, not product UI.

Read [the assurance ledger](COINBASE-DEMO-ASSURANCE.md) before recording.
For the separate local Advisor walkthrough, use
[ADVISOR-DEMO-v1.6.md](ADVISOR-DEMO-v1.6.md).

## Before recording

Download and verify the stable release assets:

```text
https://github.com/mylesoneil-repyhlabs/coinbase-preview-harness/releases/latest/download/delta-coinbase-guard-v1.zip
https://github.com/mylesoneil-repyhlabs/coinbase-preview-harness/releases/latest/download/delta-coinbase-guard-v1.zip.sha256
```

```sh
shasum -a 256 -c delta-coinbase-guard-v1.zip.sha256
unzip delta-coinbase-guard-v1.zip
cd delta-coinbase-guard-v1.6.0
./install
```

The managed install survives deleting the extracted source. No credential is
needed. Fully restart Codex and open a fresh chat if the skill does not appear.

Record at a readable zoom. Hide notifications, personal paths, terminal
history, account data, and credentials. Never show or paste a Coinbase key.

## Main recording: protected dry run

This is two genuine user messages. Do not collapse the authorization pause.

### Message 1 — state intent and stop

Paste exactly:

```text
Use $delta-coinbase-guard for a protected Coinbase spot-trade dry run.

Using held USDC, buy up to 3,000 USDC of ETH on ETH-USDC once with a
price-bounded IOC limit order and allow partial fills. Only if
Coinbase's fresh best ask is at or below 3,000 USDC. Do not pay more than
35 bps above Coinbase's fresh best ask, more than 15 USDC in fees, or more
than 3,015 USDC total. The authorization expires 10 minutes after I confirm it.

Keep the complete mandate and no-order boundary in this chat. Stop for my
authorization. Do not use credentials, contact Coinbase, or open a browser.
```

Required response:

- `MANDATE CAPTURED · AWAITING YOUR AUTHORIZATION`;
- BUY up to 3,000 USDC on ETH-USDC;
- fresh best ask at/below 3,000 USDC;
- IOC, partial fills allowed, maximum 35 bps slippage;
- maximum 15 USDC fee and 3,015 USDC all-in debit;
- held USDC only, no conversion;
- one use, ten-minute validity;
- reply “Authorize this mandate”; and
- Create unavailable / no order.

The normal response must not require the user to copy a digest or show an
absolute path. The skill retains the exact plan and digest privately.

### Message 2 — authorize the displayed mandate

Paste exactly:

```text
Authorize this mandate.

Run the credential-free dry run now. Keep the mandate, exact proposal,
PASS/BLOCK/REVIEW reason, impact, checked facts and time, local receipt status,
and no-order boundary directly in this chat. Keep hashes and paths hidden
unless I ask for technical details.
```

Required successful fixture response:

- `DRY RUN · SIMULATED FACTS · NO ORDER SUBMITTED`;
- the same complete authorized mandate;
- one exact ETH-USDC BUY IOC proposal;
- `PASS` with one plain-English reason;
- rounded debit/receive/fee impact;
- simulated held balance, product/BBO/Preview facts and check time;
- local Delta simulation, not private Delta;
- private local Guard history saved;
- no Coinbase contact, executor, Create, order, exchange outcome, or money
  movement.

Do not describe `PASS` as a fill, submission, live price, signed production
receipt, or Coinbase-authenticated stored fact.

## Companion-panel timing

Align one trust panel to each actual chat moment. The checked-in filenames
retain `v1.5` because they document the unchanged chat-native Guard sequence.
If Codex takes longer, extend the panel; never cut or merge the authorization
step.

| Codex moment | Right-hand panel | Suggested hold |
| --- | --- | ---: |
| Skill ready and no-key default | `output/coinbase-v1.5-trust-panels/01-start-protected.svg` | 12 s |
| Complete mandate and user pause | `output/coinbase-v1.5-trust-panels/02-mandate-captured.svg` | 18 s |
| Exact typed proposal appears | `output/coinbase-v1.5-trust-panels/03-exact-proposal.svg` | 18 s |
| PASS, impact, checked facts | `output/coinbase-v1.5-trust-panels/04-pass-with-context.svg` | 18 s |
| Receipt and private history | `output/coinbase-v1.5-trust-panels/05-receipt-history.svg` | 18 s |
| No-Create execution boundary | `output/coinbase-v1.5-trust-panels/06-execution-boundary.svg` | 15 s |

`output/coinbase-v1.5-trust-panels/timeline.json` contains the same sequence.

## Optional recovery moment

To show that missing information creates guidance rather than configuration
jargon, start a separate fresh chat:

```text
Use $delta-coinbase-guard. Sell exactly 0.5 BTC for USDC.
```

The Guard should identify a supported BTC-USDC SELL and ask only for the
missing execution protection, fee/net-proceeds limits, and validity. It must
say that no policy, Coinbase request, or order exists yet. Continue only if
the recording benefits from showing clarification; do not improvise defaults.

## Optional View-only explanation

Do not use real credentials in a public recording. You may ask:

```text
What would the optional View-only preflight read, store, and prove? Do not ask
for a key or contact Coinbase.
```

The answer must say:

- reads only permissions, complete held balances, exact product, BBO, and one
  exact Preview;
- key is supplied by absolute path for that process and not persisted;
- stored history is redacted and excludes account/key IDs and raw responses;
- `VIEW-ONLY PREFLIGHT PASS` is point-in-time inspection evidence, not Delta
  authorization, execution, or a price guarantee;
- Create is absent.

Only record a real View-only run in a private environment after separately
supplying a narrow key, hiding all paths/account data, and confirming the
recording itself will not expose sensitive metadata.

## Separate fixed BLOCK → RETRY → PASS showcase

The fixed showcase remains useful for the separation-of-control story but is
not the normal chat-native user journey. Use a separate chat:

```text
Use $delta-coinbase-guard to run the fixed conditional-allocation partner
showcase.

Show the simulated 3,000-USDC ETH mandate, first violating proposal, every
failed constraint, BLOCK receipt, controller-owned one bounded retry, revised
proposal, PASS receipt, exact payload/evidence binding, and no-execution
boundary directly in chat.

Label the exposure rule as fixed-showcase-only. Do not use credentials,
contact Coinbase, open a browser, place an order, or move money.
```

Align the existing `output/coinbase-demo-panels/01-...06-...svg` sequence.
Those figures are deterministic fixture storytelling. They are not generic
portfolio-exposure support or a claim about private Delta retries.

## Unsupported-action close

Paste:

```text
Use $delta-coinbase-guard to classify this without rewriting it into a trade:
“Transfer exactly 100 USDC between Coinbase portfolios once.”
Do not use credentials or contact Coinbase.
```

Required result: `UNSUPPORTED`, no mandate authorization, no proposal, and
Create unavailable.

## Final recording checklist

- Fresh Codex chat and managed v1.6 install.
- Real chat clearly dominant and readable.
- Exactly two user messages for the primary authorization flow.
- Complete mandate visible before authorization.
- No copied digest, JSON, or absolute path in normal chat.
- All evidence labeled simulated in the dry run.
- Plain outcome, impact, check time, recovery, and no-order boundary visible.
- Hashes and metadata hidden unless intentionally showing technical details.
- Never imply a Coinbase integration/endorsement, live MCP, production Delta,
  signed receipt, independent source authentication, Create, submission, fill,
  or money movement.
- Never show credentials, local key paths, account IDs, or private data.

Codex cannot be screen-captured by this automation environment. The user
records the authentic session; this repository deliberately supplies only the
script and aligned presentation guides.
