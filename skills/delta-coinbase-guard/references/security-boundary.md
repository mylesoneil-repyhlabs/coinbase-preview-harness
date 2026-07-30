# Security and evidence boundary

## Install integrity

- Use the managed copy installed from the published archive after SHA-256
  verification.
- Keep the launcher and all referenced paths absolute so restricted `PATH`
  works after the download/source directory is removed.
- Treat a checksum as archive-integrity evidence, not publisher identity or a
  code signature.
- Stop if `doctor` fails; never fall back to another checkout or hand-written
  policy logic.

## View-only credential

- View-only is optional. The credential-free dry run is the default.
- Ask only for an absolute path to a user-managed external key file. Never ask
  the user to paste a key, secret, JWT, bearer token, seed phrase, or raw API
  response into chat.
- Require an owner-only `0600` regular non-symlink file outside the repository
  and managed install. Read it no-follow with bounded size.
- Require `can_view=true`, `can_trade=false`, and `can_transfer=false`. The
  documented permission response currently omits `can_receive`: require the
  user to configure Receive disabled, reject an explicit `true`, record an
  omission as unreported, and never claim the API verified `false`.
- Use key material and permission results only in the current preflight. Do
  not copy the key or persist a permission attestation, raw header, raw API
  body, account ID, or portfolio label.
- The allowlisted direct REST surface is permission status, Accounts, exact
  Product, BBO, and Preview only. Redirects, retries to a different route,
  Create, cancel, transfers, conversions, and every mutation are unavailable.
- Do not expose Coinbase's broader MCP/CLI namespace to the model.

## Authorization

- The original intent and compiled draft are not authorization.
- Wait for a new user-authored `Authorize this mandate` after showing the
  complete plain-English policy.
- Bind that message internally to the exact saved policy digest.
- Any policy, side, pair, size, condition, credential scope, portfolio,
  evidence attempt, expiry, or prospective payload change requires the
  appropriate new binding.
- The CLI verifies digest equality but cannot authenticate chat authorship.
  Production needs an authenticated signer session.

## Evidence and fail-closed behavior

- The model may propose; it may not author balances, product facts, BBO,
  Preview, permission status, decision, retry budget, or receipt.
- Normalize only allowlisted facts and redact identifiers. Do not display raw
  private responses.
- Bind policy, proposal, normalized evidence, exact Preview request,
  prospective Create bytes, decision, nonce, expiry, and preflight fingerprint
  in the local receipt.
- Fail to `REVIEW`, not `PASS`, on stale, missing, malformed, mismatched,
  replayed, partial, rate-limited, revoked, timed-out, or unavailable evidence.
- Use `BLOCK` only when verified facts violate policy.
- Any order-relevant field or Preview fingerprint change invalidates the prior
  decision and receipt. Never silently substitute another product.
- An exact nonce retry may return the original result. Reusing a nonce with
  changed semantics must fail closed.

## Receipt truth

The receipt is versioned local SHA-256 integrity evidence over normalized
facts and bindings. It helps detect later mutation. It is
not independent authentication of Coinbase data, and it is not:

- a production Delta signature or cryptographic proof;
- authenticated user identity;
- an execution grant, liability guarantee, exchange order, or fill.

Dry-run proof material is explicitly simulated and not cryptographically
verified. View-only data arrives over the Coinbase API connection but is not
independently signed by Coinbase in this harness.

## Output and local state

- Default output shows the human mandate, proposal, decision and one reason,
  impact, provenance/freshness, recovery, receipt status, and no-order
  boundary.
- Show hashes, full normalized metadata, and private paths only after an
  explicit details request.
- Store only bounded redacted history with private filesystem permissions.
- Never include credentials, raw headers, account IDs, portfolio labels, or
  raw Coinbase bodies in output, errors, reports, history, exports, or logs.
- Clear local history only after explicit user confirmation.
- No remote telemetry is enabled by default.

## Execution

Public v1.5 cannot invoke Coinbase Create. The preflight may serialize
prospective Create bytes only to bind what would have been eligible. It never
transmits them.

Every outcome—`PASS`, `BLOCK`, or `REVIEW`—must state that Create is
unavailable, no external executor ran, no order was submitted, and no money
moved. A Coinbase Preview is point-in-time evidence, not execution or a price
guarantee.
