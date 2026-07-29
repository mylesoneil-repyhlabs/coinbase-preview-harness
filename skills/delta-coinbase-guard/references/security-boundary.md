# Security boundary

## Installed code

- Install only from the published archive after verifying its SHA-256.
- v1.4 copies an explicit allowlist into a versioned managed directory and
  links the skill to that copy; it does not depend on the download afterward.
- Same-version content drift or tampering must fail installation.
- Upgrade may retarget only a verified Coinbase Guard symlink.
- A checksum proves download integrity relative to the published checksum. It
  is not publisher identity or a code signature.

## Credentials

- Never request, paste, log, screenshot, or commit private keys, JWTs, bearer
  tokens, seed phrases, or raw Coinbase responses.
- Accept a key only by absolute local file path.
- Require current-user ownership, mode `0600`, regular non-symlink file,
  bounded size, and location outside the repository and managed install.
- Validate and read through the same no-follow file descriptor.
- Planner/Preview credentials are ECDSA/ES256, View-only, no Trade or Transfer,
  and restricted to one isolated portfolio.
- The implemented Coinbase path is allowlisted direct REST. Coinbase MCP is
  documented topology only. Never expose a full mutating MCP namespace to the
  agent.
- Any future View+Trade key belongs only in an isolated external executor.

## Authorization

- The original request is not authorization of the compiled policy.
- A draft is not authorization.
- Require a new user-authored message containing the exact displayed digest.
- Any policy, size operator, market condition, credential, portfolio, expiry,
  or capability change creates a new digest and requires new approval.
- Never have the agent type or echo a confirmation as though the user authored
  it.
- The CLI checks equality; it does not authenticate message authorship.
- Production must replace procedural chat attribution with an authenticated
  approval or Delta-native signer session.

## Evidence

- The agent may propose but may not author account, product, BBO, Preview,
  portfolio, credential, verifier, or proof evidence.
- Require complete pagination, reject duplicate IDs/cursors and ambiguous
  portfolios, and bind exact held funds.
- Treat USD, USDC, and all other assets as distinct.
- Check Preview BBO and economic coherence against the trusted snapshot.
- Bind the exact prospective Create bytes and Preview request.
- Fixtures must remain visibly labeled and never be described as Coinbase
  source evidence.

## Delta and proof

- Public v1.4 production composition is compile-time hard-disabled.
- Only exact Delta success plus matching independent outcome and proof may
  reach the gate.
- Production requires cryptographic verification of the exact proof digest
  under a pinned verifier identity and pinned proof program ID.
- Fail closed on open, timeout, failure, expiry, review, missing proof,
  nonempty-but-unverified proof, malformed attestation, verifier disagreement,
  or any intent/policy/proposal/evidence mismatch.
- The simulation accepts only explicit placeholder proof material and reports
  `cryptographically_verified: false`.
- A local SHA-256 receipt is tamper-evident, not signed and not a liability
  guarantee.

## Coinbase execution

- Checked-in v1.4 cannot invoke Create.
- The public direct REST adapter exposes reads and Preview, not Create.
- The separate Create transport and LIVE pipeline require the non-exported
  capability from reviewed production composition.
- Preview must precede Create.
- The evaluated and transmitted UTF-8 Create bytes must match exactly.
- Consume one durable, transactional grant before submission.
- If submission may have begun, mark it uncertain and reconcile; never issue a
  second Create.
- In simulation, PASS ends at `EXECUTION_ELIGIBLE`; no executor, order, fill,
  reconciliation, or exchange outcome exists.

## Reporting

- Share only sanitized artifacts.
- Do not expose raw account IDs, portfolio labels, headers, credentials, local
  home paths, or unredacted API responses.
- Always report artifact class, proof-verification method and cryptographic
  status, executor status, Coinbase contact, Create status, and money movement.
- Never use `FILLED` or `SUBMITTED` for a simulation.
