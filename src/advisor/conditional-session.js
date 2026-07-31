import { randomUUID } from "node:crypto";
import {
  authorizeConditionalSimulation,
  reviseConditionalPlan,
  revokeConditionalPlan,
  verifyConditionalSimulationReceipt,
} from "./conditional-plan.js";

const MAX_CONDITIONAL_PLANS_PER_SESSION = 12;
const MAX_CONDITIONAL_REVISIONS_PER_PLAN = 8;
const MAX_CONDITIONAL_REVISION_TOMBSTONES_PER_PLAN = 16;

export class ConditionalSessionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ConditionalSessionError";
    this.code = code;
  }
}

function requireStore(session) {
  if (!(session?.conditionalPlans instanceof Map)) {
    throw new ConditionalSessionError(
      "CONDITIONAL_SESSION_INVALID",
      "The conditional-plan session is unavailable.",
    );
  }
  return session.conditionalPlans;
}

function requireEntry(session, planId) {
  const entry = requireStore(session).get(planId);
  if (!entry) {
    throw new ConditionalSessionError(
      "CONDITIONAL_PLAN_NOT_FOUND",
      "This saved plan is not available in the current local session.",
    );
  }
  return entry;
}

function requireRevision(entry, revision) {
  const record = entry.revisions.get(revision);
  if (!record) {
    const tombstone =
      entry.revision_tombstones?.get(revision);
    if (tombstone) {
      throw new ConditionalSessionError(
        `CONDITIONAL_PLAN_${tombstone.terminal_state}`,
        `This saved-plan revision is ${tombstone.terminal_state.toLowerCase()}.`,
      );
    }
    throw new ConditionalSessionError(
      "CONDITIONAL_REVISION_NOT_FOUND",
      "This saved-plan revision is not available.",
    );
  }
  return record;
}

function terminalState(entry, record, currentTime) {
  if (record.state === "REVOKED") return "REVOKED";
  if (record.state === "EXPIRED") return "EXPIRED";
  if (
    currentTime.getTime() >=
    Date.parse(record.plan.template.expires_at)
  ) {
    record.state = "EXPIRED";
    record.inFlight?.controller.abort("EXPIRED");
    return "EXPIRED";
  }
  if (
    entry.current_revision !== record.plan.revision ||
    record.state === "SUPERSEDED"
  ) {
    return "SUPERSEDED";
  }
  return null;
}

function readNow(now) {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new ConditionalSessionError(
      "CONDITIONAL_CLOCK_INVALID",
      "The local conditional-plan clock is invalid.",
    );
  }
  return value;
}

function newRevisionRecord(plan) {
  return {
    plan,
    state: plan.state,
    authorization: null,
    authorization_consumed: false,
    result: null,
    inFlight: null,
    cancellation: null,
  };
}

function revisionTombstone(record) {
  const terminalState = [
    "EXPIRED",
    "REVOKED",
    "SUPERSEDED",
  ].includes(record.state)
    ? record.state
    : "SUPERSEDED";
  return Object.freeze({
    schema_version:
      "delta.coinbase.conditional_revision_tombstone.v1",
    revision: record.plan.revision,
    terminal_state: terminalState,
    retired_at: record.plan.updated_at,
  });
}

function compactConditionalRevisions(entry) {
  while (
    entry.revisions.size >
    MAX_CONDITIONAL_REVISIONS_PER_PLAN
  ) {
    const retiredRevision = [...entry.revisions.keys()]
      .sort((left, right) => left - right)
      .find(
        (revision) =>
          revision !== entry.current_revision,
      );
    if (retiredRevision === undefined) break;
    const record = entry.revisions.get(retiredRevision);
    if (!record) break;
    record.inFlight?.controller.abort(
      "REVISION_RETENTION_LIMIT",
    );
    entry.revision_tombstones.set(
      retiredRevision,
      revisionTombstone(record),
    );
    entry.revisions.delete(retiredRevision);
  }
  while (
    entry.revision_tombstones.size >
    MAX_CONDITIONAL_REVISION_TOMBSTONES_PER_PLAN
  ) {
    const oldestRevision = [
      ...entry.revision_tombstones.keys(),
    ].sort((left, right) => left - right)[0];
    if (oldestRevision === undefined) break;
    entry.revision_tombstones.delete(oldestRevision);
  }
}

function safeRecordView(entry, record) {
  return Object.freeze({
    plan: record.plan,
    session_state: record.state,
    current_revision: entry.current_revision,
    authorization:
      record.authorization == null
        ? null
        : Object.freeze({
            schema_version:
              record.authorization.schema_version,
            authorization_id:
              record.authorization.authorization_id,
            plan_id: record.authorization.plan_id,
            plan_revision:
              record.authorization.plan_revision,
            source: record.authorization.source,
            authorized_at:
              record.authorization.authorized_at,
            expires_at: record.authorization.expires_at,
            max_uses: record.authorization.max_uses,
            mode: record.authorization.mode,
            consumed: record.authorization_consumed,
            boundary: record.authorization.boundary,
          }),
    result: record.result,
    cancellation: record.cancellation,
  });
}

export function rememberConditionalPlan(session, plan) {
  const store = requireStore(session);
  if (store.has(plan.plan_id)) {
    throw new ConditionalSessionError(
      "CONDITIONAL_PLAN_ALREADY_EXISTS",
      "This saved plan already exists in the current local session.",
    );
  }
  while (store.size >= MAX_CONDITIONAL_PLANS_PER_SESSION) {
    const oldestPlanId = store.keys().next().value;
    if (oldestPlanId === undefined) break;
    const oldest = store.get(oldestPlanId);
    for (const record of oldest?.revisions?.values?.() ?? []) {
      record.inFlight?.controller.abort("CAPACITY");
    }
    store.delete(oldestPlanId);
  }
  const entry = {
    plan_id: plan.plan_id,
    current_revision: plan.revision,
    revisions: new Map([
      [plan.revision, newRevisionRecord(plan)],
    ]),
    revision_tombstones: new Map(),
  };
  store.set(plan.plan_id, entry);
  return safeRecordView(entry, entry.revisions.get(plan.revision));
}

export function conditionalPlanView(
  session,
  planId,
  revision = null,
) {
  const entry = requireEntry(session, planId);
  const selectedRevision =
    revision ?? entry.current_revision;
  return safeRecordView(
    entry,
    requireRevision(entry, selectedRevision),
  );
}

export function reviseConditionalSessionPlan(
  session,
  {
    planId,
    revision,
    patch,
    now = () => new Date(),
  },
) {
  const entry = requireEntry(session, planId);
  const record = requireRevision(entry, revision);
  const currentTime = readNow(now);
  const terminal = terminalState(entry, record, currentTime);
  if (terminal) {
    throw new ConditionalSessionError(
      `CONDITIONAL_PLAN_${terminal}`,
      `This saved-plan revision is ${terminal.toLowerCase()}.`,
    );
  }
  if (entry.current_revision !== revision) {
    throw new ConditionalSessionError(
      "CONDITIONAL_PLAN_SUPERSEDED",
      "Edit the current saved-plan revision instead.",
    );
  }
  record.inFlight?.controller.abort("SUPERSEDED");
  const { superseded, revision: nextPlan } =
    reviseConditionalPlan(record.plan, patch, {
      now: () => currentTime,
    });
  record.plan = superseded;
  record.state = "SUPERSEDED";
  record.authorization = null;
  record.authorization_consumed = true;
  record.inFlight = null;
  record.cancellation = null;
  const nextRecord = newRevisionRecord(nextPlan);
  entry.revisions.set(nextPlan.revision, nextRecord);
  entry.current_revision = nextPlan.revision;
  compactConditionalRevisions(entry);
  return Object.freeze({
    superseded: safeRecordView(entry, record),
    current: safeRecordView(entry, nextRecord),
  });
}

export function revokeConditionalSessionPlan(
  session,
  {
    planId,
    revision,
    now = () => new Date(),
  },
) {
  const entry = requireEntry(session, planId);
  const record = requireRevision(entry, revision);
  record.inFlight?.controller.abort("REVOKED");
  record.plan = revokeConditionalPlan(record.plan, { now });
  record.state = "REVOKED";
  record.authorization = null;
  record.authorization_consumed = true;
  record.inFlight = null;
  record.result = null;
  record.cancellation = null;
  return safeRecordView(entry, record);
}

export function authorizeConditionalSessionPlan(
  session,
  {
    planId,
    revision,
    source,
    ttlSeconds,
    now = () => new Date(),
    authorizationId = randomUUID(),
  },
) {
  const entry = requireEntry(session, planId);
  const record = requireRevision(entry, revision);
  const currentTime = readNow(now);
  const terminal = terminalState(entry, record, currentTime);
  if (terminal) {
    throw new ConditionalSessionError(
      `CONDITIONAL_PLAN_${terminal}`,
      `This saved-plan revision is ${terminal.toLowerCase()}.`,
    );
  }
  if (
    entry.current_revision !== revision ||
    ![
      "READY_FOR_SIM_AUTH",
      "CONDITION_NOT_MET",
      "WOULD_TRIGGER_SIMULATION",
      "BLOCKED",
      "REVIEW",
    ].includes(record.state)
  ) {
    throw new ConditionalSessionError(
      "CONDITIONAL_PLAN_NOT_AUTHORIZABLE",
      "Create or edit the current saved-plan revision before authorizing one simulation check.",
    );
  }
  const authorization = authorizeConditionalSimulation(
    record.plan,
    {
      source,
      ttlSeconds,
      now: () => currentTime,
      authorizationId,
      currentRevision: entry.current_revision,
    },
  );
  record.authorization = authorization;
  record.authorization_consumed = false;
  record.result = null;
  record.cancellation = null;
  record.state = "AUTHORIZED_FOR_SIMULATION";
  return safeRecordView(entry, record);
}

export function beginConditionalSessionAttempt(
  session,
  {
    planId,
    revision,
    authorizationId,
    now = () => new Date(),
    attemptId = randomUUID(),
  },
) {
  const entry = requireEntry(session, planId);
  const record = requireRevision(entry, revision);
  const currentTime = readNow(now);
  const terminal = terminalState(entry, record, currentTime);
  if (terminal) {
    throw new ConditionalSessionError(
      `CONDITIONAL_PLAN_${terminal}`,
      `This saved-plan revision is ${terminal.toLowerCase()}. No second check ran.`,
    );
  }
  if (
    record.authorization == null ||
    record.authorization.authorization_id !==
      authorizationId
  ) {
    throw new ConditionalSessionError(
      "CONDITIONAL_AUTHORIZATION_MISMATCH",
      "Authorize the current saved-plan revision for one fresh check.",
    );
  }
  if (
    record.authorization_consumed ||
    record.state !== "AUTHORIZED_FOR_SIMULATION"
  ) {
    throw new ConditionalSessionError(
      "CONDITIONAL_AUTHORIZATION_CONSUMED",
      "That one-check authorization was already used. Authorize a fresh check; no second result was produced.",
    );
  }
  if (
    currentTime.getTime() >=
    Date.parse(record.authorization.expires_at)
  ) {
    record.authorization_consumed = true;
    record.state = "REVIEW";
    throw new ConditionalSessionError(
      "CONDITIONAL_AUTHORIZATION_EXPIRED",
      "The one-check simulation authorization expired. Authorize a fresh check.",
    );
  }

  // This transition is intentionally synchronous and occurs before any
  // evidence read. Concurrent requests cannot both observe an unused grant.
  const controller = new AbortController();
  record.authorization_consumed = true;
  record.state = "CHECKING";
  record.inFlight = {
    attempt_id: attemptId,
    controller,
    started_at: currentTime.toISOString(),
  };
  return Object.freeze({
    attempt_id: attemptId,
    plan: record.plan,
    authorization: record.authorization,
    signal: controller.signal,
  });
}

export function finishConditionalSessionAttempt(
  session,
  {
    planId,
    revision,
    attemptId,
    result,
    now = () => new Date(),
  },
) {
  const entry = requireEntry(session, planId);
  const record = requireRevision(entry, revision);
  const currentTime = readNow(now);
  const terminal = terminalState(entry, record, currentTime);
  if (terminal) {
    throw new ConditionalSessionError(
      `CONDITIONAL_PLAN_${terminal}`,
      `The saved-plan revision became ${terminal.toLowerCase()} before the check completed. Its late result was discarded.`,
    );
  }
  if (
    record.state !== "CHECKING" ||
    record.inFlight?.attempt_id !== attemptId ||
    record.inFlight.controller.signal.aborted
  ) {
    throw new ConditionalSessionError(
      "CONDITIONAL_ATTEMPT_CONFLICT",
      "The one-check simulation is no longer current. Its result was discarded.",
    );
  }
  if (
    currentTime.getTime() >=
    Date.parse(record.authorization.expires_at)
  ) {
    record.inFlight.controller.abort("AUTHORIZATION_EXPIRED");
    record.inFlight = null;
    record.state = "REVIEW";
    throw new ConditionalSessionError(
      "CONDITIONAL_AUTHORIZATION_EXPIRED",
      "The simulation authorization expired before the result completed. Its late result was discarded.",
    );
  }
  const expectedDecision = {
    CONDITION_NOT_MET: "CONDITION_NOT_MET",
    WOULD_TRIGGER_SIMULATION: "PASS",
    BLOCKED: "BLOCK",
    REVIEW: "REVIEW",
  }[result?.state];
  const verified =
    expectedDecision != null &&
    result?.plan_id === record.plan.plan_id &&
    result?.plan_revision === record.plan.revision &&
    result?.decision === expectedDecision &&
    result?.receipt?.verified === true &&
    result?.receipt?.decision === expectedDecision &&
    result?.receipt?.execution_state === "LOCKED" &&
    verifyConditionalSimulationReceipt(
      result.receipt,
      {
        plan: record.plan,
        authorization: record.authorization,
        evidence: result.evidence,
        proposal: result.proposal,
      },
    );
  if (!verified) {
    throw new ConditionalSessionError(
      "CONDITIONAL_RESULT_INVALID",
      "The simulation result or its exact receipt did not verify.",
    );
  }
  record.inFlight = null;
  record.state = result.state;
  record.result = result;
  record.cancellation = null;
  return safeRecordView(entry, record);
}

export function cancelConditionalSessionAttempt(
  session,
  {
    planId,
    revision,
    authorizationId,
    now = () => new Date(),
  },
) {
  const entry = requireEntry(session, planId);
  const record = requireRevision(entry, revision);
  const currentTime = readNow(now);
  const terminal = terminalState(entry, record, currentTime);
  if (terminal) {
    throw new ConditionalSessionError(
      `CONDITIONAL_PLAN_${terminal}`,
      `This saved-plan revision is ${terminal.toLowerCase()}.`,
    );
  }
  if (
    record.authorization == null ||
    record.authorization.authorization_id !==
      authorizationId
  ) {
    throw new ConditionalSessionError(
      "CONDITIONAL_AUTHORIZATION_MISMATCH",
      "The current one-check authorization does not match this cancellation request.",
    );
  }
  if (
    record.cancellation?.authorization_id ===
      authorizationId &&
    record.state === "REVIEW" &&
    record.inFlight == null
  ) {
    return Object.freeze({
      cancelled: true,
      already_cancelled: true,
      saved_plan: safeRecordView(entry, record),
    });
  }
  const authorizedButNotStarted =
    record.state === "AUTHORIZED_FOR_SIMULATION" &&
    record.authorization_consumed === false &&
    record.inFlight == null;
  const checking =
    record.state === "CHECKING" &&
    record.inFlight != null;
  if (!authorizedButNotStarted && !checking) {
    return Object.freeze({
      cancelled: false,
      already_cancelled: false,
      saved_plan: safeRecordView(entry, record),
    });
  }

  record.inFlight?.controller.abort("USER_CANCELLED");
  record.inFlight = null;
  record.authorization_consumed = true;
  record.state = "REVIEW";
  record.result = null;
  record.cancellation = Object.freeze({
    schema_version:
      "delta.coinbase.conditional_simulation_cancellation.v1",
    authorization_id: authorizationId,
    cancelled_at: currentTime.toISOString(),
    reason: "USER_CANCELLED",
    late_result_disposition: "DISCARD",
  });
  return Object.freeze({
    cancelled: true,
    already_cancelled: false,
    saved_plan: safeRecordView(entry, record),
  });
}

export function failConditionalSessionAttempt(
  session,
  {
    planId,
    revision,
    attemptId,
  },
) {
  const entry = requireEntry(session, planId);
  const record = requireRevision(entry, revision);
  if (
    record.state === "CHECKING" &&
    record.inFlight?.attempt_id === attemptId
  ) {
    record.inFlight.controller.abort("STOPPED_SAFE");
    record.inFlight = null;
    record.state = "REVIEW";
    record.result = null;
    record.cancellation = null;
  }
  return safeRecordView(entry, record);
}
