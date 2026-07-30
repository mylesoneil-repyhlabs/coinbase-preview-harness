import test from "node:test";
import assert from "node:assert/strict";
import { createExecutionPlan } from "../src/plan.js";
import { runGuardPreflight } from "../src/preflight.js";
import {
  formatGuardResult,
  formatMandateCaptured,
} from "../src/preflight-presentation.js";

const INTENT =
  "Using my isolated Coinbase Advanced portfolio, use up to 3000 USDC to buy ETH on ETH-USDC once now with a price-bounded IOC limit order. Only if Coinbase's fresh best ask is at or below 3000 USDC. Partial fill is acceptable. Do not pay more than 35 bps above Coinbase's fresh best ask, more than 15 USDC in fees, or more than 3015 USDC total. This authorization expires 10 minutes after I confirm it.";

test("mandate capture shows every material boundary while hiding paths and hashes", async () => {
  const plan = await createExecutionPlan(INTENT);
  const compact = formatMandateCaptured({
    ...plan,
    __path: "/private/alice/plan.json",
  });

  assert.match(compact, /MANDATE CAPTURED · AWAITING YOUR AUTHORIZATION/);
  assert.match(compact, /up to 3000 USDC on ETH-USDC/);
  assert.match(compact, /best ask is at or below 3000 USDC/);
  assert.match(compact, /partial fills allowed/);
  assert.match(compact, /slippage no more than 35 bps/);
  assert.match(compact, /fee no more than 15 USDC/);
  assert.match(compact, /all-in debit no more than 3015 USDC/);
  assert.match(compact, /held USDC only; no asset conversion/);
  assert.match(compact, /one use; expires 600 seconds/);
  assert.match(compact, /Authorize this mandate/);
  assert.doesNotMatch(compact, /\/private\/alice/);
  assert.doesNotMatch(compact, /Policy digest:/);

  const details = formatMandateCaptured(
    { ...plan, __path: "/private/alice/plan.json" },
    { details: true },
  );
  assert.match(details, /\/private\/alice\/plan\.json/);
  assert.match(details, /Policy digest:/);
});

test("authorization failure never claims proposal, evidence, or eligibility", async () => {
  const plan = await createExecutionPlan(INTENT);
  const result = await runGuardPreflight({
    plan,
    confirmPolicyDigest: "not-the-displayed-policy",
    nonce: "presentation-failure-nonce",
    history: { enabled: false },
  });
  const output = formatGuardResult(result.record);

  assert.match(output, /DRY RUN · STOPPED BEFORE EVIDENCE/);
  assert.match(output, /Not created — verification stopped at authorization/);
  assert.match(output, /BLOCK — The confirmation does not match/);
  assert.match(output, /Review and confirm the currently displayed mandate/);
  assert.match(output, /No Coinbase contact, execution eligibility, Create, order, or money movement/);
  assert.doesNotMatch(output, /SIMULATED FACTS/);
  assert.doesNotMatch(output, /eligibility was consumed/);
  assert.doesNotMatch(output, /exact Preview economics/);
});

test("happy-path chat result rounds economics and keeps technical hashes on demand", async () => {
  const plan = await createExecutionPlan(INTENT);
  const result = await runGuardPreflight({
    plan,
    confirmPolicyDigest: plan.policy_digest,
    nonce: "presentation-happy-nonce",
    history: { enabled: false },
  });
  const compact = formatGuardResult(result.record);

  assert.match(compact, /DRY RUN · SIMULATED FACTS · NO ORDER SUBMITTED/);
  assert.match(compact, /PASS — .*local Delta simulation/);
  assert.match(compact, /estimated 1 ETH received/);
  assert.doesNotMatch(compact, /1\.000000000000000000/);
  assert.match(compact, /Checked: simulated .* checked \d{4}-\d{2}-\d{2}T/);
  assert.match(compact, /No Coinbase contact, executor, Create, order, or money movement/);
  assert.doesNotMatch(compact, /Policy digest:/);
  assert.doesNotMatch(compact, /Receipt digest:/);

  const details = formatGuardResult(result.record, { details: true });
  assert.match(details, /Policy digest:/);
  assert.match(details, /Receipt digest:/);
  assert.match(details, /Receipt limitation:/);
});
