# Security boundary

## Credentials

- Never request, paste, log, screenshot, or commit private key contents, JWTs,
  bearer tokens, or seed phrases.
- Accept a Coinbase key only by absolute local file path.
- Require an isolated Coinbase Advanced portfolio.
- For planning, authenticated account reads, and Preview, require ECDSA/ES256,
  View enabled, Trade and Transfer disabled, and the narrowest available
  portfolio/IP restriction.
- Coinbase's documented key-permissions response exposes `can_view`,
  `can_trade`, `can_transfer`, and `portfolio_uuid`; it does not currently
  expose a separate `can_receive`. Reject an explicit `can_receive=true` if an
  extended response supplies it, but do not invent a required field.
- The key file must be outside the repository, owned by the current user,
  non-symlinked, regular, and mode `0600`.
- Coinbase's standard local MCP advertises mutating tools alongside reads.
  Do not expose that full namespace to the planner with a Trade credential.
  Use the harness's direct View-only read/Preview adapter or a host allowlist
  that exposes only product, balance, market, and Preview operations.
- The future executor requires a separate View+Trade/no-Transfer key behind
  the external controller. Do not configure it while simulation or Preview
  work remains.

## Authorization

- A draft policy is not authorization.
- The original trade request is not authorization of the compiled policy.
- The calling host must require and attribute a new user-authored message
  naming the exact digest. The CLI validates digest equality; it does not
  authenticate message authorship.
- Explicit confirmation is bound to an exact digest; any policy, key,
  portfolio, safety-profile, or expiry change requires a new digest.
- Never type, copy, or echo a confirmation digest as though the user authored
  it.
- `confirm-execution` creates one immutable receipt whose `confirmed_at` and
  `expires_at` cannot be refreshed. Every credential check and Preview probe
  consumes that same fixed time window.
- If the receipt expires, discard the bound execution and obtain a new binding
  plus a new user confirmation. Do not re-run a command to restart the clock.
- Production must replace procedural chat attribution with an authenticated
  Delta-native approval or signer session.

## Delta

- Public v1.3 is compile-time hard-disabled for production composition and
  returns `ENGINEERING_INTEGRATION_REQUIRED` before reading credentials for
  execution.
- Only an independently verified Delta `success` plus a matching `Proof` may
  unlock Create Order.
- Fail closed on open, processing timeout, failure, expiry, missing proof,
  malformed response, verifier disagreement, or proposal/intent/policy
  mismatch.
- A simulator result, local policy check, model judgment, or custom signed
  `ALLOW` is not a production Delta verdict.
- The trusted evidence extractor derives evidence from Coinbase and the frozen
  action. It must not accept agent-authored evidence as fact.

## Coinbase execution

- Checked-in v1.3 cannot invoke Create Order. Engineering must replace
  `src/integration/production-composition.js` in source and pass the documented
  acceptance suite before enabling it.
- The public REST adapter has no Create method. The separate Create transport
  and the LIVE pipeline independently require the non-exported capability held
  by that reviewed composition module.
- The executor accepts only the fixed Advanced Trade operation and fixed
  request schema; no generic URL/method/path passthrough.
- Preview must precede Create.
- After engineering integration, freeze and hash the exact UTF-8 Create bytes.
  The evaluated and submitted bytes must match exactly.
- Use one deterministic/idempotent client order identifier and consume the
  authorization before submission.
- If submission may have started, classify it as uncertain and reconcile; do
  not create a second order.

## Reporting

- Share only artifacts emitted by the harness sanitizer.
- Do not paste raw API responses, account identifiers, portfolio labels,
  authorization headers, credential fields, or local home-directory paths.
- If no sanitized artifact exists, report the state, Create reachability, and
  blocker without reproducing raw data.
