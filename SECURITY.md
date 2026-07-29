# Security policy

Delta Coinbase Guard handles authorization data and may be connected to
credentials capable of placing real trades. Treat security defects as
potentially high impact even when they are found in simulation mode.

## Reporting a vulnerability

Do not open a public issue or pull request for a suspected vulnerability.
Use GitHub's private vulnerability-reporting flow from the repository's
**Security** tab. If that option is unavailable, contact the maintainers
through an existing private channel and ask for a secure reporting path
without including exploit details.

Never send API private keys, seed phrases, access tokens, credential files,
full authorization receipts, or unsanitized execution records in a report.
Include the affected commit, reproduction steps using fixtures or dummy
credentials, impact, and any suggested mitigation.

The maintainers will acknowledge a private report, assess severity and scope,
coordinate a fix, and agree on disclosure timing with the reporter. Please
allow a reasonable remediation window before public disclosure.

## Supported version

Only the latest commit on the default branch is supported. This is a v1.4
integration preview, not a production custody or trading service.

## Operator safety

- Keep Coinbase credentials outside the repository and pass credential paths
  only at runtime. Use a dedicated portfolio and a View-only key for reads and
  Preview. A future Trade key belongs only in an isolated executor.
- Do not commit anything under `credentials/` or `runtime/`. Generated
  execution reports can contain sensitive trading metadata and are written
  under ignored `runtime/artifacts/` with user-only permissions.
- A simulation artifact is not evidence of a real Delta decision or Coinbase
  order. Simulation HTML is labeled `SIMULATION_ONLY`; its local receipt is a
  SHA-256 integrity artifact and its placeholder proof is explicitly not
  cryptographically verified.
- Install from a pinned release and verify its SHA-256 file. The installer
  creates an integrity-manifested managed copy and rejects credential-shaped
  paths, private-key material, provider tokens, binaries, and unexpected
  source drift.
- Keep real order creation disabled until Delta engineering replaces the
  integration seam with the production verifier pinned to an approved identity
  and proof program, authenticated external user authorization, signer,
  registry, and durable one-time authorization store, and completes the
  acceptance checks documented in this repository.
- If submission status is uncertain, reconcile by the existing client order ID.
  Do not retry Create Order blindly.

If credentials may have been exposed, revoke them in Coinbase immediately,
create a new least-privileged key, and review account and portfolio activity
before continuing.
