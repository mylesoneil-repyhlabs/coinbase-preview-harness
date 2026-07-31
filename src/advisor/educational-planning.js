import {
  compareDecimals,
  divideDecimals,
  isPositiveDecimal,
  multiplyDecimals,
} from "../decimal.js";
import { digest } from "../evidence.js";
import { normalizeCoinbaseMarketData } from "../market.js";

export const EDUCATIONAL_PLANNING_API = Object.freeze({
  schema_version: "delta.coinbase.educational_planning_api.v1",
  lifecycle: "SESSION_ONLY",
  persistence: "NONE",
  network_access: false,
  credential_access: false,
  execution_access: false,
});

export const EDUCATIONAL_PROVENANCE = Object.freeze({
  GENERATED_FIXTURE: "Generated fixture",
  COINBASE_OBSERVED: "Coinbase observed",
  LOCALLY_CURATED_PRIMARY_SOURCE:
    "Locally curated summary of primary source",
  CALCULATED_LOCALLY: "Calculated locally",
  USER_SUPPLIED: "User supplied",
});

const SNAPSHOT_SCHEMA =
  "delta.coinbase.educational_market_snapshot.v1";
const PLAN_SCHEMA =
  "delta.coinbase.educational_portfolio_plan.v1";
const HANDOFF_SCHEMA =
  "delta.coinbase.educational_trade_handoff.v1";
const DRAFT_SCHEMA =
  "delta.coinbase.protected_trade_mandate_draft.v1";
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ASSET = /^[A-Z0-9]{2,15}$/;
const PRODUCT = /^[A-Z0-9]{2,15}-[A-Z0-9]{2,15}$/;
const MAX_CLOCK_SKEW_MS = 5_000;
const MAX_ALLOCATIONS = 20;
const MAX_SCENARIOS = 8;
const TRUSTED_MARKET_SOURCES = new Set([
  "fixture",
  "view_only",
]);
const CURATED_EDUCATIONAL_CATALOG = Object.freeze({
  BTC: Object.freeze({
    asset: "BTC",
    title: "Bitcoin: A Peer-to-Peer Electronic Cash System",
    summary:
      "Bitcoin is a peer-to-peer electronic cash protocol. Its protocol design does not guarantee market value, liquidity, or returns.",
    publisher: "Satoshi Nakamoto",
    canonical_url: "https://bitcoin.org/bitcoin.pdf",
    reviewed_at: "2026-07-30T00:00:00.000Z",
    catalog_version: "2026-07-30",
  }),
  ETH: Object.freeze({
    asset: "ETH",
    title: "What is Ethereum?",
    summary:
      "Ethereum is a programmable blockchain whose native ETH asset is used for network fees and protocol staking. Its protocol design does not guarantee market value, liquidity, or returns.",
    publisher: "ethereum.org community",
    canonical_url: "https://ethereum.org/en/what-is-ethereum/",
    reviewed_at: "2026-07-30T00:00:00.000Z",
    catalog_version: "2026-07-30",
  }),
  SOL: Object.freeze({
    asset: "SOL",
    title: "Solana core concepts",
    summary:
      "Solana is a blockchain built around an account model and proof-of-history-assisted consensus. Its protocol design does not guarantee token price, liquidity, or returns.",
    publisher: "Solana Foundation",
    canonical_url: "https://solana.com/docs/core",
    reviewed_at: "2026-07-30T00:00:00.000Z",
    catalog_version: "2026-07-30",
  }),
});

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function cleanText(value, maximum) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= maximum ? cleaned : null;
}

function cleanIdentifier(value) {
  const cleaned = cleanText(value, 128);
  return cleaned && IDENTIFIER.test(cleaned) ? cleaned : null;
}

function cleanAsset(value) {
  const cleaned = cleanText(value, 15);
  return cleaned && ASSET.test(cleaned) ? cleaned : null;
}

function cleanProduct(value) {
  const cleaned = cleanText(value, 31);
  return cleaned && PRODUCT.test(cleaned) ? cleaned : null;
}

function isoTimestamp(value) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function positiveSeconds(value) {
  return Number.isInteger(value) && value >= 1 && value <= 31_536_000
    ? value
    : null;
}

function issue(code, message, recovery) {
  return { code, message, recovery };
}

function decision(outcome, code, reason, recovery) {
  return { outcome, code, reason, recovery };
}

function provenance(label, details = {}) {
  return {
    label,
    ...details,
    eligible_as_guard_evidence: false,
  };
}

function guardBoundary() {
  return {
    eligible_as_guard_evidence: false,
    research_used_as_guard_evidence: false,
    statement:
      "Educational research and planning are never Delta Guard evidence. A later trade check must obtain fresh execution evidence.",
  };
}

function capabilityBoundary() {
  return {
    educational_only: true,
    individualized_financial_advice: false,
    asset_ranking: false,
    suitability_assessment: false,
    automatic_purchase: false,
    rebalance_execution: false,
    batch_authorization: false,
    multi_leg_authorization: false,
    order_submission: false,
  };
}

function sealPlan(model) {
  const sealed = {
    ...model,
    model_integrity: {
      algorithm: "SHA-256",
      digest: digest(model),
      proof_limit:
        "Local model-integrity binding only; not Guard evidence, authorization, or a Delta receipt.",
    },
  };
  return deepFreeze(sealed);
}

function planIntegrityVerified(plan) {
  if (
    plan?.model_integrity?.algorithm !== "SHA-256" ||
    typeof plan?.model_integrity?.digest !== "string"
  ) {
    return false;
  }
  const { model_integrity, ...model } = plan;
  return digest(model) === model_integrity.digest;
}

function staleFact(observedAt, evaluatedAt, maxAgeSeconds) {
  if (!observedAt || !evaluatedAt || !maxAgeSeconds) {
    return { stale: true, clock_skew: false, expires_at: null };
  }
  const observed = Date.parse(observedAt);
  const evaluated = Date.parse(evaluatedAt);
  const age = evaluated - observed;
  return {
    stale: age > maxAgeSeconds * 1_000 || age < -MAX_CLOCK_SKEW_MS,
    clock_skew: age < -MAX_CLOCK_SKEW_MS,
    expires_at: new Date(observed + maxAgeSeconds * 1_000).toISOString(),
  };
}

function earliestTimestamp(values) {
  const valid = values
    .filter(Boolean)
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  return valid.length
    ? new Date(Math.min(...valid)).toISOString()
    : null;
}

function trimDecimal(value) {
  if (!value.includes(".")) return value;
  const trimmed = value.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed || "0";
}

function calculatedAllocation(amount, weightBps) {
  return trimDecimal(
    divideDecimals(
      multiplyDecimals(amount, String(weightBps)),
      "10000",
      { scale: 8 },
    ),
  );
}

function signedRatio(numerator, denominator, scale = 4) {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const factor = 10n ** BigInt(scale);
  const scaled = (absolute * factor) / denominator;
  const integer = scaled / factor;
  const fraction = (scaled % factor)
    .toString()
    .padStart(scale, "0")
    .replace(/0+$/, "");
  const text = fraction ? `${integer}.${fraction}` : integer.toString();
  return `${negative && scaled !== 0n ? "-" : ""}${text}`;
}

function snapshotResult(snapshot, issues) {
  const available = issues.length === 0;
  return deepFreeze({
    ...snapshot,
    status: available
      ? "SNAPSHOT_AVAILABLE_FOR_EDUCATION"
      : "REVIEW",
    decision: available
      ? decision(
          "SNAPSHOT_AVAILABLE_FOR_EDUCATION",
          "EDUCATIONAL_SNAPSHOT_AVAILABLE",
          "The selected market snapshot and curated educational sources are current and explicitly labeled.",
          "Use the snapshot only for education and planning.",
        )
      : decision(
          "REVIEW",
          "EDUCATIONAL_SNAPSHOT_UNVERIFIABLE",
          "Required educational or market facts are missing, stale, malformed, unavailable, or clock-mismatched.",
          "Refresh the exact missing facts. No fixture or substitute will be used.",
        ),
    issues,
  });
}

function createEducationalMarketSnapshot({
  snapshot_id,
  evaluated_at,
  market_max_age_seconds,
  education_max_age_seconds,
  market_source,
  requested_product_ids,
  products,
} = {}, {
  trustedCoinbaseObservations = null,
} = {}) {
  const issues = [];
  const snapshotId = cleanIdentifier(snapshot_id);
  const evaluatedAt = isoTimestamp(evaluated_at);
  const marketSource = TRUSTED_MARKET_SOURCES.has(market_source)
    ? market_source
    : null;
  const marketMaxAge = positiveSeconds(market_max_age_seconds);
  const educationMaxAge = positiveSeconds(
    education_max_age_seconds,
  );
  if (!snapshotId) {
    issues.push(
      issue(
        "SNAPSHOT_ID_INVALID",
        "A local snapshot identifier is required.",
        "Create a new session-local identifier.",
      ),
    );
  }
  if (!evaluatedAt) {
    issues.push(
      issue(
        "SNAPSHOT_CLOCK_INVALID",
        "The snapshot evaluation time is missing or malformed.",
        "Retry with a valid current timestamp.",
      ),
    );
  }
  if (!marketSource) {
    issues.push(
      issue(
        "MARKET_SOURCE_INVALID",
        "The server did not select a supported market source.",
        "Choose the explicit generated fixture or connected View-only source.",
      ),
    );
  }
  if (!marketMaxAge || !educationMaxAge) {
    issues.push(
      issue(
        "FRESHNESS_WINDOW_INVALID",
        "Explicit market and educational freshness windows are required.",
        "Supply positive freshness windows before planning.",
      ),
    );
  }

  const requestedProducts = Array.isArray(requested_product_ids)
    ? requested_product_ids.map(cleanProduct).filter(Boolean)
    : [];
  if (
    requestedProducts.length === 0 ||
    new Set(requestedProducts).size !== requestedProducts.length
  ) {
    issues.push(
      issue(
        "REQUESTED_PRODUCTS_INVALID",
        "Choose one or more unique supported spot products.",
        "Select explicit products; no pair will be inferred or substituted.",
      ),
    );
  }

  const normalizedProducts = [];
  const productIds = new Set();
  if (!Array.isArray(products) || products.length === 0) {
    issues.push(
      issue(
        "MARKET_FACTS_MISSING",
        "No Coinbase spot-product facts were supplied.",
        "Refresh the selected spot products.",
      ),
    );
  } else {
    for (const [index, product] of products.entries()) {
      const brandedCoinbaseObservation =
        trustedCoinbaseObservations instanceof WeakSet &&
        trustedCoinbaseObservations.has(product);
      if (
        marketSource === "view_only" &&
        !brandedCoinbaseObservation
      ) {
        issues.push(
          issue(
            "COINBASE_OBSERVATION_UNTRUSTED",
            `Market observation ${index + 1} was not produced by this server's View-only adapter path.`,
            "Discard it and repeat the exact View-only product and BBO read in this local session.",
          ),
        );
        continue;
      }
      const productId = cleanProduct(product?.product_id);
      const baseAsset = cleanAsset(product?.base_asset);
      const quoteAsset = cleanAsset(product?.quote_asset);
      const observedAt = isoTimestamp(product?.observed_at);
      const bestBid = isPositiveDecimal(product?.best_bid)
        ? product.best_bid
        : null;
      const bestAsk = isPositiveDecimal(product?.best_ask)
        ? product.best_ask
        : null;
      const expectedProduct =
        baseAsset && quoteAsset ? `${baseAsset}-${quoteAsset}` : null;
      if (
        !productId ||
        !baseAsset ||
        !quoteAsset ||
        productId !== expectedProduct ||
        !observedAt ||
        !bestBid ||
        !bestAsk ||
        compareDecimals(bestBid, bestAsk) >= 0 ||
        product?.product_type !== "SPOT"
      ) {
        issues.push(
          issue(
            "MARKET_FACT_MALFORMED",
            `Spot-product fact ${index + 1} is incomplete or malformed.`,
            "Refresh that exact Coinbase spot product.",
          ),
        );
        continue;
      }
      if (productIds.has(productId)) {
        issues.push(
          issue(
            "MARKET_FACT_DUPLICATE",
            `${productId} was supplied more than once.`,
            "Refresh one unambiguous fact for the product.",
          ),
        );
        continue;
      }
      productIds.add(productId);
      if (!requestedProducts.includes(productId)) {
        issues.push(
          issue(
            "MARKET_FACT_UNREQUESTED",
            `${productId} was not selected for this educational snapshot.`,
            "Discard the unrequested fact and refresh only the selected products.",
          ),
        );
      }
      const freshness = staleFact(
        observedAt,
        evaluatedAt,
        marketMaxAge,
      );
      if (freshness.stale) {
        issues.push(
          issue(
            freshness.clock_skew
              ? "MARKET_CLOCK_MISMATCH"
              : "MARKET_FACT_STALE",
            `${productId} does not have a current, clock-consistent observation.`,
            `Refresh ${productId}; do not substitute another product.`,
          ),
        );
      }
      const available =
        marketSource === "view_only"
          ? brandedCoinbaseObservation
          : product?.available === true;
      if (!available) {
        issues.push(
          issue(
            "PRODUCT_UNAVAILABLE",
            `${productId} is not explicitly available for spot planning.`,
            `Refresh ${productId} availability; do not substitute another pair.`,
          ),
        );
      }
      const label =
        marketSource === "view_only"
          ? EDUCATIONAL_PROVENANCE.COINBASE_OBSERVED
          : EDUCATIONAL_PROVENANCE.GENERATED_FIXTURE;
      const sourceReference =
        marketSource === "view_only"
          ? "Coinbase Advanced Trade exact product and best bid/ask"
          : "Checked-in generated educational market fixture";
      normalizedProducts.push({
        product_id: productId,
        base_asset: baseAsset,
        quote_asset: quoteAsset,
        product_type: "SPOT",
        available,
        provenance: provenance(label, {
          source_reference: sourceReference,
        }),
        best_bid: {
          value: bestBid,
          asset: quoteAsset,
          observed_at: observedAt,
          provenance: provenance(label, {
            source_reference: sourceReference,
          }),
        },
        best_ask: {
          value: bestAsk,
          asset: quoteAsset,
          observed_at: observedAt,
          provenance: provenance(label, {
            source_reference: sourceReference,
          }),
        },
        expires_at: freshness.expires_at,
      });
    }
  }
  for (const productId of requestedProducts) {
    if (!productIds.has(productId)) {
      issues.push(
        issue(
          "SELECTED_MARKET_FACT_MISSING",
          `${productId} has no complete observation from the selected source.`,
          `Refresh ${productId}; no fixture or alternate product will be substituted.`,
        ),
      );
    }
  }

  const normalizedEducation = [];
  const selectedAssets = new Set(
    requestedProducts.map((productId) => productId.split("-")[0]),
  );
  for (const asset of selectedAssets) {
    const source = CURATED_EDUCATIONAL_CATALOG[asset];
    if (!source) {
      issues.push(
        issue(
          "EDUCATIONAL_SOURCE_MISSING",
          `${asset} is not present in the checked-in curated educational catalog.`,
          "Choose a catalog-supported asset or update and review the primary-source record.",
        ),
      );
      continue;
    }
    const freshness = staleFact(
      source.reviewed_at,
      evaluatedAt,
      educationMaxAge,
    );
    if (freshness.stale) {
      issues.push(
        issue(
          freshness.clock_skew
            ? "EDUCATIONAL_CLOCK_MISMATCH"
            : "EDUCATIONAL_SOURCE_STALE",
          `${asset} educational material is outside the reviewed freshness window.`,
          "Review and update that canonical primary-source record before planning.",
        ),
      );
    }
    normalizedEducation.push({
      asset,
      title: source.title,
      summary: source.summary,
      publisher: source.publisher,
      canonical_url: source.canonical_url,
      catalog_reviewed_at: source.reviewed_at,
      catalog_version: source.catalog_version,
      content_digest: digest({
        asset,
        title: source.title,
        summary: source.summary,
        publisher: source.publisher,
        canonical_url: source.canonical_url,
        catalog_reviewed_at: source.reviewed_at,
        catalog_version: source.catalog_version,
      }),
      provenance: provenance(
        EDUCATIONAL_PROVENANCE.LOCALLY_CURATED_PRIMARY_SOURCE,
        {
          publisher: source.publisher,
          canonical_url: source.canonical_url,
          catalog_reviewed_at: source.reviewed_at,
          catalog_version: source.catalog_version,
        },
      ),
      expires_at: freshness.expires_at,
    });
  }

  return snapshotResult(
    {
      schema_version: SNAPSHOT_SCHEMA,
      artifact_class: "EDUCATIONAL_MARKET_SNAPSHOT",
      snapshot_id: snapshotId,
      evaluated_at: evaluatedAt,
      market_source: marketSource,
      expires_at: earliestTimestamp([
        ...normalizedProducts.map((item) => item.expires_at),
        ...normalizedEducation.map((item) => item.expires_at),
      ]),
      facts: {
        products: normalizedProducts,
        educational_sources: normalizedEducation,
      },
      provenance_legend: Object.values(EDUCATIONAL_PROVENANCE),
      source_selection: {
        requested: marketSource,
        used: marketSource,
        fallback_used: false,
      },
      fallback: {
        used: false,
        fixture_used: marketSource === "fixture",
        substitution_used: false,
      },
      guard_boundary: guardBoundary(),
      capability_boundary: capabilityBoundary(),
    },
    issues,
  );
}

export function createGeneratedEducationalMarketSnapshot(
  input = {},
) {
  return createEducationalMarketSnapshot({
    ...input,
    market_source: "fixture",
  });
}

/**
 * Creates one server-local provenance authority.
 *
 * `normalizeCoinbaseMarketData` intentionally proves only that a response has
 * the expected shape. This closure separately remembers observations produced
 * from raw product and BBO results returned through the server-owned View-only
 * adapter. The authority object stays inside the request handler and is never
 * exposed through an HTTP response or accepted from browser input.
 */
export function createEducationalViewOnlyAuthority() {
  const trustedCoinbaseObservations = new WeakSet();

  function normalizeAdapterResult(
    product,
    bestBidAsk,
    productId,
  ) {
    const observation = normalizeCoinbaseMarketData(
      product,
      bestBidAsk,
      productId,
    );
    trustedCoinbaseObservations.add(observation);
    return observation;
  }

  function createSnapshot(input = {}) {
    return createEducationalMarketSnapshot(
      {
        ...input,
        market_source: "view_only",
      },
      { trustedCoinbaseObservations },
    );
  }

  return Object.freeze({
    normalizeAdapterResult,
    createSnapshot,
  });
}

function normalizeAllocations(allocations) {
  const issues = [];
  const normalized = [];
  const assets = new Set();
  const products = new Set();
  if (
    !Array.isArray(allocations) ||
    allocations.length === 0 ||
    allocations.length > MAX_ALLOCATIONS
  ) {
    issues.push(
      issue(
        "ALLOCATION_COUNT_INVALID",
        `Choose between 1 and ${MAX_ALLOCATIONS} spot allocations.`,
        "Edit the user-selected allocation list.",
      ),
    );
    return { issues, normalized };
  }
  let totalWeight = 0;
  for (const [index, allocation] of allocations.entries()) {
    const asset = cleanAsset(allocation?.asset);
    const productId = cleanProduct(allocation?.product_id);
    const weightBps = allocation?.weight_bps;
    if (
      !asset ||
      !productId ||
      !Number.isInteger(weightBps) ||
      weightBps < 1 ||
      weightBps > 10_000
    ) {
      issues.push(
        issue(
          "ALLOCATION_INVALID",
          `Allocation ${index + 1} must identify one asset, one spot pair, and a positive basis-point weight.`,
          "Edit the allocation rather than inferring a value.",
        ),
      );
      continue;
    }
    if (assets.has(asset) || products.has(productId)) {
      issues.push(
        issue(
          "ALLOCATION_DUPLICATE",
          `${asset} or ${productId} appears more than once.`,
          "Combine or remove the duplicate allocation.",
        ),
      );
      continue;
    }
    assets.add(asset);
    products.add(productId);
    totalWeight += weightBps;
    normalized.push({
      asset,
      product_id: productId,
      weight_bps: weightBps,
      provenance: provenance(
        EDUCATIONAL_PROVENANCE.USER_SUPPLIED,
      ),
    });
  }
  if (totalWeight !== 10_000) {
    issues.push(
      issue(
        "ALLOCATION_TOTAL_INVALID",
        `User-selected weights total ${totalWeight} basis points, not 10000.`,
        "Edit the weights so they total exactly 100%.",
      ),
    );
  }
  return { issues, normalized };
}

function normalizeScenarios(scenarios, allocations) {
  const issues = [];
  const normalized = [];
  if (!Array.isArray(scenarios) || scenarios.length > MAX_SCENARIOS) {
    issues.push(
      issue(
        "SCENARIO_COUNT_INVALID",
        `Supply between 0 and ${MAX_SCENARIOS} simple scenarios.`,
        "Edit the user-supplied scenario list.",
      ),
    );
    return { issues, normalized };
  }
  const selectedAssets = new Set(
    allocations.map((allocation) => allocation.asset),
  );
  const names = new Set();
  for (const [index, scenario] of scenarios.entries()) {
    const name = cleanText(scenario?.name, 80);
    const changes = scenario?.changes;
    if (
      !name ||
      names.has(name) ||
      !Array.isArray(changes) ||
      changes.length !== selectedAssets.size
    ) {
      issues.push(
        issue(
          "SCENARIO_INVALID",
          `Scenario ${index + 1} must have a unique name and one explicit change for every selected asset.`,
          "Edit the scenario; missing changes are never assumed to be zero.",
        ),
      );
      continue;
    }
    names.add(name);
    const seen = new Set();
    const normalizedChanges = [];
    let weightedNumerator = 0n;
    let valid = true;
    for (const change of changes) {
      const asset = cleanAsset(change?.asset);
      const changeBps = change?.change_bps;
      const allocation = allocations.find(
        (candidate) => candidate.asset === asset,
      );
      if (
        !asset ||
        !allocation ||
        seen.has(asset) ||
        !Number.isInteger(changeBps) ||
        changeBps < -10_000 ||
        changeBps > 10_000
      ) {
        valid = false;
        break;
      }
      seen.add(asset);
      normalizedChanges.push({
        asset,
        change_bps: changeBps,
        provenance: provenance(
          EDUCATIONAL_PROVENANCE.USER_SUPPLIED,
        ),
      });
      weightedNumerator +=
        BigInt(allocation.weight_bps) * BigInt(changeBps);
    }
    if (!valid || seen.size !== selectedAssets.size) {
      issues.push(
        issue(
          "SCENARIO_CHANGE_INVALID",
          `${name} contains a missing, duplicate, unsupported, or out-of-range change.`,
          "Supply one change from -10000 to 10000 basis points for each selected asset.",
        ),
      );
      continue;
    }
    normalized.push({
      name,
      assumptions: normalizedChanges,
      calculated: {
        weighted_change_bps: signedRatio(
          weightedNumerator,
          10_000n,
        ),
        weighted_change_percent: signedRatio(
          weightedNumerator,
          1_000_000n,
        ),
        method:
          "Mechanical weighted change using user-supplied weights and scenario assumptions; not a forecast.",
        provenance: provenance(
          EDUCATIONAL_PROVENANCE.CALCULATED_LOCALLY,
        ),
      },
    });
  }
  return { issues, normalized };
}

function planDecision(outcome, issues) {
  if (outcome === "BLOCK") {
    return decision(
      "BLOCK",
      "ALLOCATION_INPUT_INVALID",
      "The allocation or scenario input is invalid.",
      "Edit the listed input. Nothing is authorized or submitted.",
    );
  }
  if (outcome === "REVIEW") {
    return decision(
      "REVIEW",
      "PLANNING_DATA_UNVERIFIABLE",
      "The selected assets do not have complete, current, matching planning data.",
      "Refresh the exact missing data. No fixture or substitute will be used.",
    );
  }
  return decision(
    "PLAN_VALID_FOR_EDITING",
    "EDUCATIONAL_PLAN_VALID_FOR_EDITING",
    "The user-supplied allocation was calculated without selecting or recommending an asset.",
    "Review or edit the plan. No trade is authorized; a selected leg still requires a fresh protected mandate and separate authorization.",
  );
}

function buildPortfolioPlan({
  session_id,
  plan_id,
  created_at,
  edited_at,
  revision,
  snapshot,
  planning_amount,
  allocations,
  scenarios,
  scenario_acknowledged,
}) {
  const inputIssues = [];
  const dataIssues = [];
  const sessionId = cleanIdentifier(session_id);
  const planId = cleanIdentifier(plan_id);
  const createdAt = isoTimestamp(created_at);
  const editedAt = isoTimestamp(edited_at ?? created_at);
  if (!sessionId || !planId) {
    inputIssues.push(
      issue(
        "PLAN_IDENTITY_INVALID",
        "Session-local plan identifiers are missing or malformed.",
        "Create a new local planning session.",
      ),
    );
  }
  if (!createdAt || !editedAt || !Number.isInteger(revision) || revision < 1) {
    dataIssues.push(
      issue(
        "PLAN_CLOCK_INVALID",
        "The plan revision or clock is missing or malformed.",
        "Retry with a current timestamp and positive revision.",
      ),
    );
  }

  const amountAsset = cleanAsset(planning_amount?.asset);
  const amountValue = isPositiveDecimal(planning_amount?.value)
    ? planning_amount.value
    : null;
  if (!amountAsset || !amountValue) {
    inputIssues.push(
      issue(
        "PLANNING_AMOUNT_INVALID",
        "A positive user-supplied planning amount and quote asset are required.",
        "Edit the planning amount.",
      ),
    );
  }

  const allocationResult = normalizeAllocations(allocations);
  inputIssues.push(...allocationResult.issues);
  if (scenario_acknowledged !== true) {
    inputIssues.push(
      issue(
        "SCENARIO_ACKNOWLEDGEMENT_REQUIRED",
        "The scenario assumptions were not explicitly acknowledged by the user.",
        "Review and confirm every scenario value, including any zero-value neutral assumption.",
      ),
    );
  }
  const scenarioResult =
    scenario_acknowledged === true
      ? normalizeScenarios(
          scenarios ?? [],
          allocationResult.normalized,
        )
      : {
          issues: [],
          normalized: [],
        };
  inputIssues.push(...scenarioResult.issues);

  if (
    snapshot?.schema_version !== SNAPSHOT_SCHEMA ||
    snapshot?.status !== "SNAPSHOT_AVAILABLE_FOR_EDUCATION"
  ) {
    dataIssues.push(
      ...(Array.isArray(snapshot?.issues) && snapshot.issues.length
        ? snapshot.issues
        : [
            issue(
              "SNAPSHOT_NOT_READY",
              "A current versioned educational snapshot is required.",
              "Refresh the selected facts without fixture fallback.",
            ),
          ]),
    );
  }
  if (
    editedAt &&
    snapshot?.expires_at &&
    Date.parse(editedAt) > Date.parse(snapshot.expires_at)
  ) {
    dataIssues.push(
      issue(
        "SNAPSHOT_STALE",
        "The educational snapshot expired before this plan revision.",
        "Refresh the exact selected products and primary sources.",
      ),
    );
  }

  const snapshotProducts = snapshot?.facts?.products ?? [];
  const snapshotEducation =
    snapshot?.facts?.educational_sources ?? [];
  for (const allocation of allocationResult.normalized) {
    const product = snapshotProducts.find(
      (candidate) =>
        candidate.product_id === allocation.product_id &&
        candidate.base_asset === allocation.asset &&
        candidate.quote_asset === amountAsset &&
        candidate.product_type === "SPOT" &&
        candidate.available === true,
    );
    if (!product) {
      dataIssues.push(
        issue(
          "SELECTED_PRODUCT_UNVERIFIABLE",
          `${allocation.product_id} is not a matching available spot product in the snapshot.`,
          "Refresh that exact pair; do not substitute a different pair.",
        ),
      );
    }
    if (
      !snapshotEducation.some(
        (source) => source.asset === allocation.asset,
      )
    ) {
      dataIssues.push(
        issue(
          "SELECTED_EDUCATION_MISSING",
          `${allocation.asset} lacks a primary-source educational summary.`,
          "Add a current primary source for that asset.",
        ),
      );
    }
  }

  const calculatedAllocations =
    amountValue && allocationResult.issues.length === 0
      ? allocationResult.normalized.map((allocation) => ({
          leg_id: `${planId}:r${revision}:${allocation.product_id}`,
          asset: allocation.asset,
          product_id: allocation.product_id,
          weight_bps: allocation.weight_bps,
          target_quote_amount: {
            asset: amountAsset,
            value: calculatedAllocation(
              amountValue,
              allocation.weight_bps,
            ),
          },
          provenance: provenance(
            EDUCATIONAL_PROVENANCE.CALCULATED_LOCALLY,
          ),
        }))
      : [];
  const weights = allocationResult.normalized.map(
    (allocation) => allocation.weight_bps,
  );
  const sumSquares = weights.reduce(
    (sum, weight) => sum + BigInt(weight) * BigInt(weight),
    0n,
  );
  const outcome =
    inputIssues.length > 0
      ? "BLOCK"
      : dataIssues.length > 0
        ? "REVIEW"
        : "PLAN_VALID_FOR_EDITING";
  const model = {
    schema_version: PLAN_SCHEMA,
    api_version: EDUCATIONAL_PLANNING_API.schema_version,
    lifecycle: "SESSION_ONLY",
    persistence: "NONE",
    session_id: sessionId,
    plan_id: planId,
    revision,
    created_at: createdAt,
    edited_at: editedAt,
    status: outcome,
    decision: planDecision(outcome, [
      ...inputIssues,
      ...dataIssues,
    ]),
    issues: [...inputIssues, ...dataIssues],
    snapshot_binding:
      snapshot?.schema_version === SNAPSHOT_SCHEMA
        ? {
            snapshot_id: snapshot.snapshot_id,
            snapshot_digest: digest(snapshot),
            evaluated_at: snapshot.evaluated_at,
            expires_at: snapshot.expires_at,
            eligible_as_guard_evidence: false,
          }
        : null,
    snapshot_source:
      snapshot?.schema_version === SNAPSHOT_SCHEMA
        ? snapshot
        : null,
    inputs: {
      planning_amount: {
        asset: amountAsset,
        value: amountValue,
        provenance: provenance(
          EDUCATIONAL_PROVENANCE.USER_SUPPLIED,
        ),
      },
      allocations: allocationResult.normalized,
      scenarios: scenarioResult.normalized.map((scenario) => ({
        name: scenario.name,
        changes: scenario.assumptions,
      })),
      scenario_acknowledged:
        scenario_acknowledged === true,
    },
    analysis: {
      allocations: calculatedAllocations,
      concentration: {
        largest_weight_bps: weights.length
          ? Math.max(...weights)
          : null,
        hhi_bps: weights.length
          ? signedRatio(sumSquares, 10_000n)
          : null,
        method:
          "Largest user-supplied weight and Herfindahl concentration, shown neutrally without an asset ranking.",
        provenance: provenance(
          EDUCATIONAL_PROVENANCE.CALCULATED_LOCALLY,
        ),
      },
      scenarios: scenarioResult.normalized,
    },
    handoff: null,
    invalidated_handoffs: [],
    education_boundary: {
      statement:
        "Educational planning only. This does not recommend an asset, assess suitability, or authorize a trade. No trade is authorized.",
      not_financial_advice: true,
      editable: true,
      trade_authorized: false,
    },
    guard_boundary: guardBoundary(),
    capability_boundary: capabilityBoundary(),
    fallback: {
      used: false,
      fixture_used:
        snapshot?.source_selection?.used === "fixture",
      substitution_used: false,
    },
  };
  return sealPlan(model);
}

export function createEducationalPortfolioPlan(input = {}) {
  return buildPortfolioPlan({
    ...input,
    revision: 1,
    edited_at: input.created_at,
  });
}

function rawAllocations(plan) {
  return (plan?.inputs?.allocations ?? []).map((allocation) => ({
    asset: allocation.asset,
    product_id: allocation.product_id,
    weight_bps: allocation.weight_bps,
  }));
}

function rawScenarios(plan) {
  return (plan?.inputs?.scenarios ?? []).map((scenario) => ({
    name: scenario.name,
    changes: (scenario.changes ?? []).map((change) => ({
      asset: change.asset,
      change_bps: change.change_bps,
    })),
  }));
}

export function editEducationalPortfolioPlan(
  current,
  {
    edited_at,
    snapshot = current?.snapshot_source,
    planning_amount,
    allocations,
    scenarios,
    scenario_acknowledged,
  } = {},
) {
  if (
    current?.schema_version !== PLAN_SCHEMA ||
    !Number.isInteger(current?.revision) ||
    !planIntegrityVerified(current)
  ) {
    throw new Error(
      "A current, integrity-bound educational portfolio plan is required",
    );
  }
  const sourceSnapshot =
    snapshot?.schema_version === SNAPSHOT_SCHEMA
      ? snapshot
      : current.snapshot_source;
  if (!sourceSnapshot) {
    throw new Error(
      "The current educational snapshot must be supplied for an edit",
    );
  }
  const next = buildPortfolioPlan({
    session_id: current.session_id,
    plan_id: current.plan_id,
    created_at: current.created_at,
    edited_at,
    revision: current.revision + 1,
    snapshot: sourceSnapshot,
    planning_amount:
      planning_amount ?? {
        asset: current.inputs?.planning_amount?.asset,
        value: current.inputs?.planning_amount?.value,
      },
    allocations: allocations ?? rawAllocations(current),
    scenarios: scenarios ?? rawScenarios(current),
    scenario_acknowledged,
  });
  const invalidated = current.handoff
    ? [
        ...(current.invalidated_handoffs ?? []),
        {
          draft_id: current.handoff.draft_id,
          plan_revision: current.revision,
          invalidated_at: isoTimestamp(edited_at),
          reason:
            "The educational plan changed. This prior one-leg draft cannot be reused.",
        },
      ]
    : [...(current.invalidated_handoffs ?? [])];
  const { model_integrity: _nextIntegrity, ...nextModel } = next;
  return sealPlan({
    ...nextModel,
    invalidated_handoffs: invalidated,
  });
}

function handoffResult(outcome, code, reason, recovery, plan, draft) {
  return deepFreeze({
    schema_version: HANDOFF_SCHEMA,
    decision: decision(outcome, code, reason, recovery),
    plan,
    draft,
  });
}

function planSnapshotExpired(plan, at) {
  const timestamp = isoTimestamp(at);
  if (!timestamp || !plan?.snapshot_binding?.expires_at) return true;
  return (
    Date.parse(timestamp) >=
    Date.parse(plan.snapshot_binding.expires_at)
  );
}

export function selectSingleTradeMandateDraft(
  plan,
  { draft_id, selected_at, selected_legs } = {},
) {
  if (plan?.schema_version !== PLAN_SCHEMA) {
    return handoffResult(
      "REVIEW",
      "PLAN_VERSION_UNVERIFIABLE",
      "The educational plan version cannot be verified.",
      "Create a fresh session-local educational plan.",
      plan ?? null,
      null,
    );
  }
  if (!planIntegrityVerified(plan)) {
    return handoffResult(
      "REVIEW",
      "PLAN_INTEGRITY_UNVERIFIABLE",
      "The educational plan integrity cannot be verified.",
      "Create a fresh session-local educational plan.",
      plan,
      null,
    );
  }
  if (
    plan.decision?.outcome !==
    "PLAN_VALID_FOR_EDITING"
  ) {
    const outcome =
      plan.decision?.outcome === "BLOCK" ? "BLOCK" : "REVIEW";
    return handoffResult(
      outcome,
      "PLAN_NOT_READY",
      "The educational plan is not ready for a one-leg draft.",
      "Resolve the plan issues first.",
      plan,
      null,
    );
  }
  if (!Array.isArray(selected_legs) || selected_legs.length !== 1) {
    return handoffResult(
      "BLOCK",
      "SINGLE_LEG_REQUIRED",
      "Exactly one user-selected allocation leg is required.",
      "Select one asset. Batch, rebalance, and multi-leg authorization are unavailable.",
      plan,
      null,
    );
  }
  if (plan.handoff) {
    return handoffResult(
      "BLOCK",
      "HANDOFF_ALREADY_CREATED",
      "This plan revision already has a one-leg draft.",
      "Edit the plan to create a new revision before selecting another leg.",
      plan,
      null,
    );
  }
  if (planSnapshotExpired(plan, selected_at)) {
    return handoffResult(
      "REVIEW",
      "PLANNING_SNAPSHOT_STALE",
      "The planning snapshot is stale or the selection clock is invalid.",
      "Refresh the exact product and educational source before creating a new draft.",
      plan,
      null,
    );
  }
  const draftId = cleanIdentifier(draft_id);
  const selectedAt = isoTimestamp(selected_at);
  const selected = selected_legs[0];
  const legId = cleanIdentifier(selected?.leg_id);
  const asset = cleanAsset(selected?.asset);
  const productId = cleanProduct(selected?.product_id);
  const side = selected?.side;
  if (
    !draftId ||
    !selectedAt ||
    !legId ||
    !["BUY", "SELL"].includes(side)
  ) {
    return handoffResult(
      "BLOCK",
      "HANDOFF_SELECTION_INVALID",
      "The one-leg draft requires a local identifier, current timestamp, and an explicit BUY or SELL selection.",
      "Select exactly one current allocation leg and one side. Neither is inferred from allocation weights.",
      plan,
      null,
    );
  }
  const allocation = plan.analysis?.allocations?.find(
    (candidate) =>
      candidate.leg_id === legId &&
      candidate.asset === asset &&
      candidate.product_id === productId,
  );
  if (!allocation) {
    return handoffResult(
      "BLOCK",
      "HANDOFF_LEG_NOT_IN_PLAN",
      "The selected leg is not an exact allocation in this plan revision.",
      "Select one unchanged allocation leg.",
      plan,
      null,
    );
  }
  const snapshotProduct = plan.snapshot_source?.facts?.products?.find(
    (candidate) =>
      candidate.product_id === allocation.product_id &&
      candidate.base_asset === allocation.asset &&
      candidate.quote_asset ===
        allocation.target_quote_amount.asset,
  );
  const quoteAmount = allocation.target_quote_amount;
  const sellReference = snapshotProduct?.best_bid;
  const sellBaseSize =
    side === "SELL" &&
    isPositiveDecimal(sellReference?.value)
      ? trimDecimal(
          divideDecimals(
            quoteAmount.value,
            sellReference.value,
            { scale: 18 },
          ),
        )
      : null;
  if (side === "SELL" && !isPositiveDecimal(sellBaseSize)) {
    return handoffResult(
      "REVIEW",
      "SELL_SIZE_UNVERIFIABLE",
      "The educational snapshot cannot support a mechanical base-size estimate for this SELL draft.",
      "Refresh the exact product best bid, then review or edit the resulting base size before separate authorization.",
      plan,
      null,
    );
  }
  const size =
    side === "BUY"
      ? {
          operator: "MAX",
          denomination: "QUOTE",
          asset: quoteAmount.asset,
          value: quoteAmount.value,
          provenance: provenance(
            EDUCATIONAL_PROVENANCE.CALCULATED_LOCALLY,
          ),
        }
      : {
          operator: "MAX",
          denomination: "BASE",
          asset: allocation.asset,
          value: sellBaseSize,
          provenance: provenance(
            EDUCATIONAL_PROVENANCE.CALCULATED_LOCALLY,
            {
              method:
                "Hypothetical quote allocation divided by the educational snapshot best bid. Editable; not a holding or Guard fact.",
            },
          ),
        };

  const draftCore = {
    schema_version: DRAFT_SCHEMA,
    artifact_class: "EDITABLE_UNAUTHORIZED_DRAFT",
    draft_id: draftId,
    created_at: selectedAt,
    source_plan_binding: {
      plan_id: plan.plan_id,
      plan_revision: plan.revision,
      snapshot_digest: plan.snapshot_binding.snapshot_digest,
      leg_id: allocation.leg_id,
    },
    candidate_action: {
      action_type: "COINBASE_SPOT_TRADE",
      side,
      product_id: allocation.product_id,
      size,
      planning_quote_amount: {
        asset: quoteAmount.asset,
        value: quoteAmount.value,
        provenance: provenance(
          EDUCATIONAL_PROVENANCE.CALCULATED_LOCALLY,
        ),
      },
      educational_price_reference:
        side === "SELL"
          ? {
              reference: "BEST_BID",
              value: sellReference.value,
              asset: quoteAmount.asset,
              observed_at: sellReference.observed_at,
              provenance: provenance(
                EDUCATIONAL_PROVENANCE.CALCULATED_LOCALLY,
                {
                  source_label:
                    snapshotProduct.provenance?.label ?? null,
                  note:
                    "Used only to calculate an editable hypothetical SELL size; not Guard evidence.",
                },
              ),
            }
          : null,
      selection_provenance: provenance(
        EDUCATIONAL_PROVENANCE.USER_SUPPLIED,
        {
          note: "The user selected this one allocation leg and side.",
        },
      ),
    },
    required_before_authorization: [
      "Review or edit the exact size",
      "Choose a market condition or explicitly choose no market trigger",
      "Set maximum slippage and commission",
      "Set a settlement bound",
      "Set an expiry",
      "Authorize the complete mandate separately",
    ],
    authorization: {
      state: "NOT_AUTHORIZED",
      separate_human_authorization_required: true,
      delta_decision: null,
      execution_eligible: false,
    },
    required_fresh_guard_evidence: [
      "Coinbase held balance",
      "Coinbase product availability",
      "Coinbase best bid and ask",
      "Coinbase Preview bound to the exact proposal",
      "Fresh Delta decision receipt bound to the authorized mandate and exact proposal",
    ],
    planning_context: {
      eligible_as_guard_evidence: false,
      research_used_as_guard_evidence: false,
    },
    boundary: {
      editable: true,
      batch: false,
      rebalance: false,
      multi_leg: false,
      automatic_purchase: false,
      order_submission: false,
      money_movement: false,
    },
  };
  const draft = deepFreeze({
    ...draftCore,
    draft_digest: digest(draftCore),
  });
  const { model_integrity: _planIntegrity, ...planModel } = plan;
  const nextPlan = sealPlan({
    ...planModel,
    handoff: {
      draft_id: draft.draft_id,
      draft_digest: draft.draft_digest,
      plan_revision: plan.revision,
      status: "DRAFT_REQUIRES_SEPARATE_AUTHORIZATION",
    },
  });
  return handoffResult(
    "DRAFT_CREATED_NOT_AUTHORIZED",
    "ONE_LEG_DRAFT_CREATED",
    `One editable ${side} trade-mandate draft was created from the user-selected leg and side.`,
    "Complete and separately authorize the mandate before any protected trade check.",
    nextPlan,
    draft,
  );
}

export function reviewSingleTradeMandateDraft(
  plan,
  draft,
  { reviewed_at } = {},
) {
  if (
    plan?.schema_version !== PLAN_SCHEMA ||
    draft?.schema_version !== DRAFT_SCHEMA
  ) {
    return handoffResult(
      "REVIEW",
      "DRAFT_VERSION_UNVERIFIABLE",
      "The plan or draft version cannot be verified.",
      "Create a fresh one-leg draft.",
      plan ?? null,
      null,
    );
  }
  if (!planIntegrityVerified(plan)) {
    return handoffResult(
      "REVIEW",
      "PLAN_INTEGRITY_UNVERIFIABLE",
      "The educational plan integrity cannot be verified.",
      "Create a fresh session-local educational plan.",
      plan,
      null,
    );
  }
  if (
    draft.source_plan_binding?.plan_id !== plan.plan_id ||
    draft.source_plan_binding?.plan_revision !== plan.revision
  ) {
    return handoffResult(
      "REVIEW",
      "STALE_PLAN_REVISION",
      "The draft is bound to an earlier educational plan revision.",
      "Select one leg from the current revision and create a fresh draft.",
      plan,
      null,
    );
  }
  if (
    plan.handoff?.draft_id !== draft.draft_id ||
    plan.handoff?.draft_digest !== draft.draft_digest
  ) {
    return handoffResult(
      "REVIEW",
      "DRAFT_HANDOFF_INVALIDATED",
      "The draft is no longer the active handoff for this plan revision.",
      "Create a fresh one-leg draft.",
      plan,
      null,
    );
  }
  const { draft_digest: suppliedDigest, ...draftCore } = draft;
  if (
    digest(draftCore) !== suppliedDigest ||
    planSnapshotExpired(plan, reviewed_at)
  ) {
    return handoffResult(
      "REVIEW",
      "DRAFT_OR_DATA_UNVERIFIABLE",
      "The draft integrity or planning-data freshness cannot be verified.",
      "Refresh the plan and create a fresh one-leg draft.",
      plan,
      null,
    );
  }
  return handoffResult(
    "DRAFT_CURRENT_NOT_AUTHORIZED",
    "CURRENT_UNAUTHORIZED_DRAFT",
    "The one-leg draft matches the current plan revision and remains unauthorized.",
    "Edit its material constraints, then request separate human authorization.",
    plan,
    draft,
  );
}
