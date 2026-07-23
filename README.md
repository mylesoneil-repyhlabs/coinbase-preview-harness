# Coinbase Preview Harness

This is a real, preview-only integration harness for the Coinbase Advanced Trade seam that matters to delta:

1. Accept one closed-schema agent order proposal.
2. Check the human mandate before Coinbase is called.
3. Call Coinbase **Preview Order** through the pinned official CLI.
4. Check the returned total debit and commission.
5. Export a sanitized JSON and self-contained HTML verification record.
6. Stop. There is no order-execution adapter or command.

The first demo mandate is intentionally narrow:

- `ETH-USDC` only, avoiding the exact `ETH-USD` substitution risk Coinbase documents.
- `BUY` only.
- `market` only.
- Principal (`quote_size`) at or below `20.00 USDC`.
- Estimated all-in debit at or below `21.00 USDC`.
- Estimated commission at or below `1.00 USDC`.
- Slippage is recorded but not enforced until Coinbase's units are confirmed from a live response.

The current evaluator is a deterministic integration prototype. The output is a **preview verification record**, not a production delta receipt or proof. Its value before production integration is concrete: it fixes the Coinbase adapter contract, proves local fail-closed behavior, captures live preview economics after credentials, and produces a screen-shareable artifact for the Coinbase conversation.

## What is already runnable without credentials

Node 22+ and pnpm are required. The included `./run` wrapper uses `node` from `PATH`; in an unusual environment, set `HARNESS_NODE_BINARY` to an explicit Node executable.

```sh
pnpm install --ignore-scripts
./run doctor
pnpm test
./run fixtures
./run sandbox
```

`pnpm fixtures` runs six proposals. Only the exact allowed proposal reaches the official Coinbase CLI dry-run; wrong pair, wrong side, wrong amount, unauthorized order type, and unknown-field proposals are blocked before the adapter.

The official CLI dry-run proves request assembly only. It does not contact Coinbase. The static Coinbase sandbox verifies production-shaped response parsing but returns mocked values and is not client proof.

Generated readiness artifacts:

- `artifacts/credential-readiness.json`
- `artifacts/credential-readiness.html`

## Credential boundary

Stop here until the user creates a dedicated CDP API key.

Create the key in the Coinbase Developer Platform:

1. Select one isolated Coinbase Advanced portfolio.
2. Select **ECDSA / ES256**.
3. Grant **View only**.
4. Leave **Trade**, **Transfer**, and **Receive** disabled.
5. Add this machine's public IP to the allowlist, or explicitly opt out of IP restriction for this isolated preview key.
6. Download the JSON key file and keep it outside this repository.

Coinbase's endpoint matrix lists Preview Order as requiring `view`; live order creation requires `trade`. This harness refuses any key with Trade, Transfer, or Receive capability.

When ready, provide only the key file's local path—never paste its contents. The integrated command verifies `/key_permissions` first, refuses Trade/Transfer, imports the key through Coinbase's official CLI, and stores only fingerprints locally:

```sh
./run configure --key-file /absolute/path/to/downloaded-key.json
```

The key secret is persisted by Coinbase's CLI in the macOS keychain. Runtime metadata is isolated under the ignored `runtime/` directory. The harness never prints or exports the key, and a changed key invalidates the permission attestation.

The scoped portfolio needs enough USDC for the preview; an empty portfolio can return `PREVIEW_INSUFFICIENT_FUND`.

## Live preview

After the view-only permission attestation exists:

```sh
./run preview --live-preview --fixture allowed
```

This invokes exactly:

```text
orders preview product_id=ETH-USDC side=BUY type=market quote_size=20.00
```

It does not expose Coinbase's generic command surface, MCP server, order creation, convert execution, transfers, cancellation, position closing, or portfolio mutation.

The generated live HTML contains the mandate, proposal, Coinbase fee/fill estimate, pre- and post-preview decisions, sanitized record digest, and an explicit `NO ORDER CREATED` statement.

## Safety properties

- Pinned `@coinbase/coinbase-cli@0.0.4`; no PATH lookup.
- `execFile(process.execPath, ...)`, fixed preview arguments, `shell:false`.
- Closed order schema; unknown fields fail closed.
- Existing ambient Coinbase credentials and URL overrides are scrubbed.
- Isolated Coinbase environment and config directory.
- CLI request history and update checks disabled.
- View-only permission verification before a live preview.
- Timeouts, output limits, JSON validation, decimal-string validation, and sanitized errors.
- Failed prechecks prove the Coinbase adapter was never called.
- Static HTML has no external assets, analytics, fonts, or network calls.
- No execution adapter exists.

## Official references

- https://docs.cdp.coinbase.com/coinbase-for-agents/skill.md
- https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/rest-api
- https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/orders/preview-orders
- https://docs.cdp.coinbase.com/coinbase-business/advanced-trade-apis/sandbox
