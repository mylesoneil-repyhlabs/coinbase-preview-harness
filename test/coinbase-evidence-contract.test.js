import test from "node:test";
import assert from "node:assert/strict";
import { canonicalize, digest, digestBytes } from "../src/evidence.js";
import { extractSimulatedCoinbaseEvidence } from "../src/mandate/coinbase-evidence.js";
import {
  buildCoinbaseSolution,
  parseCoinbaseSolution,
} from "../src/mandate/coinbase-solution.js";

const FIXED_NOW = new Date("2026-07-24T14:00:00.000Z");

function evaluationFixture() {
  const previewRequest = {
    product_id: "ETH-USDC",
    side: "BUY",
    order_configuration: {
      sor_limit_ioc: {
        quote_size: "5.00",
        limit_price: "3015.00",
      },
    },
  };
  const createPayload = {
    client_order_id: "client-1",
    ...structuredClone(previewRequest),
    preview_id: "preview-1",
  };
  const market = {
    product_id: "ETH-USDC",
    product_type: "SPOT",
    base_asset: "ETH",
    quote_asset: "USDC",
    base_increment: "0.00000001",
    quote_increment: "0.01",
    price_increment: "0.01",
    best_bid: "2999.00",
    best_ask: "3000.00",
    observed_at: FIXED_NOW.toISOString(),
    status: "online",
    product_flags: {
      is_disabled: false,
      trading_disabled: false,
      cancel_only: false,
      limit_only: false,
      post_only: false,
      auction_mode: false,
    },
  };
  const preview = {
    order_total: "5.25",
    commission_total: "0.25",
    quote_size: "5.00",
    base_size: "0.00166113",
    est_average_filled_price: "3010.00",
    best_bid: "2999.00",
    best_ask: "3000.00",
    preview_id: "preview-1",
    errs: [],
    warning: [],
  };
  const collectedAt = FIXED_NOW.toISOString();
  const createPayloadSerialized = JSON.stringify(createPayload);
  return {
    create_payload: createPayload,
    create_payload_serialized: createPayloadSerialized,
    create_payload_digest: digestBytes(createPayloadSerialized),
    preview_request: previewRequest,
    preview_request_digest: digest(previewRequest),
    evidence: { market, preview, collected_at: collectedAt },
    evidence_digest: digest({
      market,
      preview,
      collected_at: collectedAt,
    }),
    credential_binding: {
      portfolio_fingerprint: "portfolio-1",
      credential_fingerprint: "credential-1",
    },
  };
}

function refreshBindings(evaluation) {
  evaluation.create_payload_serialized = JSON.stringify(
    evaluation.create_payload,
  );
  evaluation.create_payload_digest = digestBytes(
    evaluation.create_payload_serialized,
  );
  evaluation.preview_request_digest = digest(evaluation.preview_request);
  evaluation.evidence_digest = digest(evaluation.evidence);
  return evaluation;
}

function solutionFromMutation(mutate, { refresh = true } = {}) {
  const evaluation = evaluationFixture();
  mutate(evaluation);
  if (refresh) refreshBindings(evaluation);
  return buildCoinbaseSolution(evaluation);
}

function mutateEnvelope(solution, mutate) {
  const marker = "?envelope=";
  const markerAt = solution.indexOf(marker);
  const prefix = solution.slice(0, markerAt + marker.length);
  const envelope = JSON.parse(
    Buffer.from(solution.slice(markerAt + marker.length), "base64url").toString(
      "utf8",
    ),
  );
  mutate(envelope);
  return `${prefix}${Buffer.from(canonicalize(envelope)).toString("base64url")}`;
}

test("strict Coinbase evidence contract preserves the valid solution flow", () => {
  const solution = buildCoinbaseSolution(evaluationFixture());
  const envelope = parseCoinbaseSolution(solution);
  const evidence = extractSimulatedCoinbaseEvidence(solution, FIXED_NOW);

  assert.equal(envelope.schema_version, "delta.coinbase.solution.v1");
  assert.equal(evidence.product_id, "ETH-USDC");
  assert.equal(evidence.market_status, "online");
  assert.equal(evidence.trading_disabled, false);
  assert.equal(evidence.product_disabled, false);
  assert.equal(evidence.preview_request_matches_create, true);
  assert.equal(evidence.all_in_debit_microunits, 5_250_000);
});

test("all-in debit uses the exact larger of order_total and quote_size plus commission", () => {
  const understated = solutionFromMutation((evaluation) => {
    evaluation.create_payload.order_configuration.sor_limit_ioc.quote_size =
      "0.10";
    evaluation.preview_request.order_configuration.sor_limit_ioc.quote_size =
      "0.10";
    evaluation.evidence.preview.quote_size = "0.10";
    evaluation.evidence.preview.commission_total = "0.20";
    evaluation.evidence.preview.order_total = "0.299999";
  });
  const overstated = solutionFromMutation((evaluation) => {
    evaluation.evidence.preview.order_total = "5.250001";
  });

  assert.equal(
    extractSimulatedCoinbaseEvidence(understated, FIXED_NOW)
      .all_in_debit_microunits,
    300_000,
  );
  assert.equal(
    extractSimulatedCoinbaseEvidence(overstated, FIXED_NOW)
      .all_in_debit_microunits,
    5_250_001,
  );
});

test("every nested Coinbase object rejects unknown and missing fields", async (t) => {
  const baseSolution = buildCoinbaseSolution(evaluationFixture());
  const cases = [
    {
      name: "Create payload",
      expected: /Coinbase Create payload has an invalid field set/,
      unknown: () =>
        solutionFromMutation((evaluation) => {
          evaluation.create_payload.extra = true;
        }),
      missing: () =>
        solutionFromMutation((evaluation) => {
          delete evaluation.create_payload.preview_id;
        }),
    },
    {
      name: "Preview request",
      expected: /Coinbase Preview request has an invalid field set/,
      unknown: () =>
        solutionFromMutation((evaluation) => {
          evaluation.preview_request.extra = true;
        }),
      missing: () =>
        solutionFromMutation((evaluation) => {
          delete evaluation.preview_request.side;
        }),
    },
    {
      name: "Create order_configuration",
      expected:
        /Coinbase Create payload\.order_configuration has an invalid field set/,
      unknown: () =>
        solutionFromMutation((evaluation) => {
          evaluation.create_payload.order_configuration.extra = {};
        }),
      missing: () =>
        solutionFromMutation((evaluation) => {
          delete evaluation.create_payload.order_configuration.sor_limit_ioc;
        }),
    },
    {
      name: "Create sor_limit_ioc",
      expected:
        /Coinbase Create payload\.order_configuration\.sor_limit_ioc has an invalid field set/,
      unknown: () =>
        solutionFromMutation((evaluation) => {
          evaluation.create_payload.order_configuration.sor_limit_ioc.extra =
            "1";
        }),
      missing: () =>
        solutionFromMutation((evaluation) => {
          delete evaluation.create_payload.order_configuration.sor_limit_ioc
            .limit_price;
        }),
    },
    {
      name: "Preview order_configuration",
      expected:
        /Coinbase Preview request\.order_configuration has an invalid field set/,
      unknown: () =>
        solutionFromMutation((evaluation) => {
          evaluation.preview_request.order_configuration.extra = {};
        }),
      missing: () =>
        solutionFromMutation((evaluation) => {
          delete evaluation.preview_request.order_configuration.sor_limit_ioc;
        }),
    },
    {
      name: "Preview sor_limit_ioc",
      expected:
        /Coinbase Preview request\.order_configuration\.sor_limit_ioc has an invalid field set/,
      unknown: () =>
        solutionFromMutation((evaluation) => {
          evaluation.preview_request.order_configuration.sor_limit_ioc.extra =
            "1";
        }),
      missing: () =>
        solutionFromMutation((evaluation) => {
          delete evaluation.preview_request.order_configuration.sor_limit_ioc
            .limit_price;
        }),
    },
    {
      name: "claimed_evidence",
      expected: /Coinbase claimed evidence has an invalid field set/,
      unknown: () =>
        mutateEnvelope(baseSolution, (envelope) => {
          envelope.claimed_evidence.extra = true;
        }),
      missing: () =>
        mutateEnvelope(baseSolution, (envelope) => {
          delete envelope.claimed_evidence.portfolio_fingerprint;
        }),
    },
    {
      name: "market",
      expected: /Coinbase market evidence has an invalid field set/,
      unknown: () =>
        solutionFromMutation((evaluation) => {
          evaluation.evidence.market.extra = true;
        }),
      missing: () =>
        solutionFromMutation((evaluation) => {
          delete evaluation.evidence.market.status;
        }),
    },
    {
      name: "product_flags",
      expected:
        /Coinbase market evidence\.product_flags has an invalid field set/,
      unknown: () =>
        solutionFromMutation((evaluation) => {
          evaluation.evidence.market.product_flags.extra = false;
        }),
      missing: () =>
        solutionFromMutation((evaluation) => {
          delete evaluation.evidence.market.product_flags.trading_disabled;
        }),
    },
    {
      name: "preview",
      expected: /Coinbase preview evidence has an invalid field set/,
      unknown: () =>
        solutionFromMutation((evaluation) => {
          evaluation.evidence.preview.extra = "0";
        }),
      missing: () =>
        solutionFromMutation((evaluation) => {
          delete evaluation.evidence.preview.order_total;
        }),
    },
  ];

  for (const entry of cases) {
    await t.test(`${entry.name} rejects an unknown field`, () => {
      assert.throws(() => parseCoinbaseSolution(entry.unknown()), entry.expected);
    });
    await t.test(`${entry.name} rejects a missing field`, () => {
      assert.throws(() => parseCoinbaseSolution(entry.missing()), entry.expected);
    });
  }
});

test("market status and both disabled flags are required and never defaulted", () => {
  const noStatus = solutionFromMutation((evaluation) => {
    delete evaluation.evidence.market.status;
  });
  const noTradingFlag = solutionFromMutation((evaluation) => {
    delete evaluation.evidence.market.product_flags.trading_disabled;
  });
  const noProductFlag = solutionFromMutation((evaluation) => {
    delete evaluation.evidence.market.product_flags.is_disabled;
  });

  assert.throws(() => extractSimulatedCoinbaseEvidence(noStatus, FIXED_NOW));
  assert.throws(() =>
    extractSimulatedCoinbaseEvidence(noTradingFlag, FIXED_NOW),
  );
  assert.throws(() =>
    extractSimulatedCoinbaseEvidence(noProductFlag, FIXED_NOW),
  );
});

test("Preview request digest and claimed evidence digest are verified", () => {
  const valid = buildCoinbaseSolution(evaluationFixture());
  const previewDigestTamper = mutateEnvelope(valid, (envelope) => {
    envelope.preview_request_digest = "0".repeat(64);
  });
  const evidenceDigestTamper = mutateEnvelope(valid, (envelope) => {
    envelope.claimed_evidence.evidence_digest = "0".repeat(64);
  });

  assert.throws(
    () => parseCoinbaseSolution(previewDigestTamper),
    /Preview request digest mismatch/,
  );
  assert.throws(
    () => parseCoinbaseSolution(evidenceDigestTamper),
    /claimed evidence digest mismatch/,
  );
});

test("invalid, negative, and zero-only positive numeric evidence fails closed", async (t) => {
  const cases = [
    {
      name: "negative requested quote size",
      mutate: (evaluation) => {
        evaluation.create_payload.order_configuration.sor_limit_ioc.quote_size =
          "-1";
      },
    },
    {
      name: "non-decimal limit price",
      mutate: (evaluation) => {
        evaluation.preview_request.order_configuration.sor_limit_ioc.limit_price =
          "3e3";
      },
    },
    {
      name: "negative market price",
      mutate: (evaluation) => {
        evaluation.evidence.market.best_ask = "-3000";
      },
    },
    {
      name: "zero market price",
      mutate: (evaluation) => {
        evaluation.evidence.market.best_bid = "0";
      },
    },
    {
      name: "negative preview commission",
      mutate: (evaluation) => {
        evaluation.evidence.preview.commission_total = "-0.01";
      },
    },
    {
      name: "numeric preview value instead of decimal string",
      mutate: (evaluation) => {
        evaluation.evidence.preview.order_total = 5.25;
      },
    },
    {
      name: "zero preview fill price",
      mutate: (evaluation) => {
        evaluation.evidence.preview.est_average_filled_price = "0";
      },
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, () => {
      const solution = solutionFromMutation(entry.mutate);
      assert.throws(() => parseCoinbaseSolution(solution), /must be|positive/);
    });
  }
});
