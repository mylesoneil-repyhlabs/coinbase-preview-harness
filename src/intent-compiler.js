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
  "coinbase-spot-policy.v1.schema.json",
);

const COMPILER_INSTRUCTIONS = `You compile a human's natural-language trading intent into a draft policy.

Success means returning exactly the provided JSON schema. The draft is never authorization.

Rules:
- Scope is one Coinbase Advanced Trade PRODUCTION custodial SPOT order only.
- Never infer a product, base asset, quote asset, dollar currency, portfolio, side, exact size, order type, fill policy, fee cap, all-in cap, slippage cap, or expiry.
- "dollars" and "$" are ambiguous unless the intent explicitly says USD or USDC.
- Normalize "buy BASE with QUOTE" to BASE-QUOTE BUY and "sell BASE for QUOTE" to BASE-QUOTE SELL.
- V1 supports only one exact-size SOR_LIMIT_IOC order. BUY must be quote-sized. SELL must be base-sized.
- The TTL starts only when the human supplies the final credential-scoped execution digest.
- Transfers, conversions, leverage, margin, derivatives, recurring orders, balance percentages, GTC orders, conditional strategies, unrestricted market orders, and on-chain network instructions are unsupported.
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
    /\b([A-Z0-9]{2,12})-([A-Z0-9]{2,12})\b/gi,
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

function parseExactSize(intent) {
  const match = intent.match(
    /\b(?:use\s+)?exactly\s+(\d+(?:\.\d+)?)\s+([A-Z0-9]{2,12})\b/i,
  );
  if (!match) return null;
  return { value: match[1], asset: match[2].toUpperCase(), quote: match[0] };
}

function parseNamedLimit(intent, suffix) {
  const expression = new RegExp(
    `(?:(?:do not (?:pay|spend)|never (?:pay|spend)|not)\\s+)?more than\\s+(\\d+(?:\\.\\d+)?)\\s+([A-Z0-9]{2,12})\\s+${suffix}`,
    "i",
  );
  const match = intent.match(expression);
  if (!match) return null;
  return { value: match[1], asset: match[2].toUpperCase(), quote: match[0] };
}

function parseTtl(intent) {
  const match = intent.match(
    /\b(?:authorization\s+)?expires?\s+(\d+)\s+(seconds?|minutes?)\b/i,
  );
  if (!match) return null;
  const value = Number(match[1]);
  const seconds = match[2].toLowerCase().startsWith("minute") ? value * 60 : value;
  return { seconds, quote: match[0] };
}

function readyGrounding(values) {
  return [
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
      field: "policy.limits.max_all_in_debit.value",
      source_quote: values.total.quote,
    },
    { field: "policy.validity.ttl_seconds", source_quote: values.ttl.quote },
    { field: "policy.usage.max_executions", source_quote: values.onceQuote },
  ];
}

export function compileDeterministicIntent(intent) {
  if (typeof intent !== "string" || !intent.trim()) {
    throw new Error("intent must be a non-empty string");
  }
  const ambiguities = [];
  const unsupportedConstraints = findRepeatedMaterialConstraints(intent);
  const product = parseExplicitProduct(intent);
  const exactSize = parseExactSize(intent);
  const lower = intent.toLowerCase();
  const actionText = lower.replaceAll(/do not sell|never sell/g, "");
  const hasBuy = /\bbuy\b/.test(actionText);
  const hasSell = /\bsell\b/.test(actionText);
  const side = hasBuy && !hasSell ? "BUY" : hasSell && !hasBuy ? "SELL" : null;
  const sideQuote = side ? matchQuote(intent, new RegExp(`\\b${side}\\b`, "i")) : null;
  const orderTypeQuote = matchQuote(
    intent,
    /\b(?:price-bounded\s+)?IOC\s+limit\s+order\b/i,
  );
  const partialFillQuote = matchQuote(
    intent,
    /\bpartial fill(?:s)? (?:is|are) acceptable\b/i,
  );
  const slippageMatch = intent.match(
    /\b(?:do not pay|never pay|not) more than\s+(\d+)\s+bps\s+(?:above|below)\b/i,
  );
  const commission = parseNamedLimit(intent, "in commission");
  const total = parseNamedLimit(intent, "total");
  const ttl = parseTtl(intent);
  const onceQuote = matchQuote(intent, /\bonce\b/i);

  const unsupportedPatterns = [
    ["RECURRING_ORDER", /\b(?:every|daily|weekly|monthly|recurring)\b/i, "Recurring orders are outside v1."],
    ["RELATIVE_BALANCE", /\b(?:all|half|percent|percentage)\b|%/i, "Balance-relative sizing is outside v1."],
    ["CONDITIONAL_STRATEGY", /\b(?:when|whenever|if)\b/i, "Conditional strategies are outside v1."],
    ["LEVERAGE_OR_DERIVATIVE", /\b(?:leverage|margin|future|futures|perpetual|perp)\b/i, "Leveraged and derivative products are outside v1."],
    ["NON_ORDER_ACTION", /\b(?:transfer|convert|withdraw|send)\b/i, "Transfers and conversions are outside v1."],
    ["PROMPT_INJECTION_OR_CONFLICT", /\b(?:ignore|disregard|override)\b/i, "Instruction override language prevents safe compilation."],
    ["ONCHAIN_NETWORK", /\b(?:on base|on ethereum|on solana|network fee|gas)\b/i, "On-chain execution is a separate taxonomy."],
  ];
  for (const [code, expression, reason] of unsupportedPatterns) {
    const quote = matchQuote(intent, expression);
    if (quote) unsupportedConstraints.push(unsupported(code, quote, reason));
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
  if (!exactSize) {
    ambiguities.push(
      issue(
        "EXACT_SIZE_REQUIRED",
        matchQuote(intent, /\b(?:up to|at most|some|\$\d+(?:\.\d+)?)\b/i) ?? "",
        "State one exact amount and its asset, for example exactly 5 USDC.",
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
  if (!total) {
    ambiguities.push(
      issue("ALL_IN_CAP_REQUIRED", "", "State the maximum all-in debit and asset."),
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

  if (product && exactSize && side === "BUY" && exactSize.asset !== product.quote_asset) {
    ambiguities.push(
      issue(
        "BUY_SIZE_ASSET_MISMATCH",
        exactSize.quote,
        `A BUY of ${product.product_id} must be sized in ${product.quote_asset}.`,
      ),
    );
  }
  if (product && exactSize && side === "SELL" && exactSize.asset !== product.base_asset) {
    ambiguities.push(
      issue(
        "SELL_SIZE_ASSET_MISMATCH",
        exactSize.quote,
        `A SELL of ${product.product_id} must be sized in ${product.base_asset}.`,
      ),
    );
  }
  for (const value of [commission, total]) {
    if (product && value && value.asset !== product.quote_asset) {
      ambiguities.push(
        issue(
          "LIMIT_ASSET_MISMATCH",
          value.quote,
          `Commission and all-in limits must be denominated in ${product.quote_asset}.`,
        ),
      );
    }
  }

  if (unsupportedConstraints.length) {
    return validateCompilation(
      {
        schema_version: "delta.coinbase.compilation.v1",
        taxonomy_version: "digital-asset-spot-order.v1",
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
        schema_version: "delta.coinbase.compilation.v1",
        taxonomy_version: "digital-asset-spot-order.v1",
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
    size: exactSize,
    sideQuote,
    orderTypeQuote,
    partialFillQuote,
    slippageQuote: slippageMatch[0],
    commission,
    total,
    ttl,
    onceQuote,
  };
  const compilation = {
    schema_version: "delta.coinbase.compilation.v1",
    taxonomy_version: "digital-asset-spot-order.v1",
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
        asset: exactSize.asset,
        operator: "EXACT",
        value: exactSize.value,
      },
      partial_fill_policy: "ALLOW",
      limits: {
        max_slippage_bps: Number(slippageMatch[1]),
        max_commission: {
          asset: commission.asset,
          value: commission.value,
        },
        max_all_in_debit: {
          asset: total.asset,
          value: total.value,
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
        schema_version: "delta.coinbase.compilation.v1",
        taxonomy_version: "digital-asset-spot-order.v1",
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
        taxonomy_version: "digital-asset-spot-order.v1",
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
