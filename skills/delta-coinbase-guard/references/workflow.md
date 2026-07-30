# Chat-native workflow

## Ownership

| Component | Owns | Cannot do |
| --- | --- | --- |
| User | State intent; authorize the displayed mandate; optionally supply a View-key path | Authorize an unseen or changed policy |
| Model | Preserve language; identify missing facts; explain output | Decide policy, arithmetic, evidence, retry, receipt, or release |
| Deterministic Guard | Validate schemas; canonicalize and hash; compile policy; normalize and age evidence; decide; bind receipt; manage nonce/history | Contact Create or alter a passed proposal |
| Coinbase View surface | Permission status, Accounts, exact Product, BBO, Preview | Create, cancel, transfer, convert, or move money |
| Local Delta simulator | Exercise the public adapter contract against labeled fixtures | Claim production Delta authorization |
| External executor | Future consumer of an exact verified, one-use grant | Exists in this public build |

The model must pass typed plan state to deterministic code. It must never
perform monetary arithmetic or turn prose directly into a Coinbase request.

## Ordinary sequence

1. Offer the credential-free dry run and optional View-only facts; say no
   order can be sent.
2. Preserve the user's natural-language request.
3. Compile it with `plan --json`.
4. If incomplete, ask one concise question containing only missing material
   constraints. Accumulate the answer and recompile.
5. If unsupported, stop without substituting an action, pair, asset, side,
   amount, or order type.
6. Display the closed human-readable mandate without raw metadata.
7. Wait for a new user-authored `Authorize this mandate`.
8. Internally bind that message to the saved exact policy digest.
9. Run one `preflight` with one nonce:
   - no key: `dry_run` with explicitly simulated evidence;
   - external View-key path: `view_only_preflight`.
10. Present mode, mandate, proposal, decision plus one reason, impact,
    provenance/freshness, recovery, receipt status, and no-order boundary.
11. Reveal hashes or normalized technical detail only on request.

The user's original request is not authorization. A changed mandate requires a
new display and authorization. The CLI's digest comparison is integrity
binding, not chat-user authentication.

## Deterministic proposal boundary

The Guard owns:

- side-correct sizing and held funding asset;
- exact product identity and availability;
- decimal precision, increments, product minima/maxima;
- best-ask/best-bid condition and limit derivation;
- commission, slippage, and settlement arithmetic;
- exact Preview request serialization;
- prospective Create payload serialization without transmission;
- policy, proposal, evidence, Preview request, payload, and preflight digests;
- expiry, nonce, replay behavior, receipt, and redacted history.

Any order-relevant change invalidates the old preflight fingerprint and receipt.
Never silently substitute a product or reuse stale evidence.

## Decision meanings

### Dry run

All accounts, product, BBO, Preview, Delta outcome, and proof data are labeled
fixtures. A `PASS` exercises deterministic checks, the public Delta adapter
contract, exact payload binding, and simulated one-time gate consumption.
Coinbase and production Delta are not contacted. The terminal state is
simulated eligibility only.

### View-only preflight

The Guard verifies a no-Trade/no-Transfer/no-Receive key for that session,
fetches complete Accounts plus the exact Product and fresh BBO, and requests
one exact Preview. A `PASS` means these point-in-time facts matched the
proposal. It is not Delta authorization, execution eligibility, submission,
fill, or a future price guarantee.

### BLOCK versus REVIEW

- `BLOCK`: complete, verified facts show a policy violation, such as wrong
  side/size, insufficient held funds, unavailable product, or price/fee/
  settlement outside the mandate.
- `REVIEW`: fresh complete evidence could not be verified, including stale,
  missing, malformed, mismatched, rate-limited, revoked, partial, timed-out, or
  changed Preview data.

Both remain locked. Only follow the emitted recovery action. Do not describe an
infrastructure or evidence failure as a policy block.

## Freshness and recovery

Accounts, Product, BBO, and Preview have endpoint-specific request/receipt
times; BBO also uses Coinbase's observed timestamp. Missing or stale required
facts cannot pass. Preview is bound to the exact proposal and nonce.

An exact process retry reuses the nonce and returns the prior result without a
new network request. A genuine refresh uses a new nonce and a new receipt.
Reusing one nonce for different semantics fails closed.

## Local history

The Guard stores a bounded, redacted run summary in its private local state
directory. It records mode, mandate summary, proposal summary, outcome,
provenance, evidence age, no-order status, local IDs and receipt digest. It
does not store credentials, account IDs, raw Coinbase responses, headers, or
full payloads.

List history only on request. Require explicit confirmation immediately before
`history --clear`. History is an audit aid, never current market evidence.

## Public boundary

Every supported flow ends with:

- `create_available=false`;
- no external executor;
- no Coinbase Create;
- no submitted order or fill;
- no money movement; and
- a local SHA-256 receipt whose proof limits are stated.

Production would additionally require authenticated user authorization,
private Delta integration, pinned cryptographic verification, an append-only
action registry, and durable atomic one-use grant consumption. None is claimed
here.
