# Delta Guard Advisor design contract

## Experience

The advisor should feel like a private consultation room: calm, precise, and
immediately useful. It must not resemble a generic dashboard, market terminal,
fake bank account, or co-branded Coinbase product.

The first screen is one natural-language composer with four starts:

- prepare a spot trade;
- plan a future condition;
- explore a token;
- build an allocation plan.

Dry run is the implicit default. No credential wall appears before value.

## Information hierarchy

A persistent trust strip always answers:

```text
Mode: Dry run or View only
Connection: Not connected or View-only session
Orders: Off
```

The advisor conversation dominates. A contextual Delta rail shows the current
state, policy boundary, exact proposal, decision, freshness, and no-order
status. Primary destinations are limited to Advisor, Plans, Activity, and
Connection.

The user journey is:

```text
human instruction
  -> editable Mandate captured
  -> Authorize for one check
  -> exact Proposal
  -> PASS / BLOCK / REVIEW
  -> impact + provenance + recovery
  -> receipt details on demand
```

Hashes, schemas, file paths, BBO/IOC/bps terminology, and normalized metadata
stay behind progressive disclosure or are translated into plain English.

## Decision language

- `PASS — Fits this mandate`
- `BLOCK — Does not fit this mandate`
- `REVIEW — Could not verify safely`

`PASS` never looks like a fill, submission, or trade confirmation.

`BLOCK` shows actual versus allowed and offers **Revise proposal** or
**Edit mandate**. `REVIEW` names the unavailable or stale fact and offers
**Refresh facts** or **Reconnect**. The app never silently retries,
substitutes a product, or changes the mandate.

## Credential consent

The control is **Connect Coinbase — View only**, never “Log in” or “OAuth”
unless a future verified OAuth flow is implemented.

Before input, the user sees:

- reads: permissions, balances, exact product, best market quote, and Preview;
- cannot do: Trade, Transfer, Create, submit, or move money;
- retention: no secret persistence; server-process memory only;
- clearing: disconnect, expiry, process exit, or failed connection;
- limitation: Preview is point-in-time evidence, not execution or a price
  guarantee.

Local entry may use an external key file or an advanced paste flow. The paste
flow must disclose that browser and server memory cannot be cryptographically
zeroized, even though no storage API or persistence is used.

## Conditional plans

Truthful states are `Draft`, `Authorized for simulation`, `Would trigger`,
`Expired`, and `Revoked`. Never use `Active`, `Watching`, or `Monitoring`
without a trusted durable executor.

Each plan shows source, trigger, timezone, amount, cost limits, expiry,
one-shot scope, and revoke. Its timeline ends:

```text
condition observed
  -> fresh guard check
  -> exact final user review
  -> order unavailable
```

## Research and portfolio planning

Research is educational and source/as-of labelled. It exposes assumptions,
uncertainty, liquidity and volatility risk, concentration, and scenario
inputs. It must not say “recommended for you,” calculate suitability, promise
returns, or auto-optimize into a trade.

Portfolio plans are editable planning objects. Converting a selected leg
creates a new, separately reviewed one-action mandate.

## Visual system

- Canvas: warm paper `#f4f1e8`
- Surface: soft ivory `#fffdf7`
- Primary ink: deep navy `#15233b`
- Secondary ink: slate `#5e6a7d`
- Trust/action: muted cobalt `#3157d5`
- Delta accent: teal `#1f8a70`
- Review: amber `#9a6412`
- Block: coral `#b84f4f`
- Hairline: translucent navy

Typography uses a local system stack. No remote font, third-party script,
analytics pixel, or decorative market feed is allowed.

The moment of delight is the user’s sentence resolving into an enforceable
mandate. Motion is subtle, interruptible, and removed under
`prefers-reduced-motion`.

## Responsive and accessible

- Desktop: approximately 60% conversation, 40% Delta context.
- Mobile: single column with sticky mode/boundary and confirmation action.
- Minimum 44-pixel targets and visible keyboard focus.
- WCAG AA contrast, semantic headings, labels, and landmarks.
- Color is always paired with icon and text.
- Progress and decisions use `aria-live`.
- No hover-only action, horizontal mandate table, or focus trap.
- Support 320-pixel width and 200% zoom.
- Progress appears inside two seconds; after five seconds show the current
  check and a recovery/cancel option.

## Synthetic review status

The initial design input is a clearly labelled synthetic composite review,
not customer evidence. It prioritizes a one-minute credential-free dry run,
the editable mandate as the trust moment, a comprehensible View-only consent
screen, and an explicit “No order placed” line on every result.
