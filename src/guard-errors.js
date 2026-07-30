export class GuardDecisionError extends Error {
  constructor(
    decision,
    code,
    message,
    {
      stage = "PRE_EXECUTION_GATE",
      recovery = null,
      httpStatus = null,
      retryable = false,
    } = {},
  ) {
    super(message);
    this.name = "GuardDecisionError";
    this.decision = decision;
    this.code = code;
    this.stage = stage;
    this.recovery = recovery;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

export function reviewError(code, message, options = {}) {
  return new GuardDecisionError("REVIEW", code, message, {
    recovery:
      options.recovery ??
      "Refresh the evidence and retry the preflight. No order was submitted.",
    retryable: options.retryable ?? true,
    ...options,
  });
}

export function blockError(code, message, options = {}) {
  return new GuardDecisionError("BLOCK", code, message, {
    recovery:
      options.recovery ??
      "Change the proposal or authorize a new mandate. The blocked proposal cannot be released.",
    retryable: false,
    ...options,
  });
}

export function toGuardReviewError(error, source) {
  if (error instanceof GuardDecisionError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const status = Number.isInteger(error?.httpStatus)
    ? error.httpStatus
    : null;
  let code = `${source}_UNAVAILABLE`;
  if (status === 401 || status === 403) code = `${source}_CREDENTIAL_REJECTED`;
  else if (status === 429) code = `${source}_RATE_LIMITED`;
  else if (error?.name === "TimeoutError" || /timed? ?out|timeout/i.test(message)) {
    code = `${source}_TIMEOUT`;
  } else if (/invalid json|malformed|omitted|missing|contradict/i.test(message)) {
    code = `${source}_MALFORMED`;
  }
  return reviewError(code, message, {
    httpStatus: status,
    retryable: status == null || status === 429 || status >= 500,
  });
}
