function canonicalDecimal(value) {
  const [integerPart, fractionalPart = ""] = value.split(".");
  const integer = integerPart.replace(/^0+(?=\d)/, "");
  const fraction = fractionalPart.replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer;
}

function occurrences(intent, definition) {
  const matches = [];
  const expression = new RegExp(
    definition.expression.source,
    definition.expression.flags,
  );
  for (const match of intent.matchAll(expression)) {
    if (definition.include && !definition.include(intent, match)) continue;
    matches.push({
      index: match.index,
      quote: match[0],
      value: definition.normalize(match),
    });
  }
  return matches;
}

function isAffirmativeSide(intent, match) {
  const prefix = intent.slice(Math.max(0, match.index - 16), match.index);
  return !/\b(?:do\s+not|never)\s*$/i.test(prefix);
}

function normalizeOrderType(match) {
  const quote = match[0].toLowerCase();
  if (quote.includes("ioc")) return "SOR_LIMIT_IOC";
  if (quote.includes("gtc")) return "GTC_LIMIT";
  return "MARKET";
}

function normalizePartialFill(match) {
  const quote = match[0].toLowerCase();
  return quote.includes("not acceptable") || quote.includes("full fill")
    ? "REQUIRE_FULL"
    : "ALLOW";
}

function normalizeUseCount(match) {
  const quote = match[0].toLowerCase();
  return quote === "twice" || quote.startsWith("two ") ? "2" : "1";
}

const MATERIAL_CONSTRAINTS = Object.freeze([
  {
    field: "policy.size.value",
    label: "exact order size",
    expression:
      /\b(?:use\s+)?exactly\s+(\d+(?:\.\d+)?)\s+([A-Z0-9]{2,12})\b/gi,
    normalize: (match) =>
      `${canonicalDecimal(match[1])} ${match[2].toUpperCase()}`,
    policyValue: (policy) =>
      `${canonicalDecimal(policy.size.value)} ${policy.size.asset.toUpperCase()}`,
  },
  {
    field: "policy.product_id",
    label: "Coinbase product",
    expression: /\b([A-Z0-9]{2,12})-([A-Z0-9]{2,12})\b/gi,
    include: (_intent, match) =>
      match[0].toLocaleLowerCase("en-US") !== "price-bounded",
    normalize: (match) =>
      `${match[1].toUpperCase()}-${match[2].toUpperCase()}`,
    policyValue: (policy) => policy.product_id,
  },
  {
    field: "policy.side",
    label: "order side",
    expression: /\b(buy|sell)\b/gi,
    include: isAffirmativeSide,
    normalize: (match) => match[1].toUpperCase(),
    policyValue: (policy) => policy.side,
  },
  {
    field: "policy.order_type",
    label: "order type",
    expression:
      /\b(?:(?:price-bounded\s+)?IOC\s+limit\s+order|GTC\s+limit\s+order|market\s+order)\b/gi,
    normalize: normalizeOrderType,
    policyValue: (policy) => policy.order_type,
  },
  {
    field: "policy.partial_fill_policy",
    label: "partial-fill policy",
    expression:
      /\b(?:partial fill(?:s)? (?:is|are) (?:not )?acceptable|full fill (?:is )?required)\b/gi,
    normalize: normalizePartialFill,
    policyValue: (policy) => policy.partial_fill_policy,
  },
  {
    field: "policy.limits.max_slippage_bps",
    label: "slippage cap",
    expression:
      /\b(?:do not pay|never pay|not)\s+more than\s+(\d+)\s+bps\s+(above|below)\b/gi,
    normalize: (match) =>
      `${canonicalDecimal(match[1])}:${match[2].toUpperCase()}`,
    policyValue: (policy) =>
      `${policy.limits.max_slippage_bps}:${
        policy.side === "BUY" ? "ABOVE" : "BELOW"
      }`,
  },
  {
    field: "policy.limits.max_commission.value",
    label: "commission cap",
    expression:
      /(?:(?:do not (?:pay|spend)|never (?:pay|spend)|not)\s+)?more than\s+(\d+(?:\.\d+)?)\s+([A-Z0-9]{2,12})\s+in commission\b/gi,
    normalize: (match) =>
      `${canonicalDecimal(match[1])} ${match[2].toUpperCase()}`,
    policyValue: (policy) =>
      `${canonicalDecimal(policy.limits.max_commission.value)} ${policy.limits.max_commission.asset.toUpperCase()}`,
  },
  {
    field: "policy.limits.max_all_in_debit.value",
    label: "all-in debit cap",
    expression:
      /(?:(?:do not (?:pay|spend)|never (?:pay|spend)|not)\s+)?more than\s+(\d+(?:\.\d+)?)\s+([A-Z0-9]{2,12})\s+total\b/gi,
    normalize: (match) =>
      `${canonicalDecimal(match[1])} ${match[2].toUpperCase()}`,
    policyValue: (policy) =>
      `${canonicalDecimal(policy.limits.max_all_in_debit.value)} ${policy.limits.max_all_in_debit.asset.toUpperCase()}`,
  },
  {
    field: "policy.validity.ttl_seconds",
    label: "authorization expiry",
    expression:
      /\b(?:authorization\s+)?expires?\s+(\d+)\s+(seconds?|minutes?)\b/gi,
    normalize: (match) => {
      const value = Number(match[1]);
      return String(
        match[2].toLowerCase().startsWith("minute") ? value * 60 : value,
      );
    },
    policyValue: (policy) => String(policy.validity.ttl_seconds),
  },
  {
    field: "policy.usage.max_executions",
    label: "execution count",
    expression: /\b(?:once|twice|one\s+executions?|two\s+executions?)\b/gi,
    normalize: normalizeUseCount,
    policyValue: (policy) => String(policy.usage.max_executions),
  },
]);

export const MATERIAL_SOURCE_PATHS = Object.freeze(
  MATERIAL_CONSTRAINTS.map((definition) => definition.field),
);

export function findRepeatedMaterialConstraints(intent) {
  if (typeof intent !== "string") return [];
  const issues = [];
  for (const definition of MATERIAL_CONSTRAINTS) {
    const matches = occurrences(intent, definition);
    if (matches.length < 2) continue;
    const values = new Set(matches.map((match) => match.value));
    const conflicting = values.size > 1;
    issues.push({
      code: conflicting
        ? "CONFLICTING_MATERIAL_CONSTRAINT"
        : "DUPLICATE_MATERIAL_CONSTRAINT",
      source_text: matches.map((match) => match.quote).join(" | "),
      reason: conflicting
        ? `The ${definition.label} has conflicting source statements; v1 requires exactly one authorized value.`
        : `The ${definition.label} is stated more than once; v1 requires exactly one source statement even when the values match.`,
    });
  }
  return issues;
}

const NON_MATERIAL_LANGUAGE = new Set([
  "a",
  "after",
  "an",
  "and",
  "are",
  "as",
  "at",
  "by",
  "for",
  "from",
  "i",
  "in",
  "is",
  "it",
  "kindly",
  "like",
  "me",
  "my",
  "now",
  "of",
  "on",
  "or",
  "please",
  "that",
  "the",
  "this",
  "to",
  "use",
  "using",
  "want",
  "with",
  "would",
]);

const RECOGNIZED_LANGUAGE_PATTERNS = Object.freeze([
  /\busing my isolated Coinbase Advanced portfolio\b/gi,
  /\b(?:buy|sell)\s+(?:some\s+)?[A-Z0-9]{2,12}\b/gi,
  /\bCoinbase['’]s fresh best (?:ask|bid)\b/gi,
  /\bafter I confirm it\b/gi,
  /\b(?:some|up to|at most)\b/gi,
  /\$\d+(?:\.\d+)?\b/g,
]);

function markSpan(covered, start, length) {
  for (let index = start; index < start + length; index += 1) {
    covered[index] = true;
  }
}

function markMatches(covered, intent, expression) {
  const matcher = new RegExp(expression.source, expression.flags);
  for (const match of intent.matchAll(matcher)) {
    markSpan(covered, match.index, match[0].length);
  }
}

function containingClause(intent, index) {
  const boundaries = /[.!?;\n]/g;
  let start = 0;
  let end = intent.length;
  for (const match of intent.matchAll(boundaries)) {
    if (match.index < index) {
      start = match.index + match[0].length;
      continue;
    }
    end = match.index + match[0].length;
    break;
  }
  return intent.slice(start, end).trim();
}

export function findUnrecognizedConstraints(intent) {
  if (typeof intent !== "string") return [];
  const covered = Array(intent.length).fill(false);
  for (const definition of MATERIAL_CONSTRAINTS) {
    for (const match of occurrences(intent, definition)) {
      markSpan(covered, match.index, match.quote.length);
    }
  }
  for (const expression of RECOGNIZED_LANGUAGE_PATTERNS) {
    markMatches(covered, intent, expression);
  }

  const clauses = new Map();
  const tokens = /[A-Za-z][A-Za-z0-9'’-]*|\d+(?:\.\d+)?%?/g;
  for (const match of intent.matchAll(tokens)) {
    const token = match[0];
    const tokenIsCovered = [...token].every(
      (_, offset) => covered[match.index + offset],
    );
    if (tokenIsCovered) continue;
    if (NON_MATERIAL_LANGUAGE.has(token.toLowerCase())) continue;

    const sourceText = containingClause(intent, match.index);
    if (!clauses.has(sourceText)) {
      clauses.set(sourceText, {
        code: "UNRECOGNIZED_CONSTRAINT",
        source_text: sourceText,
        reason:
          "This clause is not represented in the v1 spot-order taxonomy and cannot be discarded.",
      });
    }
  }
  return [...clauses.values()];
}

export function findSourceConstraintIssues(intent) {
  return [
    ...findRepeatedMaterialConstraints(intent),
    ...findUnrecognizedConstraints(intent),
  ];
}

export function assertPolicyAndGroundingMatchSource(
  policy,
  grounding,
  sourceIntent,
) {
  for (const definition of MATERIAL_CONSTRAINTS) {
    const sourceMatches = occurrences(sourceIntent, definition);
    if (sourceMatches.length !== 1) {
      throw new Error(
        `source intent must contain exactly one ${definition.label} statement`,
      );
    }
    const sourceMatch = sourceMatches[0];
    const policyValue = definition.policyValue(policy);
    if (policyValue !== sourceMatch.value) {
      throw new Error(
        `${definition.field} does not match the source ${definition.label}`,
      );
    }

    const groundingItems = grounding.filter(
      (item) => item.field === definition.field,
    );
    if (groundingItems.length !== 1) {
      throw new Error(
        `${definition.field} must have exactly one grounding item`,
      );
    }
    const groundedMatches = occurrences(
      groundingItems[0].source_quote,
      definition,
    );
    if (
      groundedMatches.length !== 1 ||
      groundedMatches[0].value !== sourceMatch.value
    ) {
      throw new Error(
        `grounding quote for ${definition.field} does not correspond to its source constraint`,
      );
    }
  }
}
