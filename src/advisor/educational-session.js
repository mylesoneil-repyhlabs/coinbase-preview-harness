import { randomUUID } from "node:crypto";
import {
  addDecimals,
  multiplyDecimals,
  subtractDecimals,
} from "../decimal.js";
import {
  createEducationalPortfolioPlan,
  editEducationalPortfolioPlan,
  selectSingleTradeMandateDraft,
} from "./educational-planning.js";

const MAX_EDUCATIONAL_PLANS_PER_SESSION = 8;

export class EducationalSessionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EducationalSessionError";
    this.code = code;
  }
}

function nowDate(now) {
  const value = now();
  if (
    !(value instanceof Date) ||
    !Number.isFinite(value.getTime())
  ) {
    throw new EducationalSessionError(
      "EDUCATIONAL_CLOCK_INVALID",
      "The local educational-planning clock is unavailable.",
    );
  }
  return value;
}

function requireStore(session) {
  if (!(session?.educationalPlans instanceof Map)) {
    throw new EducationalSessionError(
      "EDUCATIONAL_SESSION_INVALID",
      "The educational-planning session is unavailable.",
    );
  }
  return session.educationalPlans;
}

function currentRecord(session, planId, revision) {
  const entry = requireStore(session).get(planId);
  if (!entry) {
    throw new EducationalSessionError(
      "EDUCATIONAL_PLAN_NOT_FOUND",
      "This educational plan is not available in the current local session.",
    );
  }
  if (
    !Number.isInteger(revision) ||
    revision !== entry.current_revision
  ) {
    throw new EducationalSessionError(
      "EDUCATIONAL_PLAN_REVISION_STALE",
      "This educational plan has changed. Use the current revision.",
    );
  }
  const record = entry.revisions.get(revision);
  if (!record) {
    throw new EducationalSessionError(
      "EDUCATIONAL_PLAN_REVISION_STALE",
      "This educational plan revision is unavailable.",
    );
  }
  return { entry, record };
}

function planView(record) {
  const {
    model_integrity: _integrity,
    session_id: _sessionId,
    snapshot_source: snapshot,
    snapshot_binding: binding,
    handoff,
    ...plan
  } = record.plan;
  const safePlan = Object.freeze({
    ...plan,
    snapshot_binding: binding
      ? Object.freeze({
          snapshot_id: binding.snapshot_id,
          evaluated_at: binding.evaluated_at,
          expires_at: binding.expires_at,
          eligible_as_guard_evidence: false,
        })
      : null,
    market_snapshot: snapshot,
    handoff: handoff
      ? Object.freeze({
          draft_id: handoff.draft_id,
          plan_revision: handoff.plan_revision,
          status: handoff.status,
        })
      : null,
  });
  let safeDraft = null;
  if (record.draft) {
    const {
      draft_digest: _draftDigest,
      source_plan_binding: draftBinding,
      ...draft
    } = record.draft;
    safeDraft = Object.freeze({
      ...draft,
      source_plan_binding: Object.freeze({
        plan_id: draftBinding.plan_id,
        plan_revision: draftBinding.plan_revision,
        leg_id: draftBinding.leg_id,
      }),
    });
  }
  return Object.freeze({
    schema_version:
      "delta.coinbase.educational_session_plan_view.v1",
    session_state: record.state,
    plan: safePlan,
    draft: safeDraft,
    advisor_prefill: record.advisor_prefill,
    advisor_prefill_defaults:
      record.advisor_prefill_defaults,
    boundary: Object.freeze({
      educational_only: true,
      advice_off: true,
      trade_authorized: false,
      guard_evidence_created: false,
      order_submitted: false,
      money_moved: false,
    }),
  });
}

function draftAdvisorPrefill(draft) {
  const action = draft.candidate_action;
  const [baseAsset, quoteAsset] =
    action.product_id.split("-");
  const quoteAmount =
    action.planning_quote_amount.value;
  const fee = multiplyDecimals(quoteAmount, "0.01");
  const settlement =
    action.side === "BUY"
      ? addDecimals(quoteAmount, fee)
      : subtractDecimals(quoteAmount, fee);
  if (action.side === "SELL") {
    return [
      `Use up to ${action.size.value} ${action.size.asset} to sell ${baseAsset}`,
      `on ${action.product_id} once now with a price-bounded IOC limit order.`,
      "Partial fill is acceptable.",
      "Do not accept more than 35 bps below Coinbase's fresh best bid,",
      `more than ${fee} ${quoteAsset} in commission.`,
      `Receive at least ${settlement} ${quoteAsset} after commission.`,
      "This authorization expires 10 minutes after I confirm it.",
    ].join(" ");
  }
  return [
    `Use up to ${action.size.value} ${action.size.asset} to buy ${baseAsset}`,
    `on ${action.product_id} once now with a price-bounded IOC limit order.`,
    "Partial fill is acceptable.",
    "Do not pay more than 35 bps above Coinbase's fresh best ask,",
    `more than ${fee} ${quoteAsset} in commission,`,
    `or more than ${settlement} ${quoteAsset} total.`,
    "This authorization expires 10 minutes after I confirm it.",
  ].join(" ");
}

function draftGuardDefaults(draft) {
  const quoteAmount =
    draft.candidate_action.planning_quote_amount.value;
  const quoteAsset =
    draft.candidate_action.planning_quote_amount.asset;
  const maxFee = multiplyDecimals(quoteAmount, "0.01");
  const settlement =
    draft.candidate_action.side === "BUY"
      ? {
          kind: "MAX_TOTAL_DEBIT",
          value: addDecimals(quoteAmount, maxFee),
          asset: quoteAsset,
        }
      : {
          kind: "MIN_NET_PROCEEDS",
          value: subtractDecimals(quoteAmount, maxFee),
          asset: quoteAsset,
        };
  return Object.freeze({
    classification: "EDITABLE_GUARD_DEFAULTS",
    inherited_user_constraints: false,
    max_slippage_bps: 35,
    max_fee: Object.freeze({
      value: maxFee,
      asset: quoteAsset,
    }),
    settlement: Object.freeze(settlement),
    authorization_ttl_seconds: 600,
    explanation:
      "Slippage, fee, fill, settlement, and expiry values are editable Guard defaults for review. They were not supplied or authorized in the educational plan.",
  });
}

export function createEducationalSessionPlan(
  session,
  {
    snapshot,
    planning_amount,
    allocations,
    scenarios,
    scenario_acknowledged,
  },
  {
    now = () => new Date(),
    idFactory = randomUUID,
  } = {},
) {
  const plans = requireStore(session);
  const at = nowDate(now).toISOString();
  const planId = idFactory();
  const localSessionId = idFactory();
  const plan = createEducationalPortfolioPlan({
    session_id: localSessionId,
    plan_id: planId,
    created_at: at,
    snapshot,
    planning_amount,
    allocations,
    scenarios,
    scenario_acknowledged,
  });
  while (plans.size >= MAX_EDUCATIONAL_PLANS_PER_SESSION) {
    const oldest = plans.keys().next().value;
    if (oldest === undefined) break;
    plans.delete(oldest);
  }
  const record = {
    state: plan.status,
    plan,
    draft: null,
    advisor_prefill: null,
    advisor_prefill_defaults: null,
  };
  plans.set(planId, {
    plan_id: planId,
    current_revision: 1,
    revisions: new Map([[1, record]]),
  });
  return planView(record);
}

export function reviseEducationalSessionPlan(
  session,
  {
    planId,
    revision,
    planning_amount,
    allocations,
    scenarios,
    scenario_acknowledged,
    snapshot,
  },
  { now = () => new Date() } = {},
) {
  const { entry, record } = currentRecord(
    session,
    planId,
    revision,
  );
  const edited = editEducationalPortfolioPlan(record.plan, {
    edited_at: nowDate(now).toISOString(),
    planning_amount,
    allocations,
    scenarios,
    scenario_acknowledged,
    snapshot,
  });
  record.state = "SUPERSEDED";
  const next = {
    state: edited.status,
    plan: edited,
    draft: null,
    advisor_prefill: null,
    advisor_prefill_defaults: null,
  };
  entry.current_revision = edited.revision;
  entry.revisions.set(edited.revision, next);
  return Object.freeze({
    prior: planView(record),
    current: planView(next),
  });
}

export function createEducationalSessionHandoff(
  session,
  { planId, revision, legId, side },
  {
    now = () => new Date(),
    idFactory = randomUUID,
  } = {},
) {
  const { record } = currentRecord(
    session,
    planId,
    revision,
  );
  if (record.draft) {
    throw new EducationalSessionError(
      "EDUCATIONAL_HANDOFF_ALREADY_CREATED",
      "This plan revision already created its one editable trade draft.",
    );
  }
  const allocation = record.plan.analysis?.allocations?.find(
    (candidate) => candidate.leg_id === legId,
  );
  if (!allocation) {
    throw new EducationalSessionError(
      "EDUCATIONAL_LEG_NOT_FOUND",
      "Choose one current allocation leg.",
    );
  }

  const result = selectSingleTradeMandateDraft(record.plan, {
    draft_id: idFactory(),
    selected_at: nowDate(now).toISOString(),
    selected_legs: [
      {
        leg_id: allocation.leg_id,
        asset: allocation.asset,
        product_id: allocation.product_id,
        side,
      },
    ],
  });
  if (
    result.decision.outcome !==
    "DRAFT_CREATED_NOT_AUTHORIZED"
  ) {
    record.state = result.decision.outcome;
    record.plan = result.plan;
    return Object.freeze({
      saved_plan: planView(record),
      result,
    });
  }

  record.state = "DRAFT_CREATED_NOT_AUTHORIZED";
  record.plan = result.plan;
  record.draft = result.draft;
  record.advisor_prefill =
    draftAdvisorPrefill(result.draft);
  record.advisor_prefill_defaults =
    draftGuardDefaults(result.draft);
  return Object.freeze({
    saved_plan: planView(record),
    result,
  });
}

export function educationalSessionPlanView(
  session,
  { planId, revision },
) {
  return planView(
    currentRecord(session, planId, revision).record,
  );
}
