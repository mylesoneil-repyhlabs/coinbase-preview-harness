import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCoinbaseCreateRequest,
  buildCoinbasePreviewRequest,
} from "../src/coinbase-order.js";
import { digest, digestBytes } from "../src/evidence.js";
import { evaluateCoinbaseFunding } from "../src/funding.js";
import { compileDeterministicIntent } from "../src/intent-compiler.js";
import {
  extractSimulatedCoinbaseEvidence,
} from "../src/mandate/coinbase-evidence.js";
import {
  buildCoinbaseSolution,
  parseCoinbaseSolution,
} from "../src/mandate/coinbase-solution.js";
import { proposeSpotOrder } from "../src/proposer.js";
import { createCanonicalSpotAction } from "../src/spot-action.js";

const BUY_INTENT =
  "Using my isolated Coinbase Advanced portfolio, use exactly 250 USDC to buy SOL on SOL-USDC once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not pay more than 40 bps above Coinbase's fresh best ask, more than 2 USDC in commission, or more than 252 USDC total. This authorization expires 2 minutes after I confirm it.";
const SELL_INTENT =
  "Using my isolated Coinbase Advanced portfolio, use exactly 0.05000000 BTC to sell BTC on BTC-USD once now with a price-bounded IOC limit order. Partial fill is acceptable. Do not accept more than 40 bps below Coinbase's fresh best bid, pay more than 8 USD in commission, or receive at least 3190 USD after commission. This authorization expires 2 minutes after I confirm it.";
const FIXED = new Date("2026-07-23T18:00:00.000Z");

function fixture(intent) {
  const policy = compileDeterministicIntent(intent).policy;
  const sell = policy.side === "SELL";
  const market = {
    product_id: policy.product_id,
    product_type: "SPOT",
    base_asset: policy.base_asset,
    quote_asset: policy.quote_asset,
    base_increment: "0.00000001",
    quote_increment: "0.01",
    price_increment: "0.01",
    base_min_size: "0.00000001",
    base_max_size: "1000000",
    quote_min_size: "0.01",
    quote_max_size: "10000000",
    best_bid: sell ? "64000.00" : "149.90",
    best_ask: sell ? "64001.00" : "150.00",
    observed_at: FIXED.toISOString(),
    status: "online",
    product_flags: {
      is_disabled: false,
      trading_disabled: false,
      view_only: false,
      cancel_only: false,
      limit_only: false,
      post_only: false,
      auction_mode: false,
    },
  };
  const proposal = proposeSpotOrder(policy, market, { now: FIXED });
  const preview = sell
    ? {
        order_total: "3200",
        commission_total: "5",
        quote_size: "3200",
        base_size: "0.05000000",
        est_average_filled_price: "63900",
        best_bid: "64000",
        best_ask: "64001",
        preview_id: "preview-sell",
        errs: [],
        warning: [],
      }
    : {
        order_total: "251",
        commission_total: "1",
        quote_size: "250",
        base_size: "1.66",
        est_average_filled_price: "150.40",
        best_bid: "149.90",
        best_ask: "150",
        preview_id: "preview-buy",
        errs: [],
        warning: [],
      };
  const fundingResult = evaluateCoinbaseFunding(
    policy,
    {
      accounts: [
        {
          uuid: `account-${policy.side}`,
          currency:
            policy.side === "BUY"
              ? policy.quote_asset
              : policy.base_asset,
          available_balance: {
            currency:
              policy.side === "BUY"
                ? policy.quote_asset
                : policy.base_asset,
            value:
              policy.side === "BUY"
                ? "500"
                : "1.00000000",
          },
          active: true,
          ready: true,
          deleted_at: null,
          platform: "ACCOUNT_PLATFORM_CONSUMER",
          retail_portfolio_id: "portfolio-1",
        },
      ],
      has_next: false,
      cursor: null,
    },
    { portfolioFingerprint: "portfolio-fingerprint" },
  );
  const {
    decision: _decision,
    evidence_issues: _evidenceIssues,
    policy_failures: _policyFailures,
    failures: _failures,
    ...funding
  } = fundingResult;
  const previewRequest = buildCoinbasePreviewRequest(proposal.action);
  const createPayload = buildCoinbaseCreateRequest(
    proposal.action,
    "00000000-0000-4000-8000-000000000001",
    preview.preview_id,
  );
  const serialized = JSON.stringify(createPayload);
  const evidence = {
    market,
    preview,
    funding,
    collected_at: FIXED.toISOString(),
  };
  return {
    schema_version: "delta.coinbase.evaluation_request.v2",
    action_descriptor: createCanonicalSpotAction(policy),
    create_payload: createPayload,
    create_payload_serialized: serialized,
    create_payload_digest: digestBytes(serialized),
    preview_request: previewRequest,
    preview_request_digest: digest(previewRequest),
    evidence,
    evidence_digest: digest(evidence),
    credential_binding: {
      portfolio_fingerprint: "portfolio-fingerprint",
      credential_fingerprint: "credential-fingerprint",
    },
  };
}

test("strict v2 solution preserves generic BUY and SELL evidence", () => {
  for (const intent of [BUY_INTENT, SELL_INTENT]) {
    const evaluation = fixture(intent);
    const solution = buildCoinbaseSolution(evaluation);
    const parsed = parseCoinbaseSolution(solution);
    const evidence = extractSimulatedCoinbaseEvidence(solution, FIXED);
    assert.deepEqual(parsed.create_payload, evaluation.create_payload);
    assert.equal(
      evidence.action_descriptor_digest,
      evaluation.action_descriptor.descriptor_digest,
    );
    assert.equal(
      evidence.funding_evidence_digest,
      evaluation.evidence.funding.evidence_digest,
    );
    assert.equal(evidence.side, evaluation.create_payload.side);
    assert.equal(evidence.funding_sufficient, true);
    assert.equal(evidence.settlement_within_limit, true);
    assert.equal(evidence.limit_price_within_bound, true);
    assert.equal(
      evidence.authorized_limit_price,
      evaluation.create_payload.order_configuration.sor_limit_ioc
        .limit_price,
    );
  }
});

test("eight-decimal SELL size is preserved as a canonical decimal string", () => {
  const evidence = extractSimulatedCoinbaseEvidence(
    buildCoinbaseSolution(fixture(SELL_INTENT)),
    FIXED,
  );
  assert.equal(evidence.size_field, "base_size");
  assert.equal(evidence.size_value, "0.05000000");
  assert.equal(evidence.settlement_kind, "MIN_NET_QUOTE_PROCEEDS");
  assert.equal(evidence.settlement_value, "3195");
});

test("BUY debit uses the larger of order_total and quote_size plus fee", () => {
  const evaluation = fixture(BUY_INTENT);
  evaluation.evidence.preview.order_total = "250.10";
  evaluation.evidence.preview.commission_total = "1";
  evaluation.evidence_digest = digest(evaluation.evidence);
  const evidence = extractSimulatedCoinbaseEvidence(
    buildCoinbaseSolution(evaluation),
    FIXED,
  );
  assert.equal(evidence.settlement_value, "251");
});

test("solution rejects descriptor, payload, Preview, and funding tampering", () => {
  const changes = [
    (value) => {
      value.action_descriptor.side = "SELL";
    },
    (value) => {
      value.create_payload.product_id = "BTC-USDC";
    },
    (value) => {
      value.preview_request.side = "SELL";
    },
    (value) => {
      value.evidence.funding.available_balance = "0";
    },
  ];
  for (const change of changes) {
    const evaluation = fixture(BUY_INTENT);
    change(evaluation);
    assert.throws(
      () => parseCoinbaseSolution(buildCoinbaseSolution(evaluation)),
      /digest|match|invalid|mismatch|BUY|funding/i,
    );
  }
});

test("closed envelopes reject unknown fields and nonempty warnings", () => {
  const unknown = fixture(BUY_INTENT);
  unknown.create_payload.leverage = "10";
  assert.throws(
    () => parseCoinbaseSolution(buildCoinbaseSolution(unknown)),
    /invalid field set|bytes mismatch/,
  );
  const warning = fixture(BUY_INTENT);
  warning.evidence.preview.warning = ["UNKNOWN"];
  warning.evidence_digest = digest(warning.evidence);
  assert.throws(
    () => parseCoinbaseSolution(buildCoinbaseSolution(warning)),
    /warning must be an empty array/,
  );
});
