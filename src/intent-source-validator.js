function canonicalDecimal(value) {
  const [integerPart, fractionalPart = ""] = value.replaceAll(",", "").split(".");
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

const PRODUCT_EXPRESSION =
  /\b(?:([A-Z0-9]{2,12})[-/]([A-Z0-9]{2,12})|(?:buy|sell)\s+(?:(?:exactly|up to|at most)\s+\$?\s*(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s+(?:[A-Z0-9]{2,12}\s+of\s+)?)*([A-Z0-9]{2,12})\s+(?:with|for)\s+([A-Z0-9]{2,12}))\b/gi;

const MATERIAL_CONSTRAINTS = Object.freeze([
  {
    field: "policy.size.value",
    label: "order size bound",
    expression:
      /\b((?:use\s+)?exactly|(?:use\s+)?up to|at most)\s+\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s+([A-Z0-9]{2,12})\b/gi,
    normalize: (match) =>
      `${/exactly/i.test(match[1]) ? "EXACT" : "MAX"}:${canonicalDecimal(match[2])} ${match[3].toUpperCase()}`,
    policyValue: (policy) =>
      `${policy.size.operator}:${canonicalDecimal(policy.size.value)} ${policy.size.asset.toUpperCase()}`,
  },
  {
    field: "policy.product_id",
    label: "Coinbase product",
    expression: PRODUCT_EXPRESSION,
    include: (_intent, match) =>
      match[0].toLocaleLowerCase("en-US") !== "price-bounded",
    normalize: (match) =>
      `${(match[1] ?? match[3]).toUpperCase()}-${(
        match[2] ?? match[4]
      ).toUpperCase()}`,
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
      /\b(?:(?:price[- ]bounded\s+)?IOC\s+limit\s+order|GTC\s+limit\s+order|market\s+order)\b/gi,
    normalize: normalizeOrderType,
    policyValue: (policy) => policy.order_type,
  },
  {
    field: "policy.partial_fill_policy",
    label: "partial-fill policy",
    expression:
      /\b(?:partial fill(?:s)? (?:(?:is|are) )?(?:not )?(?:acceptable|allowed)|allow partial fills?|full fill (?:is )?required)\b/gi,
    normalize: normalizePartialFill,
    policyValue: (policy) => policy.partial_fill_policy,
  },
  {
    field: "policy.limits.max_slippage_bps",
    label: "slippage cap",
    expression:
      /\b(?:do not (?:pay|accept)|never (?:pay|accept)|not)\s+more than\s+(\d+)\s+bps\s+(above|below)\b/gi,
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
      /(?:(?:(?:do not|never)\s+)?(?:pay|spend)\s+|not\s+)?more than\s+\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s+([A-Z0-9]{2,12})\s+(?:in\s+)?(?:commission|fees?)\b/gi,
    normalize: (match) =>
      `${canonicalDecimal(match[1])} ${match[2].toUpperCase()}`,
    policyValue: (policy) =>
      `${canonicalDecimal(policy.limits.max_commission.value)} ${policy.limits.max_commission.asset.toUpperCase()}`,
  },
  {
    field: "policy.limits.settlement.value",
    label: "settlement bound",
    expression:
      /(?:(?:(?:(?:do not|never)\s+)?(?:pay|spend)\s+|not\s+)?more than\s+\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s+([A-Z0-9]{2,12})\s+total|(?:receive|accept)\s+(?:at least|no less than)\s+\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s+([A-Z0-9]{2,12})\s+(?:after commission|in net proceeds|net))\b/gi,
    normalize: (match) =>
      `${canonicalDecimal(match[1] ?? match[3])} ${(match[2] ?? match[4]).toUpperCase()}`,
    policyValue: (policy) =>
      `${canonicalDecimal(policy.limits.settlement.value)} ${policy.limits.settlement.asset.toUpperCase()}`,
  },
  {
    field: "policy.market_condition.value",
    label: "absolute market-price condition",
    optional: true,
    expression:
      /\b(?:only\s+)?(?:if|when)\s+(?:Coinbase(?:['’]s)?\s+)?(?:fresh\s+)?best\s+(ask|bid)\s+is\s+(at\s+or\s+below|no\s+more\s+than|at\s+or\s+above|no\s+less\s+than)\s+\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s+([A-Z0-9]{2,12})\b/gi,
    normalize: (match) => {
      const reference = match[1].toUpperCase() === "ASK" ? "BEST_ASK" : "BEST_BID";
      const operator = /below|more/i.test(match[2])
        ? "AT_OR_BELOW"
        : "AT_OR_ABOVE";
      return `${reference}:${operator}:${canonicalDecimal(match[3])} ${match[4].toUpperCase()}`;
    },
    policyValue: (policy) =>
      policy.market_condition == null
        ? null
        : `${policy.market_condition.reference}:${policy.market_condition.operator}:${canonicalDecimal(policy.market_condition.value)} ${policy.market_condition.asset.toUpperCase()}`,
  },
  {
    field: "policy.validity.ttl_seconds",
    label: "authorization expiry",
    expression:
      /\b(?:authorization\s+)?expires?\s+(?:in\s+)?(\d+)\s+(seconds?|minutes?)\b/gi,
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

export function requiredMaterialPolicyPaths(policy) {
  return MATERIAL_CONSTRAINTS.filter(
    (definition) =>
      !definition.optional || definition.policyValue(policy) != null,
  ).map((definition) => definition.field);
}

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
        ? `The ${definition.label} has conflicting source statements; the Guard requires exactly one authorized value.`
        : `The ${definition.label} is stated more than once; the Guard requires exactly one source statement even when the values match.`,
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
  /\busing\s+(?:only\s+)?held\s+[A-Z0-9]{2,12}\b/gi,
  /\b(?:buy|sell)\s+(?:some\s+)?[A-Z0-9]{2,12}\b/gi,
  /\b(?:buy|sell)\s+(?:(?:exactly|up to|at most)\s+\$?\s*\d+(?:\.\d+)?\s+[A-Z0-9]{2,12}\s+of\s+)?[A-Z0-9]{2,12}\s+on Coinbase\b/gi,
  /\bif\s+[A-Z0-9]{2,12}\s+is\s+(?:at\s+or\s+)?(?:below|above)\s+\$?\s*\d+(?:\.\d+)?\s*(?:dollars?|USD|USDC)?\b/gi,
  /\bof\s+[A-Z0-9]{2,12}\s+on\b/gi,
  /\bCoinbase(?:['’]s)? fresh best (?:ask|bid)\b/gi,
  /\bafter I confirm it\b/gi,
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
          "This clause is not represented in the v3 spot-order taxonomy and cannot be discarded.",
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
    const policyValue = definition.policyValue(policy);
    if (
      definition.optional &&
      sourceMatches.length === 0 &&
      policyValue == null
    ) {
      continue;
    }
    if (sourceMatches.length !== 1) {
      throw new Error(
        `source intent must contain exactly one ${definition.label} statement`,
      );
    }
    const sourceMatch = sourceMatches[0];
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
