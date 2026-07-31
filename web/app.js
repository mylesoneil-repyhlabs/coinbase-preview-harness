const SAMPLE_INTENT =
  "Using my isolated Coinbase Advanced portfolio, use up to 3000 USDC to buy ETH on ETH-USDC once now with a price-bounded IOC limit order. Only if Coinbase's fresh best ask is at or below 3000 USDC. Partial fill is acceptable. Do not pay more than 35 bps above Coinbase's fresh best ask, more than 15 USDC in commission, or more than 3015 USDC total. This authorization expires 10 minutes after I confirm it.";

const state = {
  activeView: "advisor",
  currentPlan: null,
  currentResult: null,
  activityLoaded: false,
  pending: false,
  pendingRegion: null,
  pendingStatusNode: null,
  pendingAbortController: null,
  authorizeButtons: new Map(),
};

const actionControlState = new WeakMap();

const dom = {
  navTabs: [...document.querySelectorAll("[data-view-target]")],
  views: [...document.querySelectorAll("[data-view]")],
  quickStarts: [...document.querySelectorAll("[data-start]")],
  modeStatus: document.querySelector("#mode-status"),
  connectionStatus: document.querySelector("#connection-status"),
  orderStatus: document.querySelector("#order-status"),
  serviceStatus: document.querySelector("#service-status"),
  announcer: document.querySelector("#announcer"),
  conversation: document.querySelector("#conversation"),
  advisorForm: document.querySelector("#advisor-form"),
  intentInput: document.querySelector("#intent-input"),
  prepareButton: document.querySelector("#prepare-button"),
  showcaseButton: document.querySelector("#showcase-button"),
  plansShowcaseButton: document.querySelector("#plans-showcase-button"),
  reviewButton: document.querySelector("#review-button"),
  planDemoOutput: document.querySelector("#plan-demo-output"),
  activityList: document.querySelector("#activity-list"),
  refreshActivityButton: document.querySelector("#refresh-activity-button"),
  guardState: document.querySelector("#guard-state"),
  guardSteps: [...document.querySelectorAll("[data-guard-step]")],
  decisionSnapshot: document.querySelector("#decision-snapshot"),
  decisionSnapshotOutcome: document.querySelector(
    "#decision-snapshot-outcome",
  ),
  decisionSnapshotReason: document.querySelector("#decision-snapshot-reason"),
  longRunningStatus: document.querySelector("#long-running-status"),
};

function element(tagName, options = {}) {
  const node = document.createElement(tagName);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = String(options.text);
  if (options.attributes) {
    for (const [name, value] of Object.entries(options.attributes)) {
      if (value !== null && value !== undefined) {
        node.setAttribute(name, String(value));
      }
    }
  }
  if (
    state.pending &&
    tagName === "button" &&
    node.dataset.actionControl === "guard"
  ) {
    node.disabled = true;
    node.setAttribute("aria-disabled", "true");
    node.dataset.addedWhilePending = "true";
  }
  return node;
}

function announce(message) {
  dom.announcer.textContent = "";
  window.setTimeout(() => {
    dom.announcer.textContent = message;
  }, 20);
}

function useReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function reveal(node, { focus = false } = {}) {
  node.scrollIntoView({
    behavior: useReducedMotion() ? "auto" : "smooth",
    block: "nearest",
  });
  if (focus) {
    node.setAttribute("tabindex", "-1");
    node.focus({ preventScroll: true });
  }
}

function navigate(viewName, { focus = true } = {}) {
  const nextView = dom.views.find((view) => view.dataset.view === viewName);
  if (!nextView) return;

  state.activeView = viewName;
  for (const view of dom.views) {
    view.hidden = view !== nextView;
  }
  for (const tab of dom.navTabs) {
    const active = tab.dataset.viewTarget === viewName;
    tab.classList.toggle("is-active", active);
    if (active) {
      tab.setAttribute("aria-current", "page");
    } else {
      tab.removeAttribute("aria-current");
    }
  }

  if (focus) {
    const heading = nextView.querySelector("h1");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  }
  if (viewName === "activity" && !state.activityLoaded) {
    void loadActivity();
  }
}

function safeProviderMessage(payload, fallback) {
  const candidates = [
    payload?.error?.message,
    payload?.error,
    payload?.message,
  ];
  const message = candidates.find(
    (value) => typeof value === "string" && value.trim(),
  );
  if (!message) return fallback;
  const normalized = message.trim().slice(0, 260);
  if (
    /private[\s_-]?key|bearer\s+|jwt|organizations\/[^/\s]+\/apiKeys\//i.test(
      normalized,
    )
  ) {
    return fallback;
  }
  return normalized;
}

async function requestJson(path, { method = "GET", body } = {}) {
  const controller = new AbortController();
  if (state.pending) state.pendingAbortController = controller;
  const timeout = window.setTimeout(
    () => controller.abort("TIMEOUT"),
    20_000,
  );
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: {
        Accept: "application/json",
        ...(method === "POST" ? { "X-Delta-Advisor": "1" } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      if (controller.signal.reason === "USER_CANCELLED") {
        throw new Error(
          "You cancelled the local check. Nothing was submitted; you can try again.",
        );
      }
      throw new Error(
        "The local Guard did not answer in time. Nothing was submitted; try again.",
      );
    }
    throw new Error(
      "The local Guard is unavailable. Nothing was submitted; check the local service and try again.",
    );
  } finally {
    window.clearTimeout(timeout);
    if (state.pendingAbortController === controller) {
      state.pendingAbortController = null;
    }
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) {
      throw new Error(
        "The local Guard returned an unreadable error. Nothing was submitted.",
      );
    }
    throw new Error(
      "The local Guard returned an unreadable response. Nothing was submitted.",
    );
  }
  if (!response.ok) {
    throw new Error(
      safeProviderMessage(
        payload,
        "The local Guard could not complete this request. Nothing was submitted.",
      ),
    );
  }
  return payload;
}

function setActionControlsDisabled(disabled) {
  for (const control of document.querySelectorAll(
    '[data-action-control="guard"]',
  )) {
    if (disabled) {
      if (!actionControlState.has(control)) {
        actionControlState.set(control, control.disabled);
      }
      control.disabled = true;
      control.setAttribute("aria-disabled", "true");
      continue;
    }

    if (control.dataset.addedWhilePending === "true") {
      control.disabled = control.dataset.guardLocked === "true";
      control.removeAttribute("data-added-while-pending");
      if (!control.disabled) control.removeAttribute("aria-disabled");
      continue;
    }
    if (!actionControlState.has(control)) continue;
    const wasDisabled = actionControlState.get(control);
    control.disabled = wasDisabled;
    if (!wasDisabled) control.removeAttribute("aria-disabled");
    actionControlState.delete(control);
  }
  dom.intentInput.readOnly = disabled;
}

function showLongRunningStatus() {
  const region = state.pendingRegion;
  if (!region) return;
  if (region.contains(dom.longRunningStatus)) {
    dom.longRunningStatus.hidden = false;
    state.pendingStatusNode = dom.longRunningStatus;
    return;
  }

  const status = dom.longRunningStatus.cloneNode(true);
  status.removeAttribute("id");
  status.hidden = false;
  status.dataset.transientPendingStatus = "true";
  const heading = region.querySelector(".view-heading");
  if (heading) {
    heading.after(status);
  } else {
    region.prepend(status);
  }
  state.pendingStatusNode = status;
}

function hideLongRunningStatus() {
  if (state.pendingStatusNode === dom.longRunningStatus) {
    dom.longRunningStatus.hidden = true;
  } else {
    state.pendingStatusNode?.remove();
  }
  state.pendingStatusNode = null;
}

function setPending(pending, button, pendingLabel) {
  state.pending = pending;
  if (pending) {
    state.pendingRegion = dom.views.find(
      (view) => view.dataset.view === state.activeView && !view.hidden,
    );
  }
  state.pendingRegion?.setAttribute("aria-busy", String(pending));
  setActionControlsDisabled(pending);
  if (!button) {
    if (!pending) state.pendingRegion = null;
    return;
  }
  if (!button.dataset.idleLabel) {
    button.dataset.idleLabel = button.textContent.trim();
  }
  button.textContent = pending
    ? pendingLabel
    : button.dataset.idleLabel;
  if (!pending) state.pendingRegion = null;
}

async function runPending(button, pendingLabel, operation) {
  if (state.pending) return null;
  setPending(true, button, pendingLabel);
  const stillWorking = window.setTimeout(() => {
    if (state.pending) {
      announce("Still checking safely. No order can be sent.");
      if (button) button.textContent = "Still checking safely…";
      showLongRunningStatus();
    }
  }, 5_000);
  try {
    return await operation();
  } finally {
    window.clearTimeout(stillWorking);
    hideLongRunningStatus();
    setPending(false, button, pendingLabel);
  }
}

function addMessage(role, text, boundary = null) {
  const article = element("article", {
    className: `message message--${role}`,
  });
  const avatar = element("div", {
    className: "message__avatar",
    text: role === "user" ? "You" : "δ",
    attributes: { "aria-hidden": "true" },
  });
  const body = element("div", { className: "message__body" });
  body.append(
    element("p", {
      className: "message__speaker",
      text: role === "user" ? "You" : "Delta advisor",
    }),
    element("p", { text }),
  );
  if (boundary) {
    body.append(
      element("p", { className: "message__boundary", text: boundary }),
    );
  }
  article.append(avatar, body);
  dom.conversation.append(article);
  reveal(article);
  return article;
}

function addError(message, target = dom.conversation) {
  const error = element("section", {
    className: "error-card",
    attributes: { role: "alert" },
  });
  error.append(
    element("strong", { text: "Stopped safely" }),
    element("p", { text: message }),
  );
  target.append(error);
  reveal(error);
  announce(`Stopped safely. ${message}`);
  return error;
}

function setGuardStep(stepName) {
  const order = ["mandate", "proposal", "decision", "confirmation"];
  const currentIndex = order.indexOf(stepName);
  for (const step of dom.guardSteps) {
    const index = order.indexOf(step.dataset.guardStep);
    step.classList.toggle("is-complete", index < currentIndex);
    step.classList.toggle("is-current", index === currentIndex);
  }
  dom.guardState.textContent =
    {
      mandate: "Capturing",
      proposal: "Proposing",
      decision: "Checking",
      confirmation: "Locked",
    }[stepName] ?? "Ready";
}

function plainNumber(value) {
  if (value === null || value === undefined || value === "") return "—";
  const text = String(value);
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return text;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.min(
      8,
      text.includes(".") ? text.split(".")[1].length : 0,
    ),
  }).format(numeric);
}

function titleCase(value) {
  return String(value ?? "")
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ttlLabel(ttlSeconds) {
  const seconds = Number(ttlSeconds);
  if (!Number.isFinite(seconds)) return "One use";
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `One use · ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `One use · ${seconds} seconds`;
}

function conditionLabel(condition) {
  if (!condition) return "No absolute market trigger";
  const reference =
    condition.reference === "BEST_BID" ? "Best bid" : "Best ask";
  const operator =
    condition.operator === "AT_OR_ABOVE" ? "at or above" : "at or below";
  return `${reference} ${operator} ${plainNumber(condition.value)} ${condition.asset}`;
}

function settlementLabel(policy) {
  const settlement = policy?.limits?.settlement;
  if (!settlement) return "Settlement bound unavailable";
  const prefix =
    settlement.kind === "MIN_NET_QUOTE_PROCEEDS"
      ? "At least"
      : "No more than";
  return `${prefix} ${plainNumber(settlement.value)} ${settlement.asset}`;
}

function policyFromPlan(plan) {
  if (plan?.policy) return plan.policy;
  const mandate = plan?.mandate;
  if (!mandate) return {};
  return {
    product_id: mandate.product_id,
    base_asset: mandate.base_asset,
    quote_asset: mandate.quote_asset,
    side: mandate.side,
    size: mandate.size,
    market_condition: mandate.condition,
    order_type: mandate.order?.type,
    partial_fill_policy: mandate.order?.partial_fills,
    limits: mandate.limits,
    validity: {
      ttl_seconds: mandate.validity?.ttl_seconds,
    },
    usage: {
      max_executions: mandate.validity?.max_executions,
    },
  };
}

function mandateRows(plan) {
  const policy = policyFromPlan(plan);
  const size = policy.size ?? {};
  const amountPrefix = size.operator === "MAX" ? "Up to" : "Exactly";
  const partialFill =
    policy.partial_fill_policy === "ALLOW"
      ? "partial fills allowed"
      : "full fill required";
  const commission = policy.limits?.max_commission;
  return [
    [
      "Action",
      `${titleCase(policy.side)} ${amountPrefix.toLowerCase()} ${plainNumber(size.value)} ${size.asset} on ${policy.product_id ?? "exact pair"}`,
    ],
    ["Condition", conditionLabel(policy.market_condition)],
    [
      "Execution",
      `Price-bounded immediate-or-cancel · ${partialFill} · ≤${plainNumber(policy.limits?.max_slippage_bps)} bps`,
    ],
    [
      "Economics",
      `Fee ≤${plainNumber(commission?.value)} ${commission?.asset ?? policy.quote_asset ?? ""} · ${settlementLabel(policy)}`,
    ],
    [
      "Funding",
      `Held ${size.asset ?? "funds"} only · no conversion or substitution`,
    ],
    ["Validity", ttlLabel(policy.validity?.ttl_seconds)],
  ];
}

function definitionGrid(rows, className = "artifact-grid") {
  const list = element("dl", { className });
  for (const [term, description] of rows) {
    const row = element("div");
    row.append(
      element("dt", { text: term }),
      element("dd", { text: description }),
    );
    list.append(row);
  }
  return list;
}

function invalidateMandateAuthorizations(label = "Superseded") {
  for (const button of state.authorizeButtons.values()) {
    button.disabled = true;
    button.dataset.guardLocked = "true";
    button.setAttribute("aria-disabled", "true");
    button.textContent = label;
  }
  state.authorizeButtons.clear();
}

function renderClarification(plan) {
  const artifact = element("section", {
    className: "artifact",
    attributes: { "aria-label": "Missing mandate details" },
  });
  const header = element("div", { className: "artifact__header" });
  const titleGroup = element("div");
  titleGroup.append(
    element("h2", { text: "A few boundaries are still missing" }),
    element("p", {
      text: "No policy has been authorized and no proposal exists yet.",
    }),
  );
  header.append(
    titleGroup,
    element("span", {
      className: "artifact-badge",
      text: "Needs your input",
    }),
  );
  artifact.append(header);
  const questions =
    plan?.clarification ??
    plan?.compilation?.ambiguities;
  if (Array.isArray(questions) && questions.length) {
    const list = element("ul", { className: "permission-list" });
    for (const item of questions) {
      const row = element("li");
      row.append(
        element("span", { text: "?" }),
        document.createTextNode(
          item?.message ??
            item?.question ??
            "Clarify this missing protection.",
        ),
      );
      list.append(row);
    }
    artifact.append(list);
  } else {
    artifact.append(
      element("p", {
        text: "Add the missing execution, fee, settlement, or validity limits, then prepare the mandate again.",
      }),
    );
  }
  const footer = element("div", { className: "artifact__footer" });
  footer.append(
    element("p", {
      text: "The Guard never invents material trading limits.",
    }),
  );
  const editButton = element("button", {
    className: "button button--secondary",
    text: "Complete the request",
    attributes: { type: "button", "data-action-control": "guard" },
  });
  editButton.addEventListener("click", () => {
    dom.intentInput.focus();
  });
  footer.append(editButton);
  artifact.append(footer);
  dom.conversation.append(artifact);
  reveal(artifact, { focus: true });
  announce("More information is required. No order can be sent.");
}

function renderUnsupported(plan) {
  const artifact = element("section", {
    className: "artifact artifact--decision-block",
    attributes: { "aria-label": "Unsupported request" },
  });
  const header = element("div", { className: "artifact__header" });
  const titleGroup = element("div");
  titleGroup.append(
    element("h2", { text: "This request stays outside the Guard" }),
    element("p", {
      text: "It was not rewritten into a different trade.",
    }),
  );
  header.append(
    titleGroup,
    element("span", {
      className: "artifact-badge artifact-badge--block",
      text: "Unsupported",
    }),
  );
  artifact.append(header);

  const constraints =
    plan?.unsupported ??
    plan?.compilation?.unsupported_constraints;
  if (Array.isArray(constraints) && constraints.length) {
    artifact.append(
      definitionGrid(
        constraints.map((item) => [
          item?.source_text || item?.code || "Request",
          item?.message ??
            item?.reason ??
            "This action is not supported.",
        ]),
      ),
    );
  } else {
    artifact.append(
      element("p", {
        className: "decision-reason",
        text: "This release supports one Coinbase Advanced custodial SPOT BUY or SELL only.",
      }),
    );
  }
  artifact.append(
    element("p", {
      className: "message__boundary",
      text: "No mandate · no proposal · no Coinbase contact · no order",
    }),
  );
  dom.conversation.append(artifact);
  setGuardStep("mandate");
  dom.guardState.textContent = "Stopped";
  reveal(artifact, { focus: true });
  announce("Unsupported request. No mandate or order was created.");
}

function renderMandate(plan) {
  const planId = plan?.plan_id;
  const policy = policyFromPlan(plan);
  const size = policy.size ?? {};
  const amountPrefix = size.operator === "MAX" ? "up to" : "exactly";
  const artifact = element("section", {
    className: "artifact",
    attributes: {
      "aria-label": "Mandate captured",
      "data-plan-id": planId,
    },
  });
  const header = element("div", { className: "artifact__header" });
  const titleGroup = element("div");
  titleGroup.append(
    element("h2", {
      text: `${titleCase(policy.side)} ${amountPrefix} ${plainNumber(size.value)} ${size.asset ?? ""} on ${policy.product_id ?? "the exact pair"}`,
    }),
    element("p", {
      text: "Your instruction, converted into an enforceable boundary.",
    }),
  );
  header.append(
    titleGroup,
    element("span", {
      className: "artifact-badge",
      text: "Mandate captured",
    }),
  );
  artifact.append(header, definitionGrid(mandateRows(plan)));

  const footer = element("div", { className: "artifact__footer" });
  footer.append(
    element("p", {
      text: "Authorization permits one dry-run check only. It does not authorize an order.",
    }),
  );
  const actions = element("div", { className: "artifact-actions" });
  const editButton = element("button", {
    className: "button button--ghost",
    text: "Edit intent",
    attributes: { type: "button", "data-action-control": "guard" },
  });
  const authorizeButton = element("button", {
    className: "button button--primary",
    text: "Authorize for one check",
    attributes: {
      type: "button",
      "data-action-control": "guard",
      "data-plan-id": planId,
    },
  });
  editButton.addEventListener("click", () => {
    dom.intentInput.focus();
    announce("Edit the request, then prepare a new mandate.");
  });
  authorizeButton.addEventListener("click", () => {
    void authorizePlan(planId, authorizeButton);
  });
  if (planId) state.authorizeButtons.set(planId, authorizeButton);
  actions.append(editButton, authorizeButton);
  footer.append(actions);
  artifact.append(footer);
  dom.conversation.append(artifact);
  setGuardStep("mandate");
  dom.guardState.textContent = "Awaiting you";
  reveal(artifact, { focus: true });
  announce(
    "Mandate captured. Review every boundary, then authorize one dry-run check.",
  );
}

function firstIssue(record) {
  const collections = [
    record?.funding?.evidence_issues,
    record?.funding?.policy_failures,
    record?.funding?.failures,
    record?.proposal_check?.failures,
    record?.preview_check?.review_reasons,
    record?.preview_check?.failures,
    record?.delta?.constraint_failures,
  ];
  for (const collection of collections) {
    if (!Array.isArray(collection) || collection.length === 0) continue;
    const issue = collection[0];
    return issue?.message ?? issue?.reason ?? null;
  }
  return null;
}

function resultOutcome(record) {
  const rawDecision = record?.decision?.outcome;
  const decision =
    typeof rawDecision === "string"
      ? rawDecision.trim().toUpperCase()
      : "";
  if (record?.receipt?.verified !== true) return "REVIEW";
  return ["PASS", "BLOCK", "REVIEW"].includes(decision)
    ? decision
    : "REVIEW";
}

function resultReason(record, outcome) {
  if (record?.receipt?.verified !== true) {
    return "The Guard could not verify the decision receipt, so the proposal remains locked.";
  }
  return (
    record?.guard_receipt?.decision?.reason ??
    record?.decision?.reason ??
    record?.delta?.reason ??
    firstIssue(record) ??
    record?.failure?.message ??
    {
      PASS:
        "The exact proposal satisfied the mandate and deterministic checks.",
      BLOCK: "Verified facts show that the proposal violates the mandate.",
      REVIEW:
        "The Guard could not verify fresh, complete, matching evidence.",
    }[outcome]
  );
}

function decisionLabel(outcome) {
  return {
    PASS: "PASS · Fits mandate",
    BLOCK: "BLOCK · Outside mandate",
    REVIEW: "REVIEW · Unable to verify",
  }[outcome] ?? "REVIEW · Unable to verify";
}

function comparisonRows(record) {
  const mandate = record?.mandate;
  if (!mandate) return [];
  const checked = record?.checked ?? {};
  const proposal = record?.proposal ?? {};
  const impact = record?.impact ?? {};
  const rows = [];
  const condition = mandate.condition;
  const marketValue =
    condition?.reference === "BEST_BID"
      ? checked.best_bid
      : checked.best_ask;
  if (condition?.value != null && marketValue != null) {
    rows.push([
      condition.reference === "BEST_BID" ? "Best bid" : "Best ask",
      `${plainNumber(marketValue)} ${condition.asset}`,
      `${condition.operator === "AT_OR_ABOVE" ? "≥" : "≤"} ${plainNumber(condition.value)} ${condition.asset}`,
    ]);
  }

  if (
    checked.balance != null &&
    mandate.funding?.required_available != null
  ) {
    rows.push([
      "Held funds",
      `${plainNumber(checked.balance)} ${checked.balance_asset ?? mandate.funding.asset}`,
      `≥ ${plainNumber(mandate.funding.required_available)} ${mandate.funding.asset}`,
    ]);
  }

  const proposedSize =
    mandate.size?.asset === mandate.quote_asset
      ? proposal.quote_size
      : proposal.base_size;
  if (proposedSize != null && mandate.size?.value != null) {
    rows.push([
      "Proposal size",
      `${plainNumber(proposedSize)} ${mandate.size.asset}`,
      `${mandate.size.operator === "MAX" ? "≤" : "="} ${plainNumber(mandate.size.value)} ${mandate.size.asset}`,
    ]);
  }

  if (
    impact.estimated_fee?.value != null &&
    mandate.limits?.max_commission?.value != null
  ) {
    rows.push([
      "Estimated fee",
      `${plainNumber(impact.estimated_fee.value)} ${impact.estimated_fee.asset}`,
      `≤ ${plainNumber(mandate.limits.max_commission.value)} ${mandate.limits.max_commission.asset}`,
    ]);
  }

  const settlement = mandate.limits?.settlement;
  const observedSettlement =
    settlement?.kind === "MIN_NET_QUOTE_PROCEEDS"
      ? impact.estimated_receive
      : impact.debit;
  if (settlement?.value != null && observedSettlement?.value != null) {
    rows.push([
      "Settlement",
      `${plainNumber(observedSettlement.value)} ${observedSettlement.asset}`,
      `${settlement.kind === "MIN_NET_QUOTE_PROCEEDS" ? "≥" : "≤"} ${plainNumber(settlement.value)} ${settlement.asset}`,
    ]);
  }
  return rows;
}

function renderComparison(record) {
  const rows = comparisonRows(record);
  if (!rows.length) return null;
  const comparison = element("section", {
    className: "comparison",
    attributes: { "aria-label": "Observed facts compared with mandate" },
  });
  comparison.append(
    element("h3", { text: "Observed vs allowed" }),
  );
  const header = element("div", {
    className: "comparison__header",
    attributes: { "aria-hidden": "true" },
  });
  header.append(
    element("span", { text: "Check" }),
    element("span", { text: "Observed" }),
    element("span", { text: "Allowed" }),
  );
  comparison.append(header);
  for (const [label, observed, allowed] of rows) {
    const row = element("div", { className: "comparison__row" });
    row.append(
      element("strong", { text: label }),
      element("span", {
        className: "comparison__observed",
        text: observed,
      }),
      element("span", {
        className: "comparison__allowed",
        text: allowed,
      }),
    );
    comparison.append(row);
  }
  return comparison;
}

function proposalLabel(record) {
  const action = record?.proposal?.action ?? record?.proposal;
  if (!action || typeof action !== "object") {
    return "No exact proposal was created";
  }
  const policy = record?.policy ?? record?.mandate ?? {};
  const side = action.side ?? policy.side ?? "—";
  const size =
    action.quote_size != null
      ? `${plainNumber(action.quote_size)} ${policy.quote_asset ?? "quote"}`
      : `${plainNumber(action.base_size)} ${policy.base_asset ?? "base"}`;
  const limit =
    action.limit_price != null
      ? ` · limit ${plainNumber(action.limit_price)} ${policy.quote_asset ?? ""}`
      : "";
  return `${side} ${size} on ${action.product_id ?? policy.product_id ?? "exact pair"}${limit} · immediate-or-cancel`;
}

function impactLabel(record) {
  if (record?.impact) {
    const debit = record.impact.debit;
    const receive = record.impact.estimated_receive;
    const fee = record.impact.estimated_fee;
    if (debit || receive || fee) {
      return `${debit ? `${plainNumber(debit.value)} ${debit.asset} debited` : "Debit unavailable"} · ${receive ? `estimated ${plainNumber(receive.value)} ${receive.asset} received` : "receive estimate unavailable"} · ${fee ? `${plainNumber(fee.value)} ${fee.asset} fee` : "fee unavailable"}`;
    }
  }
  const preview = record?.preview?.evidence;
  if (!preview) return "Not calculated — complete Preview evidence was not reached";
  const policy = record?.policy ?? {};
  const settlement =
    record?.preview_check?.settlement?.value ?? preview.order_total;
  if (policy.side === "SELL") {
    return `Sell ${plainNumber(preview.base_size)} ${policy.base_asset ?? ""} · estimated ${plainNumber(settlement)} ${policy.quote_asset ?? ""} net · ${plainNumber(preview.commission_total)} ${policy.quote_asset ?? ""} fee`;
  }
  return `Up to ${plainNumber(settlement)} ${policy.quote_asset ?? ""} debited · estimated ${plainNumber(preview.base_size)} ${policy.base_asset ?? ""} received · ${plainNumber(preview.commission_total)} ${policy.quote_asset ?? ""} fee`;
}

function provenanceLabel(record) {
  const mode =
    record?.mode ??
    record?.guard_receipt?.mode ??
    record?.guard_mode ??
    record?.boundary?.mode ??
    "dry_run";
  const checkedAt =
    record?.checked?.at ??
    record?.sources?.preview?.received_at ??
    record?.sources?.best_bid_ask?.observed_at ??
    record?.generated_at ??
    "time unavailable";
  if (mode === "view_only_preflight") {
    return `Coinbase View-only balance, product, market, and Preview facts · checked ${checkedAt}`;
  }
  return `Labeled simulated balance, product, market, and Preview facts · checked ${checkedAt}`;
}

function receiptDetails(record) {
  const receipt =
    record?.receipt ??
    record?.guard_receipt ??
    record?.decision?.receipt ??
    {};
  return [
    ["Mode", receipt.mode ?? record?.guard_mode ?? "dry_run"],
    ["Receipt status", receipt.receipt_digest ? "Locally verifiable" : "Unavailable"],
    ["Receipt digest", receipt.receipt_digest ?? "Unavailable"],
    ["Proposal digest", record?.proposal?.proposal_digest ?? "Hidden in compact view"],
    ["Preflight fingerprint", record?.preflight?.fingerprint ?? "Unavailable"],
    [
      "Proof limit",
      receipt.proof_limit ??
        "Local integrity only; not a Coinbase or production Delta signature",
    ],
  ];
}

function resultBoundary(record, outcome) {
  const mode =
    record?.mode ??
    record?.guard_receipt?.mode ??
    record?.guard_mode ??
    record?.boundary?.mode ??
    "dry_run";
  if (mode === "view_only_preflight") {
    return outcome === "PASS"
      ? "View-only point-in-time preflight. Not Delta authorization; no Create route, order, or money movement."
      : "View-only verification stopped safely. No execution grant, Create route, order, or money movement.";
  }
  if (typeof record?.boundary?.statement === "string") {
    return record.boundary.statement;
  }
  return outcome === "PASS"
    ? "Local Delta simulation checked this exact proposal. No Coinbase contact, Create route, order, or money movement."
    : "Local simulation stopped safely. No Coinbase contact, execution eligibility, Create route, order, or money movement.";
}

function appendLabeledLine(parent, className, label, text) {
  const line = element("p", { className });
  line.append(
    element("strong", { text: label }),
    document.createTextNode(text),
  );
  parent.append(line);
}

function updateDecisionSnapshot(outcome, reason) {
  dom.decisionSnapshot.hidden = false;
  dom.decisionSnapshotOutcome.textContent = decisionLabel(outcome);
  dom.decisionSnapshotReason.textContent = reason;
}

function renderResult(resultPayload, target = dom.conversation) {
  const record =
    resultPayload?.record ??
    resultPayload?.result?.record ??
    resultPayload?.result ??
    resultPayload;
  state.currentResult = record;
  const outcome = resultOutcome(record);
  const outcomeClass = outcome.toLowerCase();
  const reason = resultReason(record, outcome);
  const labeledOutcome = decisionLabel(outcome);
  const artifact = element("section", {
    className: `artifact artifact--decision-${outcomeClass}`,
    attributes: { "aria-label": `${labeledOutcome} Guard decision` },
  });
  const header = element("div", { className: "artifact__header" });
  const titleGroup = element("div");
  titleGroup.append(
    element("h2", { text: proposalLabel(record) }),
    element("p", {
      text: "The proposal below is separate from the mandate you authorized.",
    }),
  );
  header.append(
    titleGroup,
    element("span", {
      className: `artifact-badge artifact-badge--${outcomeClass}`,
      text: labeledOutcome,
    }),
  );
  artifact.append(
    header,
    element("p", { className: "decision-reason", text: reason }),
  );
  appendLabeledLine(artifact, "impact-line", "Impact", impactLabel(record));
  appendLabeledLine(
    artifact,
    "provenance-line",
    "Checked",
    provenanceLabel(record),
  );
  if (outcome !== "PASS") {
    appendLabeledLine(
      artifact,
      "recovery-line",
      "Next",
      record?.guard_receipt?.decision?.recovery ??
        record?.decision?.recovery ??
        record?.failure?.recovery ??
        (outcome === "REVIEW"
          ? "Refresh or repair the missing evidence, then run a new check."
          : "Revise the proposal or authorize a new mandate."),
    );
  }
  appendLabeledLine(
    artifact,
    "receipt-line",
    "Receipt",
    record?.receipt?.verified === true && record?.receipt?.receipt_digest
      ? "Generated and verified locally with exact integrity bindings"
      : "No verified local receipt was available",
  );

  const comparison = renderComparison(record);
  if (comparison) artifact.append(comparison);
  artifact.append(
    element("p", {
      className: "no-order-banner",
      text: "No order submitted · Coinbase Create remains unavailable",
    }),
  );
  const details = element("details", { className: "details-panel" });
  details.append(element("summary", { text: "Technical receipt details" }));
  details.append(definitionGrid(receiptDetails(record), "details-list"));
  artifact.append(details);

  const footer = element("div", { className: "artifact__footer" });
  footer.append(
    element("p", {
      className: "message__boundary",
      text: resultBoundary(record, outcome),
    }),
  );
  const actions = element("div", { className: "artifact-actions" });
  if (outcome === "BLOCK") {
    const revise = element("button", {
      className: "button button--secondary",
      text: "Revise the intent",
      attributes: { type: "button", "data-action-control": "guard" },
    });
    revise.addEventListener("click", () => dom.intentInput.focus());
    actions.append(revise);
  } else if (outcome === "REVIEW") {
    const retry = element("button", {
      className: "button button--secondary",
      text: "Start a fresh check",
      attributes: { type: "button", "data-action-control": "guard" },
    });
    retry.addEventListener("click", () => dom.intentInput.focus());
    actions.append(retry);
  }
  const liveButton = element("button", {
    className: "button button--disabled",
    text: "Live order unavailable",
    attributes: { type: "button", disabled: "" },
  });
  actions.append(liveButton);
  footer.append(actions);
  artifact.append(footer);
  target.append(artifact);

  setGuardStep("confirmation");
  dom.guardState.textContent =
    outcome === "PASS" ? "Passed · locked" : `${titleCase(outcome)} · locked`;
  updateDecisionSnapshot(outcome, reason);
  reveal(artifact, { focus: true });
  announce(`${outcome}. ${reason} No order was submitted.`);
  return artifact;
}

async function prepareMandate(event) {
  event.preventDefault();
  if (state.pending) {
    announce(
      "A protected check is already running. The current mandate was not changed.",
    );
    return null;
  }
  const intent = dom.intentInput.value.trim();
  if (!intent) {
    announce("Describe the trade you want to prepare.");
    dom.intentInput.focus();
    return;
  }

  invalidateMandateAuthorizations("Superseded");
  state.currentPlan = null;
  setGuardStep("mandate");
  addMessage(
    "user",
    intent,
    "Planning request only · not an authorization or order",
  );
  const payload = await runPending(
    dom.prepareButton,
    "Preparing safely…",
    async () => {
      try {
        const response = await requestJson("/api/advisor/plan", {
          method: "POST",
          body: { intent },
        });
        const plan = response?.plan;
        if (!plan || typeof plan !== "object") {
          throw new Error(
            "The local Guard did not return a usable mandate. Nothing was submitted.",
          );
        }
        state.currentPlan = plan;
        if (plan.status === "AWAITING_HUMAN_CONFIRMATION") {
          renderMandate(plan);
        } else if (plan.status === "NEEDS_CLARIFICATION") {
          renderClarification(plan);
        } else {
          renderUnsupported(plan);
        }
        return response;
      } catch (error) {
        addError(
          error instanceof Error
            ? error.message
            : "The local Guard could not prepare this mandate. Nothing was submitted.",
        );
        dom.guardState.textContent = "Stopped";
        return null;
      }
    },
  );
  return payload;
}

async function authorizePlan(planId, button) {
  if (state.pending) {
    announce(
      "A protected check is already running. No authorization was changed.",
    );
    return;
  }
  if (
    typeof planId !== "string" ||
    !planId ||
    state.authorizeButtons.get(planId) !== button ||
    button?.dataset.planId !== planId
  ) {
    addError(
      "The mandate is no longer available. Prepare it again before authorizing.",
    );
    return;
  }
  invalidateMandateAuthorizations("Authorization used");
  state.currentPlan = null;
  addMessage(
    "user",
    "Authorize this mandate for one protected dry-run check.",
    "This authorizes evaluation only · not an order",
  );
  setGuardStep("proposal");
  await runPending(button, "Checking exact proposal…", async () => {
    try {
      const response = await requestJson("/api/advisor/authorize", {
        method: "POST",
        body: { plan_id: planId },
      });
      setGuardStep("decision");
      renderResult(response?.result ?? response);
    } catch (error) {
      addError(
        error instanceof Error
          ? error.message
          : "The local Guard could not complete this check. No order was submitted.",
      );
      setGuardStep("confirmation");
      dom.guardState.textContent = "Stopped · locked";
    }
  });
}

function attemptOutcome(attempt) {
  return (
    attempt?.decision?.outcome ??
    attempt?.evaluation_status ??
    attempt?.receipt?.verdict ??
    attempt?.result?.status ??
    "CHECK"
  );
}

function renderShowcase(showcasePayload, target) {
  const showcase =
    showcasePayload?.showcase ??
    showcasePayload?.demo?.bounded_retry ??
    showcasePayload;
  const trace =
    showcase?.demo?.bounded_retry ??
    showcase?.bounded_retry ??
    showcase;
  const attempts = Array.isArray(trace?.attempts) ? trace.attempts : [];

  const artifact = element("section", {
    className: "artifact",
    attributes: { "aria-label": "Simulated protection showcase" },
  });
  const header = element("div", { className: "artifact__header" });
  const titleGroup = element("div");
  titleGroup.append(
    element("h2", {
      text: "One mandate. Two exact proposals. One protected boundary.",
    }),
    element("p", {
      text: "Labeled fixture story — not a live market claim or order.",
    }),
  );
  header.append(
    titleGroup,
    element("span", {
      className: "artifact-badge",
      text: "Simulation",
    }),
  );
  artifact.append(header);

  if (attempts.length) {
    const attemptGrid = element("div", { className: "showcase-attempts" });
    for (const attempt of attempts) {
      const outcome = attemptOutcome(attempt);
      const card = element("article", { className: "showcase-attempt" });
      card.append(
        element("span", {
          className: `outcome-badge outcome-badge--${String(outcome).toLowerCase().includes("pass") ? "pass" : "block"}`,
          text: String(outcome).includes("PASS") ? "PASS" : "BLOCK",
        }),
        element("h3", {
          text: `Proposal ${attempt?.attempt ?? attemptGrid.children.length + 1}`,
        }),
      );
      const failures =
        attempt?.decision?.reasons ??
        attempt?.constraint_failures;
      card.append(
        element("p", {
          text:
            Array.isArray(failures) && failures.length
              ? `${failures.length} mandate constraint${failures.length === 1 ? "" : "s"} failed; the controller may revise once.`
              : "The revised exact proposal fits the mandate; its receipt binds this payload only.",
        }),
      );
      attemptGrid.append(card);
    }
    artifact.append(attemptGrid);
  } else {
    artifact.append(
      element("p", {
        className: "decision-reason",
        text: "The simulated controller blocks a violating proposal, permits one bounded revision, and passes only the exact compliant payload.",
      }),
    );
  }

  const footer = element("div", { className: "artifact__footer" });
  footer.append(
    element("p", {
      className: "message__boundary",
      text: "Fixtures only · no credential · no Coinbase contact · no order · no money moved",
    }),
    element("button", {
      className: "button button--disabled",
      text: "Execution remains locked",
      attributes: { type: "button", disabled: "" },
    }),
  );
  artifact.append(footer);
  target.append(artifact);
  reveal(artifact, { focus: true });
  announce(
    "Simulated BLOCK, retry, PASS story complete. No order was submitted.",
  );
  return artifact;
}

async function runShowcase(button, target = dom.conversation) {
  await runPending(button, "Running fixture…", async () => {
    try {
      const response = await requestJson("/api/demo/showcase", {
        method: "POST",
        body: {},
      });
      renderShowcase(response?.showcase ?? response, target);
    } catch (error) {
      addError(
        error instanceof Error
          ? error.message
          : "The labeled showcase could not run. Nothing was submitted.",
        target,
      );
    }
  });
}

async function runReviewDemo(button) {
  await runPending(button, "Withholding stale evidence…", async () => {
    try {
      const response = await requestJson("/api/demo/review", {
        method: "POST",
        body: {},
      });
      renderResult(response?.review ?? response?.result ?? response);
    } catch (error) {
      addError(
        error instanceof Error
          ? error.message
          : "The REVIEW fixture could not run. Nothing was submitted.",
      );
    }
  });
}

function activityEntries(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.guard_history) && payload.guard_history.length) {
    return payload.guard_history;
  }
  const candidates = [
    payload?.session_activity,
    payload?.entries,
    payload?.activity,
    payload?.history,
    payload?.results,
  ];
  return candidates.find(Array.isArray) ?? [];
}

function activityMandate(entry) {
  const mandate =
    entry?.input?.mandate ??
    entry?.mandate ??
    entry?.record?.policy ??
    {};
  const size = mandate?.size ?? {};
  const prefix = size.operator === "MAX" ? "Up to" : "Exactly";
  const side = mandate.side ?? entry?.side;
  const productId = mandate.product_id ?? entry?.product_id;
  if (!side && !productId) return titleCase(entry?.kind ?? "Protected Guard check");
  if (!size.value) {
    return `${titleCase(side)} on ${productId ?? "exact pair"}`;
  }
  return `${titleCase(side)} ${prefix.toLowerCase()} ${plainNumber(size.value)} ${size.asset ?? ""} on ${productId ?? "exact pair"}`;
}

function renderActivity(payload) {
  const entries = activityEntries(payload);
  dom.activityList.replaceChildren();
  if (!entries.length) {
    const empty = element("section", { className: "empty-state" });
    empty.append(
      element("span", { text: "○", attributes: { "aria-hidden": "true" } }),
      element("h2", { text: "No Guard activity yet" }),
      element("p", {
        text: "Run a protected dry run to create a private, redacted local history entry.",
      }),
    );
    dom.activityList.append(empty);
    return;
  }

  for (const entry of entries) {
    const outcome =
      entry?.outcome ??
      entry?.receipt?.decision?.outcome ??
      entry?.record?.decision ??
      entry?.decision ??
      entry?.status ??
      "CHECK";
    const card = element("article", { className: "activity-entry" });
    const meta = element("div");
    const timestamp =
      entry?.recorded_at ??
      entry?.occurred_at ??
      entry?.created_at ??
      entry?.generated_at;
    meta.append(
      element("p", {
        text:
          entry?.mode === "view_only_preflight"
            ? "View-only preflight"
            : "Simulated dry run",
      }),
      element("time", {
        text: timestamp
          ? new Date(timestamp).toLocaleString()
          : "Time unavailable",
        attributes: timestamp ? { datetime: timestamp } : {},
      }),
    );
    const summary = element("div");
    summary.append(
      element("h2", { text: activityMandate(entry) }),
      element("p", {
        text:
          entry?.reason ??
          entry?.receipt?.decision?.reason ??
          "Redacted Guard decision",
      }),
      element("p", {
        text: "Redacted local evidence · no credential · no order submitted",
      }),
    );
    const normalizedOutcome = ["PASS", "BLOCK", "REVIEW"].includes(outcome)
      ? outcome
      : "CHECK";
    card.append(
      meta,
      summary,
      element("span", {
        className: `outcome-badge outcome-badge--${normalizedOutcome === "CHECK" ? "review" : normalizedOutcome.toLowerCase()}`,
        text: normalizedOutcome,
      }),
    );
    dom.activityList.append(card);
  }
}

async function loadActivity() {
  await runPending(
    dom.refreshActivityButton,
    "Loading private history…",
    async () => {
      try {
        const response = await requestJson("/api/activity");
        state.activityLoaded = true;
        renderActivity(response);
        announce("Private Guard activity refreshed.");
      } catch (error) {
        dom.activityList.replaceChildren();
        addError(
          error instanceof Error
            ? error.message
            : "Private Guard history could not be loaded.",
          dom.activityList,
        );
      }
    },
  );
}

function explainFutureCapability(kind) {
  const content = {
    research: {
      title: "Educational token research",
      message:
        "This surface will show sources, as-of times, assumptions, uncertainty, and risk without recommending a trade. It cannot create or authorize an order.",
    },
    portfolio: {
      title: "Editable allocation planning",
      message:
        "This surface will let you adjust assumptions and allocations before choosing whether to create separately reviewed single-trade mandates. It will never auto-buy.",
    },
  }[kind];
  if (!content) return;
  navigate("advisor", { focus: false });
  addMessage(
    "advisor",
    `${content.title}: ${content.message}`,
    "Planning preview only · no individualized advice · no order",
  );
}

function handleQuickStart(event) {
  const start = event.currentTarget.dataset.start;
  if (start === "trade") {
    navigate("advisor", { focus: false });
    dom.intentInput.value = SAMPLE_INTENT;
    dom.intentInput.focus();
    dom.intentInput.select();
    announce("Protected spot-trade example is ready to prepare.");
  } else if (start === "condition") {
    navigate("plans");
    announce("Conditional plan preview. Nothing is monitoring or trading.");
  } else {
    explainFutureCapability(start);
  }
}

async function loadStatus() {
  try {
    const payload = await requestJson("/api/status");
    const status = payload?.status ?? payload;
    dom.modeStatus.textContent =
      status?.mode_label ??
      (status?.mode === "view_only_preflight" ? "View only" : "Dry run");
    dom.connectionStatus.textContent =
      status?.coinbase_connected === true
        ? "Coinbase: View only"
        : "Coinbase: off";
    dom.orderStatus.textContent = "Orders off";
    dom.serviceStatus.textContent = "Local Guard status: ready";
  } catch {
    dom.modeStatus.textContent = "Dry run";
    dom.connectionStatus.textContent = "Coinbase: off";
    dom.orderStatus.textContent = "Orders off";
    dom.serviceStatus.textContent = "Local Guard status: unavailable";
  }
}

for (const tab of dom.navTabs) {
  tab.addEventListener("click", () => navigate(tab.dataset.viewTarget));
}

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const cancel = event.target.closest("[data-cancel-pending]");
  if (!cancel || !state.pendingAbortController) return;
  state.pendingAbortController.abort("USER_CANCELLED");
  cancel.disabled = true;
  cancel.textContent = "Stopping safely…";
  announce("Stopping the local check. No order can be sent.");
});

for (const quickStart of dom.quickStarts) {
  quickStart.addEventListener("click", handleQuickStart);
}

dom.advisorForm.addEventListener("submit", (event) => {
  void prepareMandate(event);
});

dom.intentInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    dom.advisorForm.requestSubmit();
  }
});

dom.showcaseButton.addEventListener("click", () => {
  void runShowcase(dom.showcaseButton);
});

dom.plansShowcaseButton.addEventListener("click", () => {
  if (state.pending) {
    announce("A protected check is already running.");
    return;
  }
  dom.planDemoOutput.replaceChildren();
  void runShowcase(dom.plansShowcaseButton, dom.planDemoOutput);
});

dom.reviewButton.addEventListener("click", () => {
  void runReviewDemo(dom.reviewButton);
});

dom.refreshActivityButton.addEventListener("click", () => {
  void loadActivity();
});

void loadStatus();
