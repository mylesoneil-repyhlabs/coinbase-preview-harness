# Mastra 1.53 reference

This isolated package makes the Mastra claims reproducible. It pins
`@mastra/core@1.53.0`, `@mastra/libsql@1.17.1`, Zod and TypeScript.

```sh
pnpm install --ignore-workspace --ignore-scripts
pnpm run validate
```

`validate` does two things:

1. type-checks the `createTool`, strict schemas, and workflow against the
   pinned packages; and
2. constructs and invokes the Mastra tool, gets `REVIEW`, starts a real Mastra
   workflow with configured in-memory LibSQL storage, verifies that it
   suspends, and resumes it with an authenticated-review shape.

The resume result is `REAUTHORIZE_WITH_DELTA`. Approval never edits the old
`REVIEW` receipt into `PASS` and never invokes the payment adapter.

## Files

- `delta-vendor-payment-tool.ts` — strict `createTool` factory. A production
  app must inject the only payment-adapter reference into this trusted runtime
  closure.
- `vendor-payment-review-workflow.ts` — `createStep`/`createWorkflow` with
  `suspendSchema`, `resumeSchema`, persisted snapshot and zero retries.
- `run-reference-demo.ts` — executable local proof.

The exported simulated tool is safe for this demo only. It uses fixture
evidence, an ephemeral controller-pinned key, an in-memory one-use grant and a
simulated adapter.

## Integration rules

- Register the delta-gated tool, never an ungated payment tool.
- Treat `requestContextSchema` as shape validation, not authentication.
  Production middleware must derive tenant and principal values.
- Do not put credentials in prompts, inputs, request context, receipts, or
  traces.
- Keep adapter retries at zero unless the rail provides proven idempotency and
  reconciliation.
- On ambiguous submission, reconcile; do not resubmit.
- Replace fixture evidence, signer, evaluator and grant store before any
  production use.

This is a local Mastra reference and Brex-style payment simulation. It is not a
live Mastra deployment, a Brex integration, or production delta.
