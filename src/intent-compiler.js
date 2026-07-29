import { readFile } from "node:fs/promises";
import path from "node:path";
import { digest } from "./evidence.js";
import {
  findRepeatedMaterialConstraints,
  findSourceConstraintIssues,
  findUnrecognizedConstraints,
} from "./intent-source-validator.js";
import { HARNESS_ROOT } from "./paths.js";
import { validateCompilation } from "./policy-validator.js";

const SCHEMA_PATH = path.join(
  HARNESS_ROOT,
  "config",
  "coinbase-spot-policy.v3.schema.json",
);

const COMPILER_INSTRUCTIONS = `You compile a human's natural-language trading intent into a draft policy.

Success means returning exactly the provided JSON schema. The draft is never authorization.

Rules:
- Scope is one Coinbase Advanced Trade PRODUCTION custodial SPOT order only.
- Never infer a product, base asset, quote asset, dollar currency, portfolio, side, exact size, order type, fill policy, fee cap, all-in cap, slippage cap, or expiry.
- "dollars" and "$" are ambiguous unless the intent explicitly says USD or USDC.
- Normalize "buy BASE with QUOTE" to BASE-QUOTE BUY and "sell BASE for QUOTE" to BASE-QUOTE SELL.
- V3 supports one exact-size or maximum-size SOR_LIMIT_IOC order. BUY must be quote-sized. SELL must be base-sized.
- BUY requires a maximum quote-asset total debit. SELL requires a minimum quote-asset net proceeds floor.
- An optional one-shot market condition must be side-correct: BUY uses fresh best ask at-or-below an absolute quote-asset price; SELL uses fresh best bid at-or-above it. It is not a resting order or background monitor.
- The TTL starts only when the human supplies the final credential-scoped execution digest.
- Transfers, conversions, leverage, margin, derivatives, recurring orders, balance percentages, GTC orders, multi-step strategies, unrestricted market orders, and on-chain network instructions are unsupported.
- Every material constraint must appear exactly once in the source, including when repeated statements have the same value.
- Every material policy field must have one grounding item whose source_quote is copied exactly from the input.
- If any material value is absent or ambiguous, return NEEDS_CLARIFICATION with policy null.
- If any clause is unsupported or conflicts with another clause, return UNSUPPORTED with policy null.
- Do not add safety defaults. Do not silently discard a clause.`;

function matchQuote(intent, expression) {
  const match = intent.match(expression);
  return match ? match[0] : null;
}

function issue(code, sourceText, question) {
  return { code, source_text: sourceText ?? "", question };
}

function unsupported(code, sourceText, reason) {
  return { code, source_text: sourceText ?? "", reason };
}

function parseExplicitProduct(intent) {
  for (const match of intent.matchAll(
    /\b([A-Z0-9]{2,12})[-/]([A-Z0-9]{2,12})\b/gi,
  )) {
    if (match[0].toLowerCase() === "price-bounded") continue;
    return {
      product_id: `${match[1].toUpperCase()}-${match[2].toUpperCase()}`,
      base_asset: match[1].toUpperCase(),
      quote_asset: match[2].toUpperCase(),
      quote: match[0],
    };
  }
  return null;
}

function parseSizeBound(intent) {
  const match = intent.match(
    /\b((?:use\s+)?exactly|(?:use\s+)?up to|at most)\s+\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s+([A-Z0-9]{2,12})\b/i,
  );
  if (!match) return null;
  return {
    operator: /exactly/i.test(match[1]) ? "EXACT" : "MAX",
    value: match[2].replaceAll(",", ""),
    asset: match[3].toUpperCase(),
    quote: match[0],
  };
}

function parseMarketCondition(intent) {
  const match = intent.match(
    /\b(?:only\s+)?(?:if|when)\s+(?:Coinbase(?:['’]s)?\s+)?(?:fresh\s+)?best\s+(ask|bid)\s+is\s+(at\s+or\s+below|no\s+more\s+than|at\s+or\s+above|no\s+less\s+than)\s+\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s+([A-Z0-9]{2,12})\b/i,
  );
  if (!match) return null;
  return {
    reference: match[1].toUpperCase() === "ASK" ? "BEST_ASK" : "BEST_BID",
    operator: /below|more/i.test(match[2])
      ? "AT_OR_BELOW"
      : "AT_OR_ABOVE",
    value: match[3].replaceAll(",", ""),
    asset: match[4].toUpperCase(),
    quote: match[0],
  };
}

function parseNamedLimit(intent, suffix) {
  const expression = new RegExp(
    `(?:(?:(?:do not|never)\\s+)?(?:pay|spend)\\s+|not\\s+)?more than\\s+\\$?\\s*(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)\\s+([A-Z0-9]{2,12})\\s+${suffix}`,
    "i",
  );
  const match = intent.match(expression);
  if (!match) return null;
  return {
    value: match[1].replaceAll(",", ""),
    asset: match[2].toUpperCase(),
    quote: match[0],
  };
}

function parseTtl(intent) {
  const match = intent.match(
    /\b(?:authorization\s+)?expires?\s+(?:in\s+)?(\d+)\s+(seconds?|minutes?)\b/i,
  );
  if (!match) return null;
  const value = Number(match[1]);
  const seconds = match[2].toLowerCase().startsWith("minute") ? value * 60 : value;
  return { seconds, quote: match[0] };
}

function parseMinimumProceeds(intent) {
  const match = intent.match(
    /\b(?:receive|accept)\s+(?:at least|no less than)\s+\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s+([A-Z0-9]{2,12})\s+(?:after commission|in net proceeds|net)\b/i,
  );
  if (!match) return null;
  return {
    value: match[1].replaceAll(",", ""),
    asset: match[2].toUpperCase(),
    quote: match[0],
  };
}

function readyGrounding(values) {
  const grounding = [
    { field: "policy.product_id", source_quote: values.product.quote },
    { field: "policy.side", source_quote: values.sideQuote },
    { field: "policy.order_type", source_quote: values.orderTypeQuote },
    { field: "policy.size.value", source_quote: values.size.quote },
    {
      field: "policy.partial_fill_policy",
      source_quote: values.partialFillQuote,
    },
    {
      field: "policy.limits.max_slippage_bps",
      source_quote: values.slippageQuote,
    },
    {
      field: "policy.limits.max_commission.value",
      source_quote: values.commission.quote,
    },
    {
      field: "policy.limits.settlement.value",
      source_quote: values.settlement.quote,
    },
    { field: "policy.validity.ttl_seconds", source_quote: values.ttl.quote },
    { field: "policy.usage.max_executions", source_quote: values.onceQuote },
  ];
  if (values.marketCondition) {
    grounding.push({
      field: "policy.market_condition.value",
      source_quote: values.marketCondition.quote,
    });
  }
  return grounding;
}

export function compileDeterministicIntent(intent) {
  if (typeof intent !== "string" || !intent.trim()) {
    throw new Error("intent must be a non-empty string");
  }
  const ambiguities = [];
  const unsupportedConstraints = findRepeatedMaterialConstraints(intent);
  const product = parseExplicitProduct(intent);
  const sizeBound = parseSizeBound(intent);
  const marketCondition = parseMarketCondition(intent);
  const lower = intent.toLowerCase();
  const actionText = lower.replaceAll(/do not sell|never sell/g, "");
  const hasBuy = /\bbuy\b/.test(actionText);
  const hasSell = /\bsell\b/.test(actionText);
  const side = hasBuy && !hasSell ? "BUY" : hasSell && !hasBuy ? "SELL" : null;
  const sideQuote = side ? matchQuote(intent, new RegExp(`\\b${side}\\b`, "i")) : null;
  const orderTypeQuote = matchQuote(
    intent,
    /\b(?:price[- ]bounded\s+)?IOC\s+limit\s+order\b/i,
  );
  const partialFillQuote = matchQuote(
    intent,
    /\bpartial fill(?:s)? (?:(?:is|are) )?(?:acceptable|allowed)\b/i,
  );
  const slippageMatch = intent.match(
    /\b(?:do not (?:pay|accept)|never (?:pay|accept)|not) more than\s+(\d+)\s+bps\s+(?:above|below)\b/i,
  );
  const commission = parseNamedLimit(intent, "(?:in\\s+)?(?:commission|fees?)");
  const total = parseNamedLimit(intent, "total");
  const minimumProceeds = parseMinimumProceeds(intent);
  const settlement =
    side === "BUY" ? total : side === "SELL" ? minimumProceeds : null;
  const ttl = parseTtl(intent);
  const onceQuote = matchQuote(intent, /\bonce\b/i);

  const unsupportedPatterns = [
    ["RECURRING_ORDER", /\b(?:every|daily|weekly|monthly|recurring)\b/i, "Recurring orders are outside v1."],
    ["RELATIVE_BALANCE", /\b(?:all|half|percent|percentage)\b|%/i, "Balance-relative sizing is outside v1."],
    ["LEVERAGE_OR_DERIVATIVE", /\b(?:leverage|margin|future|futures|perpetual|perp)\b/i, "Leveraged and derivative products are outside v1."],
    ["NON_ORDER_ACTION", /\b(?:transfer|convert|withdraw|send)\b/i, "Transfers and conversions are outside v1."],
    ["PROMPT_INJECTION_OR_CONFLICT", /\b(?:ignore|disregard|override)\b/i, "Instruction override language prevents safe compilation."],
    ["ONCHAIN_NETWORK", /\b(?:on base|on ethereum|on solana|network fee|gas)\b/i, "On-chain execution is a separate taxonomy."],
  ];
  for (const [code, expression, reason] of unsupportedPatterns) {
    const quote = matchQuote(intent, expression);
    if (quote) unsupportedConstraints.push(unsupported(code, quote, reason));
  }
  if (slippageMatch && Number(slippageMatch[1]) > 9_999) {
    unsupportedConstraints.push(
      unsupported(
        "SLIPPAGE_OUTSIDE_CAPABILITY",
        slippageMatch[0],
        "A price bound must remain strictly positive; v1.4 supports at most 9999 bps.",
      ),
    );
  }
  if (ttl && (ttl.seconds < 30 || ttl.seconds > 600)) {
    unsupportedConstraints.push(
      unsupported(
        "EXPIRY_OUTSIDE_CAPABILITY",
        ttl.quote,
        "v1.4 authorization validity must be between 30 and 600 seconds.",
      ),
    );
  }
  if (!unsupportedConstraints.length) {
    unsupportedConstraints.push(...findUnrecognizedConstraints(intent));
  }

  if (!side) {
    ambiguities.push(
      issue(
        "SIDE_REQUIRED",
        hasBuy || hasSell ? matchQuote(intent, /\b(?:buy|sell)\b/i) : "",
        "State exactly one action: BUY or SELL.",
      ),
    );
  }
  if (!product) {
    ambiguities.push(
      issue("PRODUCT_REQUIRED", "", "State the exact Coinbase pair, for example ETH-USDC."),
    );
  }
  if (!sizeBound) {
    ambiguities.push(
      issue(
        "EXACT_SIZE_REQUIRED",
        matchQuote(intent, /\b(?:up to|at most|some|\$\d+(?:\.\d+)?)\b/i) ?? "",
        "State one exact or maximum amount and its asset, for example exactly 5 USDC or up to 3000 USDC.",
      ),
    );
  }
  if (!orderTypeQuote) {
    ambiguities.push(
      issue(
        "ORDER_TYPE_REQUIRED",
        "",
        "Authorize a price-bounded IOC limit order explicitly.",
      ),
    );
  }
  if (!partialFillQuote) {
    ambiguities.push(
      issue(
        "PARTIAL_FILL_POLICY_REQUIRED",
        "",
        "State whether a partial fill is acceptable.",
      ),
    );
  }
  if (!slippageMatch) {
    ambiguities.push(
      issue("SLIPPAGE_CAP_REQUIRED", "", "State the maximum slippage in basis points."),
    );
  }
  if (!commission) {
    ambiguities.push(
      issue("COMMISSION_CAP_REQUIRED", "", "State the maximum commission and asset."),
    );
  }
  if (!settlement) {
    ambiguities.push(
      issue(
        side === "SELL"
          ? "MIN_NET_PROCEEDS_REQUIRED"
          : "MAX_QUOTE_DEBIT_REQUIRED",
        "",
        side === "SELL"
          ? "State the minimum quote-asset amount that must be received after commission."
          : "State the maximum quote-asset total debit.",
      ),
    );
  }
  if (!ttl) {
    ambiguities.push(
      issue("EXPIRY_REQUIRED", "", "State how many seconds or minutes authorization lasts."),
    );
  }
  if (!onceQuote) {
    ambiguities.push(
      issue("EXECUTION_COUNT_REQUIRED", "", "State that the authorization is for one execution."),
    );
  }

  if (product && sizeBound && side === "BUY" && sizeBound.asset !== product.quote_asset) {
    ambiguities.push(
      issue(
        "BUY_SIZE_ASSET_MISMATCH",
        sizeBound.quote,
        `A BUY of ${product.product_id} must be sized in ${product.quote_asset}.`,
      ),
    );
  }
  if (product && sizeBound && side === "SELL" && sizeBound.asset !== product.base_asset) {
    ambiguities.push(
      issue(
        "SELL_SIZE_ASSET_MISMATCH",
        sizeBound.quote,
        `A SELL of ${product.product_id} must be sized in ${product.base_asset}.`,
      ),
    );
  }
  for (const value of [commission, settlement]) {
    if (product && value && value.asset !== product.quote_asset) {
      ambiguities.push(
        issue(
          "LIMIT_ASSET_MISMATCH",
          value.quote,
          `Commission and settlement limits must be denominated in ${product.quote_asset}.`,
        ),
      );
    }
  }
  if (marketCondition && product) {
    const expectedReference = side === "BUY" ? "BEST_ASK" : "BEST_BID";
    const expectedOperator =
      side === "BUY" ? "AT_OR_BELOW" : "AT_OR_ABOVE";
    if (
      marketCondition.reference !== expectedReference ||
      marketCondition.operator !== expectedOperator
    ) {
      ambiguities.push(
        issue(
          "MARKET_CONDITION_SIDE_MISMATCH",
          marketCondition.quote,
          `A ${side ?? "BUY or SELL"} condition must use ${
            side === "SELL" ? "fresh best bid at or above" : "fresh best ask at or below"
          }.`,
        ),
      );
    }
    if (marketCondition.asset !== product.quote_asset) {
      ambiguities.push(
        issue(
          "MARKET_CONDITION_ASSET_MISMATCH",
          marketCondition.quote,
          `The market-price condition must be denominated in ${product.quote_asset}.`,
        ),
      );
    }
  }

  if (unsupportedConstraints.length) {
    return validateCompilation(
      {
        schema_version: "delta.coinbase.compilation.v3",
        taxonomy_version: "digital-asset-spot-order.v3",
        status: "UNSUPPORTED",
        policy: null,
        ambiguities: [],
        unsupported_constraints: unsupportedConstraints,
        grounding: [],
      },
      intent,
    );
  }
  if (ambiguities.length) {
    return validateCompilation(
      {
        schema_version: "delta.coinbase.compilation.v3",
        taxonomy_version: "digital-asset-spot-order.v3",
        status: "NEEDS_CLARIFICATION",
        policy: null,
        ambiguities,
        unsupported_constraints: [],
        grounding: [],
      },
      intent,
    );
  }

  const values = {
    product,
    size: sizeBound,
    sideQuote,
    orderTypeQuote,
    partialFillQuote,
    slippageQuote: slippageMatch[0],
    commission,
    settlement,
    marketCondition,
    ttl,
    onceQuote,
  };
  const compilation = {
    schema_version: "delta.coinbase.compilation.v3",
    taxonomy_version: "digital-asset-spot-order.v3",
    status: "READY_FOR_CONFIRMATION",
    policy: {
      venue: "COINBASE_ADVANCED",
      environment: "PRODUCTION",
      execution_domain: "COINBASE_CUSTODIAL_LEDGER",
      product_type: "SPOT",
      product_id: product.product_id,
      base_asset: product.base_asset,
      quote_asset: product.quote_asset,
      side,
      order_type: "SOR_LIMIT_IOC",
      size: {
        denomination: side === "BUY" ? "QUOTE" : "BASE",
        asset: sizeBound.asset,
        operator: sizeBound.operator,
        value: sizeBound.value,
      },
      market_condition: marketCondition
        ? {
            reference: marketCondition.reference,
            operator: marketCondition.operator,
            asset: marketCondition.asset,
            value: marketCondition.value,
          }
        : null,
      partial_fill_policy: "ALLOW",
      limits: {
        max_slippage_bps: Number(slippageMatch[1]),
        max_commission: {
          asset: commission.asset,
          value: commission.value,
        },
        settlement: {
          kind:
            side === "BUY"
              ? "MAX_QUOTE_DEBIT"
              : "MIN_NET_QUOTE_PROCEEDS",
          asset: settlement.asset,
          value: settlement.value,
        },
      },
      validity: {
        starts: "ON_EXECUTION_CONFIRMATION",
        ttl_seconds: ttl.seconds,
      },
      usage: {
        max_executions: 1,
      },
    },
    ambiguities: [],
    unsupported_constraints: [],
    grounding: readyGrounding(values),
  };
  return validateCompilation(compilation, intent);
}

async function loadStructuredOutputSchema() {
  const schema = JSON.parse(await readFile(SCHEMA_PATH, "utf8"));
  delete schema.$schema;
  delete schema.$id;
  delete schema.title;
  return schema;
}

function responseText(response) {
  if (typeof response.output_text === "string" && response.output_text) {
    return response.output_text;
  }
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "refusal") throw new Error(`Policy compiler refused: ${content.refusal}`);
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  throw new Error("OpenAI response did not contain structured output text");
}

export async function compileIntentWithOpenAI(
  intent,
  {
    apiKey = process.env.OPENAI_API_KEY,
    model = process.env.OPENAI_POLICY_MODEL ?? "gpt-5.6-luna",
    fetchImpl = fetch,
  } = {},
) {
  if (typeof intent !== "string" || !intent.trim()) {
    throw new Error("intent must be a non-empty string");
  }
  const sourceConstraintIssues = findSourceConstraintIssues(intent);
  if (sourceConstraintIssues.length) {
    const compilation = validateCompilation(
      {
        schema_version: "delta.coinbase.compilation.v3",
        taxonomy_version: "digital-asset-spot-order.v3",
        status: "UNSUPPORTED",
        policy: null,
        ambiguities: [],
        unsupported_constraints: sourceConstraintIssues,
        grounding: [],
      },
      intent,
    );
    return {
      compilation,
      model: null,
      response_id: null,
    };
  }
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for the OpenAI compiler");
  const schema = await loadStructuredOutputSchema();
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: "low" },
      instructions: COMPILER_INSTRUCTIONS,
      input: JSON.stringify({
        source_intent: intent,
        source_intent_digest: digest(intent),
        locale: "en-US",
        taxonomy_version: "digital-asset-spot-order.v3",
      }),
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "coinbase_spot_policy_compilation",
          description:
            "A non-authorizing draft compilation of one Coinbase Advanced spot-order intent.",
          strict: true,
          schema,
        },
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  if (body.length > 256 * 1024) throw new Error("OpenAI compiler response exceeded limit");
  if (!response.ok) throw new Error(`OpenAI compiler failed with HTTP ${response.status}`);
  const parsedResponse = JSON.parse(body);
  const compilation = JSON.parse(responseText(parsedResponse));
  validateCompilation(compilation, intent);
  return {
    compilation,
    model: parsedResponse.model ?? model,
    response_id: parsedResponse.id ?? null,
  };
}
