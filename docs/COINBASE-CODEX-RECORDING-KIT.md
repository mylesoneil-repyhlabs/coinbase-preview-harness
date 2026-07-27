# Coinbase partner demo — Codex recording kit

This kit records the real product surface: an ordinary Codex conversation
using the installed `$delta-coinbase-guard` skill. The companion panels explain
the architecture; they are presentation graphics, not a Coinbase or delta UI.
Read the [showcase claim ledger](COINBASE-DEMO-ASSURANCE.md) before presenting
the demo to distinguish deterministic proof inside the harness from production
delta or live Coinbase claims.

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

No Coinbase, delta, or OpenAI credential is needed. The installer links the
skill to its matching harness and runs the credential-free safety doctor.
Codex normally detects the skill automatically.

If Codex does not recognize `$delta-coinbase-guard`, fully quit and reopen
Codex, start a new chat, and confirm the installer printed `V1 contracts and
skill: PASS`.

If an older release is already installed from a different folder, run
`./install --upgrade` from the new permanent folder. This retargets only a
verified Delta Coinbase Guard symlink and refuses any unrelated path.

## Copy-paste this one prompt

```text
Use $delta-coinbase-guard to run the conditional-allocation partner showcase.

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
Do not open a browser or ask me to inspect a separate report. Do not use
credentials, contact Coinbase, place an order, or move money.
```

The skill runs `coinbase-demo --no-artifacts` and follows a fixed six-section
response contract. Those six headings align one-for-one with the companion
panels below. It does not need write access, a browser, or a separate report
during recording.

## Recording sequence

Record the Codex window as the dominant left side. Put the matching SVG panel
on the narrower right side during editing. The timings are guides; hold a panel
until the corresponding result is fully readable.

| Codex moment | Companion panel | Suggested hold |
| --- | --- | ---: |
| Prompt is visible; Codex restates the mandate and simulation authorization | `01-the-human-authorizes.svg` | 15 s |
| Codex explains agent, Delta, controller, and executor roles | `02-separation-of-control.svg` | 12 s |
| Candidate one and its six failed checks appear | `03-attempt-1.svg` | 18 s |
| BLOCK receipt and proposal/mandate digests appear | `04-evidence.svg` | 14 s |
| Revised candidate and PASS receipt appear | `05-attempt-2.svg` | 17 s |
| Exact-digest equality, one eligibility in this trace, and no-live-order status appear | `06-execution-boundary.svg` | 15 s |

The generated files live in `output/coinbase-demo-panels/`; `timeline.json`
contains the same alignment as machine-readable editing metadata.

## Recording checklist

- Start a fresh Codex chat after installing the skill.
- Zoom the Codex text until the prompt, decisions, and receipt digests are
  readable in the final side-by-side frame.
- Paste the prompt unchanged and record one continuous interaction.
- Do not open a browser or separate report during the recording.
- Keep `SIMULATION_ONLY`, `PRODUCTION_DELTA_INVOKED=false`,
  `COINBASE_CONTACTED=false`, and `COINBASE_CREATE_INVOKED=false` visible.
- Cut only dead time; do not edit together results from separate runs.
- End on the exact-payload equality and locked Coinbase Create boundary.

Codex cannot be screen-captured by this automation environment. The user
records the authentic Codex session; this repository deliberately does not
fabricate or reconstruct the chat UI.
