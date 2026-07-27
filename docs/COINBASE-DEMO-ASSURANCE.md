# Coinbase showcase assurance and claim ledger

This page is the truth boundary for the conditional-allocation showcase. It
separates what a skeptical Coinbase product or engineering reviewer can verify
in this repository from what still requires production delta services and a
live Coinbase execution integration.

## What the showcase proves

| Claim | Status | Verifiable implementation |
| --- | --- | --- |
| A normal Codex user can install and invoke the guard | Implemented | Release bundle, installer, skill-local `scripts/run`, and the cold-install test |
| The fixed showcase fixture encodes the requested natural-language mandate as a closed policy | Implemented simulation | `COINBASE_DEMO_MANDATE`, its canonical digest, and a separate authorization-instance digest |
| The agent proposes an exact prospective Coinbase Create body | Implemented simulation | `client_order_id`, product, side, `preview_id`, and one fixed SOR limit IOC configuration |
| Decision evidence is outside the agent proposal | Implemented simulation | Separately labeled market, Preview, and portfolio fixture with its own digest |
| A bad proposal is denied for specific reasons | Implemented simulation | Six failures across allocation, market price, limit price, slippage, fee, and portfolio exposure |
| Retry is bounded outside model logic | Implemented simulation | A deterministic controller allows at most two candidates, collects evidence outside proposal creation, and maps the first `BLOCK` to one `RETRY` |
| A passed proposal is bound to evidence and authorization | Implemented simulation | Receipt includes the mandate, authorization instance, exact payload, evidence, decision, and expiry |
| Only the exact verified `PASS` reaches the gate | Implemented simulation | The gate recomputes the full attempt before exposing one eligibility in this trace; no durable grant is issued |
| This public build can place a Coinbase order | Deliberately not implemented | Coinbase Create remains compile-time locked |

## What the showcase receipt proves

The receipt binds:

- the canonical simulated mandate and its authorization instance;
- authorization and expiry timestamps;
- the exact prospective Coinbase payload;
- the separately supplied evidence fixture;
- the evaluator result and complete failure reasons; and
- the receipt digest.

The verifier does not trust those fields because they appear in JSON. It
recomputes the mandate, authorization instance, proposal and evidence digests,
re-runs the evaluator, compares the failures and decision, and recomputes the
receipt digest. The external controller's `RETRY`, `STOP`, or `EXECUTE`
classification is recorded separately because it occurs after evaluation.

This is a deterministic, self-verifying simulation receipt. It is **not** a
production delta signature, a Coinbase attestation, or proof of a trusted
signer identity. The production-shaped adapter and evidence seams are described
in the [engineering handoff](ENGINEERING-HANDOFF.md).

## What is fixture data

The 3,000-USDC allocation, ETH prices, prospective fill, fees, exposure,
`preview_id`, and run-relative timestamps are labeled fixtures. They do not
come from Coinbase, production delta, or a live portfolio. The showcase uses
them to make the policy consequences and exact binding inspectable without
credentials or money movement.

The optional credentialed probe is a separate path. It uses a normal
user-created CDP ECDSA key for authenticated reads and Coinbase Preview; see
[credential setup](COINBASE-CREDENTIAL-SETUP.md). It does not unlock Create.

## Retry qualification

`BLOCK → RETRY → PASS` demonstrates controller behavior in this harness. It
must not be presented as an assertion that today's private delta implementation
already reopens one authorized intent across multiple proposals. Production can
preserve the same invariant in one of three explicit ways:

1. refine candidates locally, then submit the final candidate for one
   authoritative delta decision;
2. authorize a fresh signed intent for each candidate; or
3. add a signed, bounded proposal-window primitive to delta core.

The public repository does not expose delta's private implementation, so this
project retains a narrow adapter and does not guess which option exists.

## Credential and execution boundary

- The default showcase reads no credential.
- Credential setup uses a caller-selected external file; the key is never
  accepted as prompt text and is excluded from git.
- Credential readiness and Preview are separate from Create authority.
- Coinbase Create is compile-time locked in this public build.
- The 5-USDC, one-order ceiling is only a future live-test safety control. It
  is intentionally absent from the 3,000-USDC simulated product narrative.
- The first live order still requires an explicit user decision after
  production delta verification and a durable one-time grant store exist.

## Production seams

The repository already isolates:

- the delta adapter contract;
- the evidence contract and Coinbase Preview binding;
- production-composition checks;
- the executor boundary; and
- the durable one-time grant-store requirement.

Those seams are the handoff surface for validation against the actual private
delta codebase when access is available. The public Repyh Labs organization
does not expose that implementation, and this showcase makes no claim that it
does.
