import { randomUUID } from "node:crypto";
import {
  compareDecimals,
  isIncrementAligned,
  priceBoundFromBps,
} from "./decimal.js";
import { digest } from "./evidence.js";
import { validatePolicy } from "./policy-validator.js";
import { createCanonicalSpotAction } from "./spot-action.js";

export function proposeSpotOrder(policy, market, { now = new Date() } = {}) {
  validatePolicy(policy);
  if (
    market.product_id !== policy.product_id ||
    market.product_type !== "SPOT" ||
    market.base_asset !== policy.base_asset ||
    market.quote_asset !== policy.quote_asset
  ) {
    throw new Error("Market evidence does not match the human-confirmed instrument");
  }
  const sizeIncrement =
    policy.side === "BUY"
      ? market.quote_increment
      : market.base_increment;
  if (!isIncrementAligned(policy.size.value, sizeIncrement)) {
    throw new Error(
      `Authorized ${policy.size.asset} size is not aligned to the Coinbase increment`,
    );
  }
  const minimum =
    policy.side === "BUY" ? market.quote_min_size : market.base_min_size;
  const maximum =
    policy.side === "BUY" ? market.quote_max_size : market.base_max_size;
  if (
    compareDecimals(policy.size.value, minimum) < 0 ||
    compareDecimals(policy.size.value, maximum) > 0
  ) {
    throw new Error(
      `Authorized ${policy.size.asset} size is outside Coinbase product bounds`,
    );
  }
  const limitPrice = priceBoundFromBps(
    policy.side === "BUY" ? market.best_ask : market.best_bid,
    policy.limits.max_slippage_bps,
    market.price_increment,
    policy.side,
  );
  const createdAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + Math.min(policy.validity.ttl_seconds, 30) * 1_000,
  ).toISOString();
  const proposal = {
    schema_version: "delta.coinbase.proposal.v2",
    proposal_id: randomUUID(),
    created_at: createdAt,
    expires_at: expiresAt,
    action_descriptor: createCanonicalSpotAction(policy),
    action: {
      product_id: policy.product_id,
      side: policy.side,
      type: "limit",
      time_in_force: "IOC",
      [policy.side === "BUY" ? "quote_size" : "base_size"]:
        policy.size.value,
      limit_price: limitPrice,
    },
  };
  return {
    ...proposal,
    proposal_digest: digest(proposal),
  };
}
