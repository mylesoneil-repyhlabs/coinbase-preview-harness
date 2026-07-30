import { addDecimals, compareDecimals, parseDecimal } from "./decimal.js";
import { digest } from "./evidence.js";
import { createCanonicalSpotAction } from "./spot-action.js";

function accountValue(account) {
  return account?.available_balance?.value;
}

function safeAccountFingerprint(account) {
  return digest({
    uuid: account?.uuid ?? null,
    currency: account?.currency ?? null,
    platform: account?.platform ?? null,
    retail_portfolio_id: account?.retail_portfolio_id ?? null,
  });
}

export function evaluateCoinbaseFunding(
  policy,
  accountsResponse,
  { portfolioFingerprint } = {},
) {
  const descriptor = createCanonicalSpotAction(policy);
  const requiredAsset = descriptor.funding.asset;
  const requiredAvailable = descriptor.funding.required_available;
  const accounts = accountsResponse?.accounts;
  const evidenceIssues = [];
  const policyFailures = [];
  if (!Array.isArray(accounts)) {
    return {
      decision: "REVIEW",
      funding_asset: requiredAsset,
      required_available: requiredAvailable,
      available_balance: null,
      account_fingerprints: [],
      evidence_digest: null,
      evidence_issues: [
        {
          code: "ACCOUNTS_RESPONSE_INVALID",
          message: "Coinbase accounts evidence is missing or malformed",
        },
      ],
      policy_failures: [],
      failures: [
        {
          code: "ACCOUNTS_RESPONSE_INVALID",
          message: "Coinbase accounts evidence is missing or malformed",
        },
      ],
    };
  }
  if (typeof accountsResponse.has_next !== "boolean") {
    evidenceIssues.push({
      code: "ACCOUNTS_PAGINATION_STATUS_MISSING",
      message: "Coinbase accounts evidence omitted the required has_next status",
    });
  } else if (accountsResponse.has_next === true) {
    evidenceIssues.push({
      code: "ACCOUNTS_EVIDENCE_INCOMPLETE",
      message: "Coinbase accounts evidence is paginated and incomplete",
    });
  }
  const eligible = [];
  const seenAccountIds = new Set();
  const eligiblePortfolioIds = new Set();
  for (const account of accounts) {
    if (typeof account?.uuid !== "string" || !account.uuid) {
      evidenceIssues.push({
        code: "ACCOUNT_ID_MISSING",
        message: "Coinbase returned an account without a stable ID",
      });
      continue;
    }
    if (seenAccountIds.has(account.uuid)) {
      evidenceIssues.push({
        code: "DUPLICATE_ACCOUNT_ID",
        message: "Coinbase accounts evidence repeated an account ID",
      });
      continue;
    }
    seenAccountIds.add(account.uuid);
    if (
      typeof account.currency !== "string" ||
      typeof account.available_balance?.currency !== "string" ||
      account.currency !== account.available_balance.currency
    ) {
      evidenceIssues.push({
        code: "ACCOUNT_CURRENCY_MISMATCH",
        message: "Coinbase returned a missing or contradictory account currency",
      });
      continue;
    }
    if (
      account.currency !== requiredAsset ||
      account?.active !== true ||
      account?.ready !== true ||
      account?.deleted_at != null
    ) {
      continue;
    }
    if (account.platform !== "ACCOUNT_PLATFORM_CONSUMER") {
      policyFailures.push({
        code: "ACCOUNT_PLATFORM_UNSUPPORTED",
        message: "Funding must come from a normal Coinbase consumer account",
      });
      continue;
    }
    if (
      typeof account.retail_portfolio_id !== "string" ||
      !account.retail_portfolio_id
    ) {
      evidenceIssues.push({
        code: "ACCOUNT_PORTFOLIO_MISSING",
        message: "Coinbase funding evidence omitted the retail portfolio ID",
      });
      continue;
    }
    if (
      typeof portfolioFingerprint === "string" &&
      /^[a-f0-9]{64}$/.test(portfolioFingerprint) &&
      digest(account.retail_portfolio_id) !== portfolioFingerprint
    ) {
      evidenceIssues.push({
        code: "ACCOUNT_PORTFOLIO_SCOPE_MISMATCH",
        message:
          "Coinbase account evidence does not match the permission-scoped portfolio",
      });
      continue;
    }
    eligiblePortfolioIds.add(account.retail_portfolio_id);
    try {
      const parsed = parseDecimal(accountValue(account), "available balance");
      if (parsed.coefficient < 0n) throw new Error("negative");
      eligible.push(account);
    } catch {
      evidenceIssues.push({
        code: "AVAILABLE_BALANCE_INVALID",
        message: `Coinbase returned an invalid ${requiredAsset} available balance`,
      });
    }
  }
  if (eligiblePortfolioIds.size > 1) {
    evidenceIssues.push({
      code: "MULTIPLE_FUNDING_PORTFOLIOS",
      message:
        "Coinbase funding evidence spans more than one retail portfolio",
    });
  }
  let available = "0";
  for (const account of eligible) {
    available = addDecimals(available, accountValue(account));
  }
  if (!eligible.length) {
    policyFailures.push({
      code: "FUNDING_ASSET_NOT_HELD",
      message: `No active, ready Coinbase account holds ${requiredAsset}`,
    });
  } else if (compareDecimals(available, requiredAvailable) < 0) {
    policyFailures.push({
      code: "INSUFFICIENT_AVAILABLE_BALANCE",
      message: `Available ${requiredAsset} balance is below the authorized action requirement`,
      expected: requiredAvailable,
      actual: available,
    });
  }
  const normalized = {
    schema_version: "delta.coinbase.funding_evidence.v2",
    portfolio_fingerprint: portfolioFingerprint ?? null,
    funding_asset: requiredAsset,
    required_available: requiredAvailable,
    available_balance: available,
    account_fingerprints: eligible
      .map(safeAccountFingerprint)
      .sort(),
    complete: accountsResponse.has_next === false,
  };
  const decision = evidenceIssues.length
    ? "REVIEW"
    : policyFailures.length
      ? "BLOCK"
      : "PASS";
  return {
    decision,
    ...normalized,
    evidence_digest: digest(normalized),
    evidence_issues: evidenceIssues,
    policy_failures: policyFailures,
    failures: [...evidenceIssues, ...policyFailures],
  };
}
