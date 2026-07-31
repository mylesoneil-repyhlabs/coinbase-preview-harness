const SAMPLE_INTENT =
  "Using my isolated Coinbase Advanced portfolio, use up to 3000 USDC to buy ETH on ETH-USDC once now with a price-bounded IOC limit order. Only if Coinbase's fresh best ask is at or below 3000 USDC. Partial fill is acceptable. Do not pay more than 35 bps above Coinbase's fresh best ask, more than 15 USDC in commission, or more than 3015 USDC total. This authorization expires 10 minutes after I confirm it.";

const state = {
  activeView: "advisor",
  currentPlan: null,
  currentResult: null,
  activityLoaded: false,
  connectionLoaded: false,
  connection: null,
  selectedMode: "dry_run",
  modeChoiceSequence: 0,
  pending: false,
  pendingRegion: null,
  pendingStatusNode: null,
  pendingAbortController: null,
  pendingCancellation: null,
  authorizeButtons: new Map(),
  conditionalPlan: null,
};

const actionControlState = new WeakMap();

const dom = {
  navTabs: [...document.querySelectorAll("[data-view-target]")],
  views: [...document.querySelectorAll("[data-view]")],
  quickStarts: [...document.querySelectorAll("[data-start]")],
  modeStatus: document.querySelector("#mode-status"),
  advisorModeBadge: document.querySelector("#advisor-mode-badge"),
  connectionStatus: document.querySelector("#connection-status"),
  orderStatus: document.querySelector("#order-status"),
  serviceStatus: document.querySelector("#service-status"),
  announcer: document.querySelector("#announcer"),
  conversation: document.querySelector("#conversation"),
  advisorForm: document.querySelector("#advisor-form"),
  intentInput: document.querySelector("#intent-input"),
  prepareButton: document.querySelector("#prepare-button"),
  showcaseButton: document.querySelector("#showcase-button"),
  reviewButton: document.querySelector("#review-button"),
  conditionalForm: document.querySelector("#conditional-form"),
  conditionalProduct: document.querySelector("#conditional-product"),
  conditionalSide: document.querySelector("#conditional-side"),
  conditionalSize: document.querySelector("#conditional-size"),
  conditionalThreshold: document.querySelector("#conditional-threshold"),
  conditionalConditionLabel: document.querySelector(
    "#conditional-condition-label",
  ),
  conditionalSlippage: document.querySelector(
    "#conditional-slippage",
  ),
  conditionalFee: document.querySelector("#conditional-fee"),
  conditionalTimezone: document.querySelector(
    "#conditional-timezone",
  ),
  conditionalExpiry: document.querySelector(
    "#conditional-expiry",
  ),
  conditionalSaveButton: document.querySelector(
    "#conditional-save-button",
  ),
  conditionalOutput: document.querySelector(
    "#conditional-output",
  ),
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
  connectionState: document.querySelector("#connection-state"),
  connectionStateIcon: document.querySelector("#connection-state-icon"),
  connectionStateTitle: document.querySelector("#connection-state-title"),
  connectionStateDescription: document.querySelector(
    "#connection-state-description",
  ),
  connectionForm: document.querySelector("#connection-form"),
  coinbaseKeyName: document.querySelector("#coinbase-key-name"),
  coinbasePrivateKey: document.querySelector("#coinbase-private-key"),
  connectButton: document.querySelector("#connect-button"),
  connectedControls: document.querySelector("#connected-controls"),
  connectionPermissions: document.querySelector("#connection-permissions"),
  connectionVerifiedAt: document.querySelector("#connection-verified-at"),
  connectionExpiresAt: document.querySelector("#connection-expires-at"),
  disconnectButton: document.querySelector("#disconnect-button"),
  connectionProgress: document.querySelector("#connection-progress"),
  connectionFeedback: document.querySelector("#connection-feedback"),
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
    node.dataset.actionControl === "guard" &&
    node.dataset.safetyAction !== "true"
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
    /private[\s_-]?key|begin[\s\S]*private key|bearer\s+|jwt|organizations\/[^/\s]+\/apiKeys\//i.test(
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
      if (controller.signal.reason === "SERVER_CANCELLED") {
        throw new Error(
          "The server confirmed that the one-check simulation was cancelled and any late result will be discarded.",
        );
      }
      if (
        controller.signal.reason ===
        "COMPLETED_BEFORE_CANCEL"
      ) {
        throw new Error(
          "The server completed the check before cancellation. Its exact result is already shown.",
        );
      }
      if (
        controller.signal.reason ===
        "USER_STOPPED_WAITING"
      ) {
        throw new Error(
          "You stopped waiting in this browser. The local action may still finish; check Activity or reconnect to its status before retrying. No order can be sent.",
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

async function requestSafetyJson(path, body) {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort("TIMEOUT"),
    8_000,
  );
  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Delta-Advisor": "1",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(
        safeProviderMessage(
          payload,
          "The safety action stopped without changing the saved plan.",
        ),
      );
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        "The local safety action did not answer in time. Its state is unconfirmed; stop the local server to end all in-memory checks.",
      );
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function cancelPendingOperation(cancel) {
  const context = state.pendingCancellation;
  if (
    context?.kind !== "conditional_simulation"
  ) {
    state.pendingAbortController?.abort(
      "USER_STOPPED_WAITING",
    );
    cancel.disabled = true;
    cancel.textContent = "Stopped waiting";
    announce(
      "Stopped waiting in this browser. Local work may still finish; check Activity or connection status before retrying.",
    );
    return;
  }

  cancel.disabled = true;
  cancel.textContent = "Cancelling on server…";
  context.requested = true;
  try {
    const response = await requestSafetyJson(
      "/api/conditional/cancel",
      {
        plan_id: context.plan_id,
        revision: context.revision,
        authorization_id: context.authorization_id,
      },
    );
    if (response.cancelled === true) {
      context.confirmed = true;
      state.pendingAbortController?.abort(
        "SERVER_CANCELLED",
      );
      renderConditionalCancelled(response.saved_plan);
      return;
    }
    const completed = response.saved_plan?.result;
    if (completed) {
      context.completedBeforeCancellation = true;
      context.resolved = true;
      state.pendingAbortController?.abort(
        "COMPLETED_BEFORE_CANCEL",
      );
      renderConditionalResult(
        response.saved_plan,
        completed,
        { completedBeforeCancellation: true },
      );
      announce(
        "The check completed before cancellation reached the server. Its exact result is shown; no order was submitted.",
      );
      return;
    }
    cancel.textContent = "Cancellation not applied";
    announce(
      "The server could not confirm cancellation. Keep waiting or inspect Activity before retrying; no order can be sent.",
    );
  } catch (error) {
    cancel.disabled = false;
    cancel.textContent = "Retry server cancellation";
    announce(
      error instanceof Error
        ? error.message
        : "Server cancellation was not confirmed. No order can be sent.",
    );
  }
}

function setActionControlsDisabled(disabled) {
  for (const control of document.querySelectorAll(
    '[data-action-control="guard"]',
  )) {
    if (control.dataset.safetyAction === "true") continue;
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
    const remainsLocked =
      wasDisabled || control.dataset.guardLocked === "true";
    control.disabled = remainsLocked;
    if (!remainsLocked) control.removeAttribute("aria-disabled");
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
  } else {
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
  const cancel = state.pendingStatusNode.querySelector(
    "[data-cancel-pending]",
  );
  const description =
    state.pendingStatusNode.querySelector("span");
  if (
    state.pendingCancellation?.kind ===
    "conditional_simulation"
  ) {
    if (cancel) {
      cancel.textContent = "Cancel one-check simulation";
    }
    if (description) {
      description.textContent =
        "Conflicting actions are paused. Cancel asks the local server to abort this one-check attempt and discard any late result. No order can be sent.";
    }
  } else {
    if (cancel) cancel.textContent = "Stop waiting";
    if (description) {
      description.textContent =
        "Conflicting actions are paused. Stop waiting only closes the browser request; local work may still finish. No order can be sent.";
    }
  }
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

function checkModeLabel(mode) {
  return mode === "view_only_preflight"
    ? "View-only preflight"
    : "Dry-run simulation";
}

function setSelectedMode(mode) {
  const nextMode =
    mode === "view_only_preflight" && state.connection?.connected === true
      ? "view_only_preflight"
      : "dry_run";
  state.selectedMode = nextMode;
  dom.modeStatus.textContent =
    nextMode === "view_only_preflight" ? "View only" : "Dry run";
  dom.advisorModeBadge.textContent = checkModeLabel(nextMode);
}

function formatConnectionTime(value) {
  if (typeof value !== "string" || !value) return "Time unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  return date.toLocaleString();
}

function connectionStatusFrom(payload) {
  const connection = payload?.connection ?? payload;
  if (!connection || typeof connection !== "object") {
    return { connected: false };
  }
  return connection;
}

function clearConnectionFeedback() {
  dom.connectionFeedback.replaceChildren();
}

function showConnectionProgress(message) {
  dom.connectionProgress.textContent = message;
  dom.connectionProgress.hidden = false;
}

function hideConnectionProgress() {
  dom.connectionProgress.hidden = true;
  dom.connectionProgress.textContent = "";
}

function applyConnectionStatus(payload, { announceChange = false } = {}) {
  const connection = connectionStatusFrom(payload);
  const connected = connection.connected === true;
  state.connectionLoaded = true;
  state.connection = connected ? connection : { connected: false };
  dom.connectionForm.hidden = connected;
  dom.connectedControls.hidden = !connected;
  dom.connectionState.classList.toggle("is-connected", connected);
  dom.connectionStateIcon.textContent = connected ? "✓" : "○";
  dom.connectionStateTitle.textContent = connected
    ? "View only connected"
    : "Not connected";
  dom.connectionStateDescription.textContent = connected
    ? "Coinbase accepted this session key with View permission and no Trade or Transfer permission. Each real preflight must still recheck that scope."
    : "No Coinbase key is loaded. Credential-free dry runs stay fully available with labeled fixture data.";
  dom.connectionStatus.textContent = connected
    ? "Coinbase: View only"
    : "Coinbase: off";
  for (const input of document.querySelectorAll(
    '[data-conditional-view-source="true"]',
  )) {
    input.disabled = !connected;
    const description =
      input.closest("label")?.querySelector("small");
    if (description) {
      description.textContent = connected
        ? "Rechecks permission, product, and one fresh BBO. No fixture fallback."
        : "Connect a View-only key first. Dry fixtures remain available.";
    }
    if (!connected && input.checked) {
      const fixture = input
        .closest("fieldset")
        ?.querySelector('input[value="fixture"]');
      if (fixture) {
        fixture.checked = true;
        fixture.dispatchEvent(
          new Event("change", { bubbles: true }),
        );
      }
    }
  }

  if (connected) {
    const permissions = connection.permissions ?? {};
    dom.connectionPermissions.textContent =
      permissions.can_view === true &&
      permissions.can_trade === false &&
      permissions.can_transfer === false
        ? "View yes · Trade no · Transfer no"
        : "View-only scope verified";
    dom.connectionVerifiedAt.textContent = formatConnectionTime(
      connection.verified_at,
    );
    dom.connectionExpiresAt.textContent = formatConnectionTime(
      connection.absolute_expires_at ?? connection.idle_expires_at,
    );
  } else if (state.selectedMode === "view_only_preflight") {
    setSelectedMode("dry_run");
  }

  if (announceChange) {
    announce(
      connected
        ? "View-only Coinbase data is connected for this local session. Dry run remains the default."
        : "Coinbase disconnected and the in-memory key was erased. Dry run remains available.",
    );
  }
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
    const artifact = button.closest(".artifact");
    artifact?.classList.add("is-stale");
    for (const input of artifact?.querySelectorAll("[data-mandate-mode]") ?? []) {
      input.disabled = true;
      input.dataset.guardLocked = "true";
      input.setAttribute("aria-disabled", "true");
    }
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
  setSelectedMode("dry_run");
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
  let selectedMode = () => "dry_run";
  if (state.connection?.connected === true) {
    const modePicker = element("fieldset", {
      className: "check-mode-picker",
    });
    modePicker.append(
      element("legend", {
        text: "Choose one protected check",
      }),
    );
    const choiceName = `check-mode-${++state.modeChoiceSequence}`;
    const dryRunRadio = element("input", {
      attributes: {
        type: "radio",
        name: choiceName,
        value: "dry_run",
        checked: "",
        "data-mandate-mode": "dry_run",
        "data-action-control": "guard",
      },
    });
    const viewOnlyRadio = element("input", {
      attributes: {
        type: "radio",
        name: choiceName,
        value: "view_only_preflight",
        "data-mandate-mode": "view_only_preflight",
        "data-action-control": "guard",
      },
    });
    const dryRunChoice = element("label", {
      className: "check-mode-choice",
    });
    const dryRunCopy = element("span");
    dryRunCopy.append(
      element("strong", { text: "Dry run" }),
      element("small", {
        text: "Use labeled simulated facts; Coinbase is not contacted.",
      }),
    );
    dryRunChoice.append(dryRunRadio, dryRunCopy);
    const viewOnlyChoice = element("label", {
      className: "check-mode-choice",
    });
    const viewOnlyCopy = element("span");
    viewOnlyCopy.append(
      element("strong", { text: "View-only preflight" }),
      element("small", {
        text: "Read fresh Coinbase balance, product, market, and one exact Preview. Preview is not an execution or price guarantee.",
      }),
    );
    viewOnlyChoice.append(viewOnlyRadio, viewOnlyCopy);
    modePicker.append(dryRunChoice, viewOnlyChoice);
    selectedMode = () =>
      viewOnlyRadio.checked ? "view_only_preflight" : "dry_run";
    for (const radio of [dryRunRadio, viewOnlyRadio]) {
      radio.addEventListener("change", () => {
        const mode = selectedMode();
        setSelectedMode(mode);
        authorizeButton.textContent =
          mode === "view_only_preflight"
            ? "Authorize View-only preflight"
            : "Authorize dry-run check";
        announce(
          mode === "view_only_preflight"
            ? "View-only preflight selected for this mandate. Coinbase Preview is point in time; no order can be sent."
            : "Credential-free dry run selected for this mandate. Coinbase will not be contacted.",
        );
      });
    }
    footer.append(modePicker);
  } else {
    footer.append(
      element("p", {
        text: "Authorization permits one credential-free dry-run check only. Connect an optional View-only key to choose real Coinbase preflight data. It never authorizes an order.",
      }),
    );
  }
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
    void authorizePlan(planId, authorizeButton, selectedMode());
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
    state.connection?.connected === true
      ? "Mandate captured. Review every boundary, choose Dry run or View-only preflight, then authorize one check."
      : "Mandate captured. Review every boundary, then authorize one dry-run check.",
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

function recordMode(record) {
  return (
    record?.mode ??
    record?.guard_receipt?.mode ??
    record?.guard_mode ??
    record?.boundary?.mode ??
    "dry_run"
  );
}

function provenanceLabel(record) {
  const mode = recordMode(record);
  const checkedAt =
    record?.checked?.at ??
    record?.sources?.preview?.received_at ??
    record?.sources?.best_bid_ask?.observed_at ??
    record?.generated_at ??
    "time unavailable";
  if (mode === "view_only_preflight") {
    if (
      record?.source ===
      "COINBASE_VIEW_ONLY_READS_AND_PREVIEW"
    ) {
      return `Coinbase View-only balance, product, market, and Preview facts · checked ${checkedAt}`;
    }
    if (record?.boundary?.coinbase_contacted === true) {
      return `Coinbase View-only check was contacted but complete facts and Preview were not verified · checked ${checkedAt}`;
    }
    return `No Coinbase evidence was used; the requested View-only check could not start · checked ${checkedAt}`;
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
  const mode = recordMode(record);
  if (mode === "view_only_preflight") {
    return outcome === "PASS"
      ? "Coinbase View-only point-in-time preflight plus local deterministic Guard evaluation. Production Delta was not contacted. Preview is not an execution or price guarantee; no Create route, order, or money movement."
      : "View-only verification stopped safely without fallback. No execution grant, Create route, order, or money movement.";
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
  setSelectedMode(recordMode(record));
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

async function authorizePlan(planId, button, mode = "dry_run") {
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
  if (!["dry_run", "view_only_preflight"].includes(mode)) {
    addError(
      "Choose one supported check mode before authorizing. Nothing was submitted.",
    );
    return;
  }
  if (
    mode === "view_only_preflight" &&
    state.connection?.connected !== true
  ) {
    addError(
      "The View-only session is not connected. Reconnect or explicitly choose Dry run; the Guard will not fall back automatically.",
    );
    return;
  }
  invalidateMandateAuthorizations("Authorization used");
  state.currentPlan = null;
  setSelectedMode(mode);
  addMessage(
    "user",
    mode === "view_only_preflight"
      ? "Authorize this mandate for one protected View-only preflight."
      : "Authorize this mandate for one protected dry-run check.",
    "This authorizes evaluation only · not an order",
  );
  setGuardStep("proposal");
  await runPending(button, "Checking exact proposal…", async () => {
    try {
      const response = await requestJson("/api/advisor/authorize", {
        method: "POST",
        body: { plan_id: planId, mode },
      });
      setGuardStep("decision");
      renderResult(response?.result ?? response);
      if (mode === "view_only_preflight") {
        await loadConnection();
      }
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

function conditionalInput() {
  const expirySeconds = Number(
    dom.conditionalExpiry.value,
  );
  if (
    ![3_600, 86_400, 604_800].includes(expirySeconds)
  ) {
    throw new Error(
      "Choose a supported plan duration: 1 hour, 24 hours, or 7 days.",
    );
  }
  const expiry = new Date(
    Date.now() + expirySeconds * 1_000,
  );
  if (!Number.isFinite(expiry.getTime())) {
    throw new Error("Choose a valid future plan expiry.");
  }
  const timezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!timezone) {
    throw new Error(
      "Your browser timezone could not be resolved safely.",
    );
  }
  dom.conditionalTimezone.value = timezone;
  return {
    product_id: dom.conditionalProduct.value
      .trim()
      .toUpperCase(),
    side: dom.conditionalSide.value,
    size_value: dom.conditionalSize.value.trim(),
    threshold_value:
      dom.conditionalThreshold.value.trim(),
    max_slippage_bps: Number(
      dom.conditionalSlippage.value,
    ),
    max_fee_value: dom.conditionalFee.value.trim(),
    timezone,
    expires_at: expiry.toISOString(),
  };
}

function updateConditionalSideCopy() {
  const buy = dom.conditionalSide.value === "BUY";
  dom.conditionalConditionLabel.textContent = buy
    ? "Fresh best ask is at or below"
    : "Fresh best bid is at or above";
}

function setConditionalDefaults() {
  dom.conditionalExpiry.value = "86400";
  const zone =
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (zone) dom.conditionalTimezone.value = zone;
  updateConditionalSideCopy();
}

function conditionalFact(
  label,
  value,
  className = "",
) {
  const wrapper = element("div", {
    className: `conditional-fact ${className}`.trim(),
  });
  wrapper.append(
    element("span", { text: label }),
    element("strong", { text: value }),
  );
  return wrapper;
}

function conditionalMandateRibbon(plan) {
  const template = plan.template;
  const ribbon = element("div", {
    className: "conditional-summary-ribbon",
    attributes: {
      "aria-label": "Saved conditional mandate",
    },
  });
  ribbon.append(
    conditionalFact(
      "Action",
      `${titleCase(template.side)} up to ${plainNumber(template.size.value)} ${template.size.asset} on ${template.product_id}`,
    ),
    conditionalFact(
      "If",
      `${template.condition.reference === "BEST_ASK" ? "Fresh best ask" : "Fresh best bid"} ${template.condition.operator === "LTE" ? "≤" : "≥"} ${plainNumber(template.condition.value)} ${template.condition.asset}`,
    ),
    conditionalFact(
      "Limits",
      `${template.limits.max_slippage_bps} bps slippage · ${plainNumber(template.limits.max_fee.value)} ${template.limits.max_fee.asset} fee`,
    ),
    conditionalFact(
      "Until",
      `${new Date(template.expires_at).toLocaleString(undefined, {
        timeZone: template.timezone,
        timeZoneName: "short",
      })} local time · ${template.timezone}`,
    ),
  );
  return ribbon;
}

function conditionalHeader(saved, subtitle) {
  const header = element("div", {
    className: "artifact__header",
  });
  const group = element("div");
  group.append(
    element("p", {
      className: "eyebrow",
      text: `SAVED PLAN · REVISION ${saved.plan.revision}`,
    }),
    element("h2", {
      text: "Your condition is now an enforceable simulation boundary.",
    }),
    element("p", { text: subtitle }),
  );
  header.append(
    group,
    element("span", {
      className: "artifact-badge",
      text: saved.session_state.replaceAll("_", " "),
    }),
  );
  return header;
}

function conditionalRevokeButton(saved) {
  const button = element("button", {
    className: "button button--secondary button--danger",
    text: "Revoke this revision",
    attributes: {
      type: "button",
      "data-action-control": "guard",
      "data-safety-action": "true",
    },
  });
  button.addEventListener("click", () => {
    void revokeConditional(saved, button);
  });
  return button;
}

function scenarioPicker(idSuffix, { disabled = false } = {}) {
  const fieldset = element("fieldset", {
    className: "scenario-picker",
  });
  fieldset.append(
    element("legend", {
      text: "Fixture rehearsal",
    }),
  );
  const scenarios = [
    [
      "not_met",
      "Condition not met",
      "One BBO observation stops before a proposal.",
    ],
    [
      "block",
      "Agent exceeds limit",
      "A proposal outside the saved maximum is blocked.",
    ],
    [
      "pass",
      "Exact proposal fits",
      "A bound local receipt verifies; execution stays locked.",
    ],
  ];
  for (const [value, title, copy] of scenarios) {
    const label = element("label", {
      className: "scenario-choice",
    });
    const input = element("input", {
      attributes: {
        type: "radio",
        name: `conditional-scenario-${idSuffix}`,
        value,
        ...(value === "block" ? { checked: "" } : {}),
        ...(disabled ? { disabled: "" } : {}),
      },
    });
    const text = element("span");
    text.append(
      element("strong", { text: title }),
      element("small", { text: copy }),
    );
    label.append(input, text);
    fieldset.append(label);
  }
  return fieldset;
}

function selectedScenario(container) {
  return (
    container.querySelector(
      'input[type="radio"][name^="conditional-scenario-"]:checked',
    )?.value ?? "pass"
  );
}

function renderConditionalReady(saved) {
  state.conditionalPlan = saved;
  dom.conditionalOutput.replaceChildren();
  const artifact = element("section", {
    className: "artifact conditional-artifact",
  });
  artifact.append(
    conditionalHeader(
      saved,
      "The template is saved in this local session, but it cannot watch, trade, or authorize a future check by itself.",
    ),
    conditionalMandateRibbon(saved.plan),
    element("div", {
      className: "no-order-banner",
      text: "SIMULATION ONLY · NOTHING IS WATCHING · NO ORDER SUBMITTED",
    }),
  );

  const controls = element("div", {
    className: "conditional-check-controls",
  });
  const source = element("fieldset", {
    className: "source-picker",
  });
  source.append(
    element("legend", {
      text: "Choose the source for one fresh check",
    }),
  );
  const fixtureLabel = element("label", {
    className: "source-choice",
  });
  const fixtureInput = element("input", {
    attributes: {
      type: "radio",
      name: `conditional-source-${saved.plan.plan_id}-${saved.plan.revision}`,
      value: "fixture",
      checked: "",
    },
  });
  const fixtureCopy = element("span");
  fixtureCopy.append(
    element("strong", { text: "Labeled fixture" }),
    element("small", {
      text: "No credential or network. Rehearse condition-not-met, BLOCK, or PASS.",
    }),
  );
  fixtureLabel.append(fixtureInput, fixtureCopy);

  const viewLabel = element("label", {
    className: "source-choice",
  });
  const viewInput = element("input", {
    attributes: {
      type: "radio",
      name: `conditional-source-${saved.plan.plan_id}-${saved.plan.revision}`,
      value: "view_only",
      ...(state.connection?.connected === true
        ? {}
        : { disabled: "" }),
    },
  });
  viewInput.dataset.conditionalViewSource = "true";
  const viewCopy = element("span");
  viewCopy.append(
    element("strong", { text: "One View-only check" }),
    element("small", {
      text:
        state.connection?.connected === true
          ? "Rechecks permission, product, and one fresh BBO. No fixture fallback."
          : "Connect a View-only key first. Dry fixtures remain available.",
    }),
  );
  viewLabel.append(viewInput, viewCopy);
  source.append(fixtureLabel, viewLabel);

  const scenario = scenarioPicker(
    `${saved.plan.plan_id}-${saved.plan.revision}`,
  );
  const syncScenario = () => {
    const viewSelected = viewInput.checked;
    scenario.hidden = viewSelected;
    for (const input of scenario.querySelectorAll("input")) {
      input.disabled = viewSelected;
    }
  };
  fixtureInput.addEventListener("change", syncScenario);
  viewInput.addEventListener("change", syncScenario);

  const actions = element("div", {
    className: "conditional-actions",
  });
  const authorize = element("button", {
    className: "button button--primary",
    text: "Authorize one simulation check",
    attributes: {
      type: "button",
      "data-action-control": "guard",
    },
  });
  authorize.addEventListener("click", () => {
    const selectedSource =
      source.querySelector('input[type="radio"]:checked')
        ?.value ?? "fixture";
    void authorizeConditional(
      saved,
      selectedSource,
      selectedSource === "view_only"
        ? "pass"
        : selectedScenario(scenario),
      authorize,
    );
  });
  actions.append(authorize, conditionalRevokeButton(saved));
  controls.append(source, scenario, actions);
  artifact.append(controls);
  dom.conditionalOutput.append(artifact);
  reveal(artifact, { focus: true });
  announce(
    "Conditional mandate saved. Choose one evidence source, then authorize one simulation check. Nothing is watching.",
  );
}

function renderConditionalAuthorized(saved, scenario) {
  state.conditionalPlan = saved;
  dom.conditionalOutput.replaceChildren();
  const artifact = element("section", {
    className: "artifact conditional-artifact",
  });
  artifact.append(
    conditionalHeader(
      saved,
      "One short-lived simulation authorization is ready. The server will consume it before reading any evidence.",
    ),
    conditionalMandateRibbon(saved.plan),
    element("div", {
      className: "authorization-callout",
      text: `${saved.authorization.source === "view_only" ? "View-only source" : "Labeled fixture"} · one use · expires ${new Date(saved.authorization.expires_at).toLocaleTimeString()} · not a future or live authorization`,
    }),
  );
  const actions = element("div", {
    className: "conditional-actions",
  });
  const simulate = element("button", {
    className: "button button--primary",
    text:
      saved.authorization.source === "view_only"
        ? "Run one fresh View-only check"
        : "Run this fixture rehearsal",
    attributes: {
      type: "button",
      "data-action-control": "guard",
    },
  });
  simulate.addEventListener("click", () => {
    void simulateConditional(saved, scenario, simulate);
  });
  actions.append(simulate, conditionalRevokeButton(saved));
  artifact.append(
    actions,
    element("div", {
      className: "no-order-banner",
      text: "AUTHORIZED FOR SIMULATION ONLY · NO WATCHER · ORDERS OFF",
    }),
  );
  dom.conditionalOutput.append(artifact);
  reveal(artifact, { focus: true });
  announce(
    "One-check simulation authorization ready. It is not a live authorization and no order can be sent.",
  );
}

function timelineLabel(item, result) {
  const priceBoundary =
    result.proposal?.side === "SELL"
      ? "price floor"
      : "price ceiling";
  const labels = {
    PLAN: `Saved plan revision ${result.plan_revision}`,
    SIMULATION_AUTHORIZATION: `One-check authorization · ${result.evidence?.source ?? "selected source"}`,
    EVIDENCE: `Evidence · ${result.evidence?.observed_at ? new Date(result.evidence.observed_at).toLocaleTimeString() : "unable to verify"}`,
    ABSOLUTE_TRIGGER: "Absolute BBO condition checked",
    OBSERVED_SLIPPAGE_BOUND: result.proposal
      ? `Effective ${priceBoundary} · ${plainNumber(result.proposal.slippage_reference_price)} → ${plainNumber(result.proposal.observed_slippage_bound)} → ${plainNumber(result.proposal.authorized_limit_price)}`
      : "No price bound prepared",
    EXACT_PROPOSAL: result.proposal
      ? "Exact simulated proposal prepared"
      : "No proposal prepared",
    LOCAL_DELTA_SIMULATION: `Local Delta simulation · ${result.decision}`,
    VERIFIED_RECEIPT:
      result.receipt?.verified === true
        ? "Receipt verified locally"
        : "Receipt unavailable",
    EXECUTION: "LOCKED · no order submitted",
  };
  return labels[item.step] ?? titleCase(item.step);
}

function conditionalProposalCard(saved, result) {
  if (!result.proposal) return null;
  const proposal = result.proposal;
  const template = saved.plan.template;
  const sell = proposal.side === "SELL";
  const quoteAsset = template.condition.asset;
  const priceBoundary = sell ? "floor" : "ceiling";
  const reference = sell ? "best bid" : "best ask";
  const effectiveLabel = sell
    ? "Effective minimum price"
    : "Effective maximum price";
  const card = element("section", {
    className: "exact-proposal-card",
    attributes: {
      "aria-label": "Exact simulated proposal",
    },
  });
  card.append(
    element("div", {
      className: "exact-proposal-card__header",
    }),
  );
  card.firstElementChild.append(
    element("div", {
      className: "eyebrow",
      text: "EXACT SIMULATED PROPOSAL",
    }),
    element("h3", {
      text: `${titleCase(proposal.side)} ${proposal.product_id}`,
    }),
    element("p", {
      text: "This exact price decision—not an agent’s claimed slippage—is what the local guard evaluated.",
    }),
  );

  const economics = element("div", {
    className: "exact-proposal-card__economics",
  });
  economics.append(
    conditionalFact(
      "Order type",
      proposal.order_type.replaceAll("_", " "),
    ),
    conditionalFact(
      "Size",
      `${plainNumber(proposal.size.value)} ${proposal.size.asset}`,
    ),
    conditionalFact(
      "Limit price",
      `${plainNumber(proposal.limit_price)} ${quoteAsset}`,
    ),
    conditionalFact(
      "Maximum fee",
      `${plainNumber(proposal.estimated_fee.value)} ${proposal.estimated_fee.asset}`,
    ),
  );
  card.append(economics);

  const priceChain = element("div", {
    className: "price-bound-chain",
    attributes: {
      "aria-label": `${titleCase(proposal.side)} price constraint calculation`,
    },
  });
  priceChain.append(
    conditionalFact(
      `Observed ${reference}`,
      `${plainNumber(proposal.slippage_reference_price)} ${quoteAsset}`,
    ),
    conditionalFact(
      `Raw slippage ${priceBoundary}`,
      `${plainNumber(proposal.observed_slippage_bound)} ${quoteAsset} · ${proposal.max_slippage_bps} bps`,
    ),
    conditionalFact(
      effectiveLabel,
      `${plainNumber(proposal.authorized_limit_price)} ${quoteAsset} · tighter of the absolute condition and slippage ${priceBoundary}`,
      "is-effective",
    ),
  );
  card.append(priceChain);
  return card;
}

function renderConditionalResult(
  saved,
  result,
  { completedBeforeCancellation = false } = {},
) {
  state.conditionalPlan = saved;
  dom.conditionalOutput.replaceChildren();
  const artifact = element("section", {
    className: "artifact conditional-artifact",
  });
  const stateCopy = {
    CONDITION_NOT_MET:
      "Condition not met · the check stopped before a proposal",
    BLOCKED: "BLOCK · the proposal is outside the saved mandate",
    WOULD_TRIGGER_SIMULATION:
      "PASS · this exact simulated proposal fits the mandate",
    REVIEW:
      "REVIEW · the selected source could not be verified",
  }[result.state] ?? titleCase(result.state);
  artifact.append(
    conditionalHeader(saved, stateCopy),
    conditionalMandateRibbon(saved.plan),
    element("p", {
      className: "decision-reason",
      text: result.reason,
    }),
    element("div", {
      className: "no-order-banner",
      text: "NO ORDER SUBMITTED · EXECUTION LOCKED",
    }),
  );
  if (completedBeforeCancellation) {
    artifact.append(
      element("p", {
        className: "notice notice--amber",
        text: "Check completed before cancellation reached the server. This is the completed exact result; no order was submitted.",
        attributes: { role: "status" },
      }),
    );
  }

  const evidence = element("div", {
    className: "conditional-evidence",
  });
  const evidenceView = conditionalEvidencePresentation(
    result.evidence,
  );
  evidence.append(
    conditionalFact(
      "Source",
      evidenceView.source,
    ),
    conditionalFact(
      "Observed",
      evidenceView.observed,
    ),
    conditionalFact(
      "BBO",
      evidenceView.bbo,
    ),
    conditionalFact(
      "Proposal",
      result.proposal
        ? `${titleCase(result.proposal.side)} ${plainNumber(result.proposal.size.value)} ${result.proposal.size.asset}`
        : "Not prepared",
    ),
  );
  artifact.append(evidence);
  const proposalCard = conditionalProposalCard(
    saved,
    result,
  );
  if (proposalCard) artifact.append(proposalCard);

  const timeline = element("ol", {
    className: "plan-timeline proof-timeline",
    attributes: {
      "aria-label": "Conditional simulation proof timeline",
    },
  });
  for (const item of result.timeline ?? []) {
    const row = element("li", {
      className:
        item.step === "EXECUTION"
          ? "is-locked"
          : "is-complete",
    });
    const copy = element("div");
    copy.append(
      element("strong", {
        text: timelineLabel(item, result),
      }),
      element("small", {
        text:
          item.step === "EXECUTION"
            ? "No Create route exists in this advisor."
            : item.step === "OBSERVED_SLIPPAGE_BOUND"
              ? "Observed reference → raw slippage bound → effective bound after the absolute condition."
            : "Bound to this one checked revision.",
      }),
    );
    row.append(element("span"), copy);
    timeline.append(row);
  }
  artifact.append(timeline);

  const details = element("details", {
    className: "details-panel",
  });
  details.append(
    element("summary", {
      text: "Technical proof details",
    }),
  );
  const list = element("dl", {
    className: "details-list",
  });
  for (const [label, value] of [
    ["Plan digest", saved.plan.plan_digest],
    ["Receipt digest", result.receipt?.receipt_digest],
    ["Proof class", result.receipt?.proof_class],
    ["Receipt verified", result.receipt?.verified],
  ]) {
    const row = element("div");
    row.append(
      element("dt", { text: label }),
      element("dd", { text: value ?? "Unavailable" }),
    );
    list.append(row);
  }
  details.append(list);
  artifact.append(details);

  const actions = element("div", {
    className: "conditional-actions",
  });
  const another = element("button", {
    className: "button button--secondary",
    text: "Prepare another one-check authorization",
    attributes: {
      type: "button",
      "data-action-control": "guard",
    },
  });
  another.addEventListener("click", () => {
    renderConditionalReady(saved);
  });
  actions.append(another, conditionalRevokeButton(saved));
  artifact.append(actions);
  dom.conditionalOutput.append(artifact);
  reveal(artifact, { focus: true });
  announce(`${stateCopy}. No order was submitted.`);
}

function conditionalEvidencePresentation(evidence) {
  const unavailable =
    evidence?.unavailable === true ||
    !evidence?.observed_at ||
    !evidence?.best_bid ||
    !evidence?.best_ask;
  if (evidence?.source === "view_only") {
    if (unavailable) {
      return Object.freeze({
        source: "Coinbase unavailable · unable to verify",
        observed: "Unable to verify",
        bbo: "Unavailable",
      });
    }
    return Object.freeze({
      source: "Coinbase observed · View only",
      observed: new Date(
        evidence.observed_at,
      ).toLocaleString(),
      bbo: `${plainNumber(evidence.best_bid)} bid · ${plainNumber(evidence.best_ask)} ask`,
    });
  }
  if (evidence?.source === "fixture") {
    return Object.freeze({
      source: unavailable
        ? "Generated fixture · unable to verify"
        : "Generated fixture · not Coinbase",
      observed: unavailable
        ? "Unable to verify"
        : new Date(
            evidence.observed_at,
          ).toLocaleString(),
      bbo: unavailable
        ? "Unavailable"
        : `${plainNumber(evidence.best_bid)} bid · ${plainNumber(evidence.best_ask)} ask`,
    });
  }
  return Object.freeze({
    source: "Evidence source unavailable · unable to verify",
    observed: "Unable to verify",
    bbo: "Unavailable",
  });
}

function renderConditionalCancelled(saved) {
  state.conditionalPlan = saved;
  dom.conditionalOutput.replaceChildren();
  const artifact = element("section", {
    className: "artifact conditional-artifact",
    attributes: { role: "status" },
  });
  artifact.append(
    conditionalHeader(
      saved,
      "REVIEW · the local server cancelled this one-check attempt and will discard any late result.",
    ),
    conditionalMandateRibbon(saved.plan),
    element("p", {
      className: "decision-reason",
      text: "The consumed simulation authorization cannot be reused. The saved template remains non-executable and can be checked only after a fresh authorization.",
    }),
    element("div", {
      className: "no-order-banner",
      text: "CANCELLED ON SERVER · LATE RESULT DISCARDED · ORDERS OFF",
    }),
  );
  const actions = element("div", {
    className: "conditional-actions",
  });
  const another = element("button", {
    className: "button button--secondary",
    text: "Prepare a fresh one-check authorization",
    attributes: {
      type: "button",
      "data-action-control": "guard",
    },
  });
  another.addEventListener("click", () => {
    renderConditionalReady(saved);
  });
  actions.append(another, conditionalRevokeButton(saved));
  artifact.append(actions);
  dom.conditionalOutput.append(artifact);
  reveal(artifact, { focus: true });
  announce(
    "The local server cancelled the one-check simulation and will discard any late result. No order was submitted.",
  );
}

async function saveConditional(event) {
  event.preventDefault();
  if (state.pending) {
    announce(
      "A protected check is already running. The saved plan was not changed.",
    );
    return;
  }
  let input;
  try {
    input = conditionalInput();
  } catch (error) {
    addError(error.message, dom.conditionalOutput);
    return;
  }
  await runPending(
    dom.conditionalSaveButton,
    "Saving boundary…",
    async () => {
      try {
        const current = state.conditionalPlan;
        const revisable =
          current?.plan?.plan_id &&
          !["REVOKED", "EXPIRED"].includes(
            current.session_state,
          );
        const response = await requestJson(
          revisable
            ? "/api/conditional/revise"
            : "/api/conditional/plan",
          {
            method: "POST",
            body: revisable
              ? {
                  plan_id: current.plan.plan_id,
                  revision: current.plan.revision,
                  patch: input,
                }
              : input,
          },
        );
        renderConditionalReady(response.saved_plan);
      } catch (error) {
        dom.conditionalOutput.replaceChildren();
        addError(
          error instanceof Error
            ? error.message
            : "The conditional boundary could not be saved. Nothing is watching and no order was submitted.",
          dom.conditionalOutput,
        );
      }
    },
  );
}

async function authorizeConditional(
  saved,
  source,
  scenario,
  button,
) {
  if (state.pending) return;
  await runPending(
    button,
    "Authorizing one check…",
    async () => {
      try {
        const response = await requestJson(
          "/api/conditional/authorize",
          {
            method: "POST",
            body: {
              plan_id: saved.plan.plan_id,
              revision: saved.plan.revision,
              source,
              ttl_seconds: 120,
            },
          },
        );
        renderConditionalAuthorized(
          response.saved_plan,
          scenario,
        );
      } catch (error) {
        addError(
          error instanceof Error
            ? error.message
            : "The one-check simulation authorization stopped safely.",
          dom.conditionalOutput,
        );
      }
    },
  );
}

async function simulateConditional(
  saved,
  scenario,
  button,
) {
  if (state.pending) return;
  await runPending(
    button,
    "Checking once…",
    async () => {
      const cancellation = {
        kind: "conditional_simulation",
        plan_id: saved.plan.plan_id,
        revision: saved.plan.revision,
        authorization_id:
          saved.authorization.authorization_id,
        confirmed: false,
      };
      state.pendingCancellation = cancellation;
      try {
        const response = await requestJson(
          "/api/conditional/simulate",
          {
            method: "POST",
            body: {
              plan_id: saved.plan.plan_id,
              revision: saved.plan.revision,
              authorization_id:
                saved.authorization.authorization_id,
              scenario,
            },
          },
        );
        if (
          cancellation.confirmed ||
          cancellation.completedBeforeCancellation
        ) {
          return;
        }
        if (
          state.conditionalPlan?.plan?.plan_id ===
            saved.plan.plan_id &&
          state.conditionalPlan?.session_state ===
            "REVOKED"
        ) {
          announce(
            "The revision was revoked. A late simulation result was discarded.",
          );
          return;
        }
        renderConditionalResult(
          response.saved_plan,
          response.result,
        );
      } catch (error) {
        if (
          cancellation.confirmed ||
          cancellation.completedBeforeCancellation
        ) {
          return;
        }
        if (
          state.conditionalPlan?.plan?.plan_id ===
            saved.plan.plan_id &&
          state.conditionalPlan?.session_state ===
            "REVOKED"
        ) {
          announce(
            "The revision remains revoked. No late result was shown.",
          );
          return;
        }
        addError(
          error instanceof Error
            ? error.message
            : "The one-check simulation stopped safely. Nothing is watching and no order was submitted.",
          dom.conditionalOutput,
        );
      } finally {
        if (state.pendingCancellation === cancellation) {
          state.pendingCancellation = null;
        }
      }
    },
  );
}

async function revokeConditional(saved, button) {
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = "Revoking…";
  try {
    const response = await requestSafetyJson(
      "/api/conditional/revoke",
      {
        plan_id: saved.plan.plan_id,
        revision: saved.plan.revision,
      },
    );
    state.conditionalPlan = response.saved_plan;
    const revoked = element("section", {
      className: "artifact conditional-artifact",
      attributes: { role: "status" },
    });
    revoked.append(
      conditionalHeader(
        response.saved_plan,
        "This revision is tombstoned. Any in-flight or later result is invalid and cannot revive it.",
      ),
      conditionalMandateRibbon(response.saved_plan.plan),
      element("div", {
        className: "no-order-banner",
        text: "REVOKED · NOTHING IS WATCHING · ORDERS OFF",
      }),
    );
    dom.conditionalOutput.replaceChildren(revoked);
    reveal(revoked, { focus: true });
    announce(
      "Conditional plan revision revoked. Any in-flight result is discarded.",
    );
  } catch (error) {
    button.disabled = false;
    button.textContent = "Revoke this revision";
    addError(
      error instanceof Error
        ? error.message
        : "The revoke request stopped safely.",
      dom.conditionalOutput,
    );
  }
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
    const viewOnly = entry?.mode === "view_only_preflight";
    summary.append(
      element("h2", { text: activityMandate(entry) }),
      element("p", {
        text:
          entry?.reason ??
          entry?.receipt?.decision?.reason ??
          "Redacted Guard decision",
      }),
      element("p", {
        text: viewOnly
          ? "Redacted normalized facts · credential never retained in history · no order submitted"
          : "Labeled simulated facts · no credential used · no order submitted",
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
    dom.conditionalProduct.focus();
    announce(
      "Conditional plan composer ready. Nothing is monitoring or trading.",
    );
  } else {
    explainFutureCapability(start);
  }
}

async function loadConnection({ reportFailure = false } = {}) {
  if (!state.connectionLoaded) {
    showConnectionProgress(
      "Checking this local session. No credential is sent by this status check.",
    );
  }
  try {
    const payload = await requestJson("/api/connection");
    applyConnectionStatus(payload);
    clearConnectionFeedback();
    return payload;
  } catch (error) {
    state.connectionLoaded = true;
    state.connection = { connected: false };
    applyConnectionStatus(state.connection);
    if (reportFailure) {
      clearConnectionFeedback();
      addError(
        error instanceof Error
          ? error.message
          : "The local View-only connection status is unavailable. Dry run remains available.",
        dom.connectionFeedback,
      );
    }
    return null;
  } finally {
    hideConnectionProgress();
  }
}

async function connectViewOnly(event) {
  event.preventDefault();
  if (state.pending) {
    announce(
      "Another protected check is running. No connection or mandate was changed.",
    );
    return null;
  }

  const name = dom.coinbaseKeyName.value.trim();
  const privateKey = dom.coinbasePrivateKey.value;
  dom.coinbaseKeyName.value = "";
  dom.coinbasePrivateKey.value = "";
  clearConnectionFeedback();

  if (!name || !privateKey) {
    addError(
      "Enter both the full Coinbase API key name and its EC private key. The fields have been cleared; nothing was stored.",
      dom.connectionFeedback,
    );
    dom.coinbaseKeyName.focus();
    return null;
  }

  showConnectionProgress(
    "Testing View-only permission with Coinbase. Trade and Transfer must both be off. No order can be sent.",
  );
  return runPending(
    dom.connectButton,
    "Testing View only…",
    async () => {
      try {
        const payload = await requestJson("/api/connection/connect", {
          method: "POST",
          body: { name, privateKey },
        });
        invalidateMandateAuthorizations("Connection changed");
        state.currentPlan = null;
        setSelectedMode("dry_run");
        applyConnectionStatus(payload, { announceChange: true });
        const success = element("p", {
          className: "notice notice--green",
          text: "Connection tested. View-only preflight is available for an explicitly selected mandate; Dry run remains the default. No order can be sent.",
          attributes: { role: "status" },
        });
        dom.connectionFeedback.replaceChildren(success);
        return payload;
      } catch (error) {
        addError(
          error instanceof Error
            ? error.message
            : "The View-only permission test stopped safely. The fields were cleared and no order was submitted.",
          dom.connectionFeedback,
        );
        return null;
      } finally {
        hideConnectionProgress();
      }
    },
  );
}

async function disconnectViewOnly() {
  if (state.pending) {
    announce(
      "Another protected check is running. The connection was not changed.",
    );
    return null;
  }
  clearConnectionFeedback();
  showConnectionProgress(
    "Erasing the Coinbase credential reference from this local session…",
  );
  return runPending(
    dom.disconnectButton,
    "Disconnecting safely…",
    async () => {
      try {
        const payload = await requestJson("/api/connection/disconnect", {
          method: "POST",
          body: {},
        });
        invalidateMandateAuthorizations("Connection changed");
        state.currentPlan = null;
        setSelectedMode("dry_run");
        applyConnectionStatus(payload, { announceChange: true });
        const success = element("p", {
          className: "notice notice--green",
          text: "Disconnected. The local session key reference was erased; credential-free Dry run remains available.",
          attributes: { role: "status" },
        });
        dom.connectionFeedback.replaceChildren(success);
        return payload;
      } catch (error) {
        addError(
          error instanceof Error
            ? error.message
            : "The local Guard could not confirm disconnection. Stop the local server to erase its process memory.",
          dom.connectionFeedback,
        );
        return null;
      } finally {
        hideConnectionProgress();
      }
    },
  );
}

async function loadStatus() {
  try {
    const payload = await requestJson("/api/status");
    const status = payload?.status ?? payload;
    setSelectedMode("dry_run");
    dom.orderStatus.textContent = "Orders off";
    dom.serviceStatus.textContent =
      status?.ready === false
        ? "Local Guard status: limited"
        : "Local Guard status: ready";
  } catch {
    setSelectedMode("dry_run");
    dom.orderStatus.textContent = "Orders off";
    dom.serviceStatus.textContent = "Local Guard status: unavailable";
  }
}

for (const tab of dom.navTabs) {
  tab.addEventListener("click", () => {
    navigate(tab.dataset.viewTarget);
    if (tab.dataset.viewTarget === "connection") {
      void loadConnection({ reportFailure: true });
    }
  });
}

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const cancel = event.target.closest("[data-cancel-pending]");
  if (!cancel || !state.pending) return;
  void cancelPendingOperation(cancel);
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

dom.reviewButton.addEventListener("click", () => {
  void runReviewDemo(dom.reviewButton);
});

dom.refreshActivityButton.addEventListener("click", () => {
  void loadActivity();
});

dom.connectionForm.addEventListener("submit", (event) => {
  void connectViewOnly(event);
});

dom.disconnectButton.addEventListener("click", () => {
  void disconnectViewOnly();
});

dom.conditionalForm.addEventListener("submit", (event) => {
  void saveConditional(event);
});

dom.conditionalSide.addEventListener(
  "change",
  updateConditionalSideCopy,
);

setConditionalDefaults();
void Promise.all([loadStatus(), loadConnection()]);
