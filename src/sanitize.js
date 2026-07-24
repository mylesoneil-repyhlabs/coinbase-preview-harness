const SENSITIVE_KEY = /(?:authorization|jwt|token|secret|private.?key|key.?id|account.?name|portfolio.?uuid)/i;
const PEM_BLOCK = /-----BEGIN[\s\S]+?-----END [^-]+-----/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const CDP_KEY_ID_PATTERN =
  /\borganizations\/[^/\s]+\/apiKeys\/[^/\s]+/gi;

function sanitizeString(value) {
  let output = value
    .replace(PEM_BLOCK, "[REDACTED_PEM]")
    .replace(JWT_PATTERN, "[REDACTED_JWT]")
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(CDP_KEY_ID_PATTERN, "[REDACTED_CDP_KEY_ID]");
  if (process.env.HOME) output = output.split(process.env.HOME).join("[REDACTED_HOME]");
  return output.slice(0, 8_192);
}

export function sanitize(value, seen = new WeakSet()) {
  if (typeof value === "string") return sanitizeString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => sanitize(item, seen));

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitize(item, seen);
  }
  return output;
}
