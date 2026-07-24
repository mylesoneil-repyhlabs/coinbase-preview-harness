import { digest, digestBytes } from "./evidence.js";
import { markExecutionPlan } from "./authorization-store.js";
import { reconcileSubmittedOrder } from "./reconciliation.js";
import { sanitize } from "./sanitize.js";

const MAX_ORDER_PAGES = 25;
const RECOVERABLE_STATUSES = new Set([
  "SUBMITTING",
  "SUBMISSION_UNCERTAIN",
  "SUBMITTED",
  "RECONCILIATION_PENDING",
  "RECONCILIATION_FAILED",
  "ORDER_PENDING",
  "FILLED",
  "PARTIAL_FILL",
  "NO_FILL",
  "EXECUTION_POLICY_BREACH",
]);

function finalRecord(record) {
  const safe = sanitize(record);
  return { ...safe, record_digest: digest(safe) };
}

function validStoredExecution(stored, planId, attestation) {
  return (
    Boolean(stored) &&
    typeof stored === "object" &&
    Boolean(stored.policy) &&
    typeof stored.policy === "object" &&
    Boolean(stored.create_payload) &&
    typeof stored.create_payload === "object" &&
    typeof stored.create_payload_serialized === "string" &&
    stored?.plan_id === planId &&
    stored?.policy_digest === digest(stored.policy) &&
    stored?.create_payload_serialized === JSON.stringify(stored.create_payload) &&
    stored?.create_payload_digest ===
      digestBytes(stored.create_payload_serialized) &&
    stored?.create_payload?.client_order_id === stored.client_order_id &&
    stored?.portfolio_fingerprint === attestation?.portfolio_fingerprint &&
    stored?.credential_fingerprint === attestation?.key_fingerprint &&
    typeof stored?.market?.observed_at === "string"
  );
}

function recoveryRecord(stored, now) {
  return {
    schema_version: "delta.coinbase.execution_recovery_record.v1",
    artifact_class: "LIVE",
    generated_at: now.toISOString(),
    status: "SUBMISSION_UNCERTAIN",
    source_intent_digest: null,
    policy: stored.policy,
    policy_digest: stored.policy_digest,
    safety_profile: null,
    confirmation: null,
    credential_binding: {
      portfolio_fingerprint: stored.portfolio_fingerprint,
      credential_fingerprint: stored.credential_fingerprint,
    },
    market: stored.market,
    proposal: null,
    proposal_check: null,
    preview: null,
    preview_check: null,
    delta: {
      decision_id: stored.decision_id,
    },
    reconciliation: null,
    execution: {
      adapter_invoked: true,
      order_submitted: null,
      order_id: stored.order_id ?? null,
      client_order_id: stored.client_order_id,
      create_payload_digest: stored.create_payload_digest,
      persistence_warnings: [],
    },
    recovery: {
      read_only: true,
      source_status: stored.status,
      lookup: stored.order_id ? "ORDER_ID" : "CLIENT_ORDER_ID_SCAN",
      pages_scanned: 0,
    },
    failure: null,
  };
}

async function findOrderId(stored, listOrdersAdapter, record) {
  if (stored.order_id) return stored.order_id;
  if (typeof listOrdersAdapter !== "function") {
    throw new Error("Coinbase List Orders adapter is required for recovery");
  }
  const consumedAt = Date.parse(stored.consumed_at);
  if (!Number.isFinite(consumedAt)) {
    throw new Error("Consumed execution record has an invalid timestamp");
  }
  const startDate = new Date(consumedAt - 5 * 60_000).toISOString();
  const endDate = new Date(consumedAt + 5 * 60_000).toISOString();
  let cursor;
  const seenCursors = new Set();
  for (let page = 0; page < MAX_ORDER_PAGES; page += 1) {
    const response = await listOrdersAdapter({
      productId: stored.create_payload.product_id,
      side: stored.create_payload.side,
      startDate,
      endDate,
      cursor,
    });
    record.recovery.pages_scanned += 1;
    if (!Array.isArray(response?.orders)) {
      throw new Error("Coinbase List Orders response omitted orders");
    }
    const matches = response.orders.filter(
      (order) => order?.client_order_id === stored.client_order_id,
    );
    if (matches.length > 1) {
      throw new Error("Coinbase returned multiple orders for one client_order_id");
    }
    if (matches.length === 1) {
      if (typeof matches[0].order_id !== "string" || !matches[0].order_id) {
        throw new Error("Recovered Coinbase order omitted order_id");
      }
      return matches[0].order_id;
    }
    if (response.has_next !== true) return null;
    if (
      typeof response.cursor !== "string" ||
      !response.cursor ||
      seenCursors.has(response.cursor)
    ) {
      throw new Error("Coinbase List Orders pagination could not advance");
    }
    seenCursors.add(response.cursor);
    cursor = response.cursor;
  }
  throw new Error(
    `Coinbase List Orders exceeded ${MAX_ORDER_PAGES} pages before recovery completed`,
  );
}

export async function recoverExecution({
  planId,
  stored,
  attestation,
  listOrdersAdapter,
  getOrderAdapter,
  listFillsAdapter,
  now = () => new Date(),
  markPlan = markExecutionPlan,
}) {
  if (!validStoredExecution(stored, planId, attestation)) {
    throw new Error(
      "Consumed execution state is corrupt or does not match this credential-scoped portfolio",
    );
  }
  if (!RECOVERABLE_STATUSES.has(stored.status)) {
    throw new Error(
      `Consumed plan status ${stored.status} has no unresolved Coinbase submission`,
    );
  }
  const record = recoveryRecord(stored, now());
  let orderId;
  try {
    orderId = await findOrderId(stored, listOrdersAdapter, record);
  } catch (error) {
    record.failure = {
      stage: "SUBMISSION_RECOVERY",
      message:
        "The original Coinbase submission could not be resolved. Do not submit a replacement order.",
      error: error instanceof Error ? error.message : String(error),
      client_order_id: stored.client_order_id,
    };
    return finalRecord(record);
  }
  if (!orderId) {
    record.failure = {
      stage: "SUBMISSION_RECOVERY",
      message:
        "No matching Coinbase order is visible yet. Submission remains uncertain; do not submit a replacement order.",
      client_order_id: stored.client_order_id,
    };
    return finalRecord(record);
  }

  record.execution.order_id = orderId;
  record.execution.order_submitted = true;
  let orderResponse;
  let fillsResponse;
  try {
    if (
      typeof getOrderAdapter !== "function" ||
      typeof listFillsAdapter !== "function"
    ) {
      throw new Error("Coinbase order and fill adapters are required");
    }
    [orderResponse, fillsResponse] = await Promise.all([
      getOrderAdapter(orderId),
      listFillsAdapter(orderId),
    ]);
    if (!Array.isArray(fillsResponse?.fills)) {
      throw new Error("Coinbase List Fills response omitted fills");
    }
  } catch (error) {
    record.status = "RECONCILIATION_PENDING";
    record.failure = {
      stage: "POST_SUBMISSION_RECONCILIATION",
      message:
        "The original order was found, but its complete order and fill evidence could not be read. Run reconciliation again; do not submit a replacement order.",
      order_id: orderId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (!record.failure) {
    try {
      record.reconciliation = reconcileSubmittedOrder({
        orderResponse,
        fillsResponse,
        createPayload: stored.create_payload,
        expectedOrderId: orderId,
        policy: stored.policy,
        market: stored.market,
        checkedAt: now(),
      });
      record.status = record.reconciliation.outcome;
      if (record.status === "EXECUTION_POLICY_BREACH") {
        record.failure = {
          stage: "POST_SUBMISSION_POLICY_CHECK",
          message:
            "The recovered order outcome exceeded at least one authorized constraint.",
          order_id: orderId,
          failures: record.reconciliation.checks.failures,
        };
      } else if (
        ["ORDER_PENDING", "RECONCILIATION_PENDING"].includes(record.status)
      ) {
        record.failure = {
          stage: "POST_SUBMISSION_RECONCILIATION",
          message:
            "The original order was found, but its terminal fill evidence is not complete yet. Run reconciliation again; do not submit a replacement order.",
          order_id: orderId,
        };
      }
    } catch (error) {
      record.status = "RECONCILIATION_FAILED";
      record.failure = {
        stage: "POST_SUBMISSION_RECONCILIATION",
        message:
          "The original order was found, but Coinbase returned data that does not bind coherently to the authorized payload.",
        order_id: orderId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  try {
    await markPlan(planId, {
      status: record.status,
      order_id: orderId,
      reconciliation: record.reconciliation,
      recovery_checked_at: now().toISOString(),
      error: record.failure?.message ?? null,
    });
  } catch (error) {
    record.execution.persistence_warnings.push(
      error instanceof Error ? error.message : String(error),
    );
  }
  return finalRecord(record);
}
