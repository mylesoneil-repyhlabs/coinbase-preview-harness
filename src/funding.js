import { addDecimals, compareDecimals, parseDecimal } from "./decimal.js";
import { digest } from "./evidence.js";
import { createCanonicalSpotAction } from "./spot-action.js";

function accountCurrency(account) {
  return account?.available_balance?.currency ?? account?.currency;
}

function accountValue(account) {
  return account?.available_balance?.value;
}

function safeAccountFingerprint(account) {
  return digest({
    uuid: account?.uuid ?? null,
    currency: accountCurrency(account) ?? null,
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
  const failures = [];
  if (!Array.isArray(accounts)) {
    return {
      decision: "BLOCK",
      funding_asset: requiredAsset,
      required_available: requiredAvailable,
      available_balance: null,
      account_fingerprints: [],
      evidence_digest: null,
      failures: [
        {
          code: "ACCOUNTS_RESPONSE_INVALID",
          message: "Coinbase accounts evidence is missing or malformed",
        },
      ],
    };
  }
  if (accountsResponse.has_next === true) {
    failures.push({
      code: "ACCOUNTS_EVIDENCE_INCOMPLETE",
      message: "Coinbase accounts evidence is paginated and incomplete",
    });
  }
  const eligible = [];
  for (const account of accounts) {
    if (
      accountCurrency(account) !== requiredAsset ||
      account?.active !== true ||
      account?.ready !== true ||
      account?.deleted_at != null
    ) {
      continue;
    }
    try {
      const parsed = parseDecimal(accountValue(account), "available balance");
      if (parsed.coefficient < 0n) throw new Error("negative");
      eligible.push(account);
    } catch {
      failures.push({
        code: "AVAILABLE_BALANCE_INVALID",
        message: `Coinbase returned an invalid ${requiredAsset} available balance`,
      });
    }
  }
  let available = "0";
  for (const account of eligible) {
    available = addDecimals(available, accountValue(account));
  }
  if (!eligible.length) {
    failures.push({
      code: "FUNDING_ASSET_NOT_HELD",
      message: `No active, ready Coinbase account holds ${requiredAsset}`,
    });
  } else if (compareDecimals(available, requiredAvailable) < 0) {
    failures.push({
      code: "INSUFFICIENT_AVAILABLE_BALANCE",
      message: `Available ${requiredAsset} balance is below the authorized action requirement`,
      expected: requiredAvailable,
      actual: available,
    });
  }
  const normalized = {
    schema_version: "delta.coinbase.funding_evidence.v1",
    portfolio_fingerprint: portfolioFingerprint ?? null,
    funding_asset: requiredAsset,
    required_available: requiredAvailable,
    available_balance: available,
    account_fingerprints: eligible
      .map(safeAccountFingerprint)
      .sort(),
    complete: accountsResponse.has_next !== true,
  };
  return {
    decision: failures.length ? "BLOCK" : "PASS",
    ...normalized,
    evidence_digest: digest(normalized),
    failures,
  };
}
