# Security boundary

## Credentials

- Never request, paste, log, screenshot, or commit private key contents, JWTs,
  bearer tokens, or seed phrases.
- Accept a Coinbase key only by absolute local file path.
- Require an isolated Coinbase Advanced portfolio.
- Require ECDSA/ES256, View and Trade enabled, Transfer and Receive disabled,
  and the narrowest available portfolio/IP restriction.
- The key file must be outside the repository, owned by the current user,
  non-symlinked, regular, and mode `0600`.
- A model-facing Coinbase MCP must use a different View-only credential.
- If its schema advertises any mutating operation, do not probe the operation.
  Stop with `STOP_UNSAFE_TOOL_TOPOLOGY`; remediation requires removing it or
  replacing the credential/surface, rerunning `doctor`, and restarting the
  workflow from `plan`.

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

- The public V1 is compile-time hard-disabled for production composition and
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

- The checked-in V1 cannot invoke Create Order. Engineering must replace
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
