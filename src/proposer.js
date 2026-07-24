import { randomUUID } from "node:crypto";
import {
  isIncrementAligned,
  priceBoundFromBps,
} from "./decimal.js";
import { digest } from "./evidence.js";
import { validatePolicy } from "./policy-validator.js";

export function proposeSpotOrder(policy, market, { now = new Date() } = {}) {
  validatePolicy(policy);
  if (policy.side !== "BUY") {
    throw new Error("v1 live execution supports BUY only; SELL remains compile-only");
  }
  if (
    market.product_id !== policy.product_id ||
    market.product_type !== "SPOT" ||
    market.base_asset !== policy.base_asset ||
    market.quote_asset !== policy.quote_asset
  ) {
    throw new Error("Market evidence does not match the human-confirmed instrument");
  }
  if (!isIncrementAligned(policy.size.value, market.quote_increment)) {
    throw new Error("Authorized quote size is not aligned to the Coinbase increment");
  }
  const limitPrice = priceBoundFromBps(
    market.best_ask,
    policy.limits.max_slippage_bps,
    market.price_increment,
    "BUY",
  );
  const createdAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + Math.min(policy.validity.ttl_seconds, 30) * 1_000,
  ).toISOString();
  const proposal = {
    schema_version: "delta.coinbase.proposal.v1",
    proposal_id: randomUUID(),
    created_at: createdAt,
    expires_at: expiresAt,
    action: {
      product_id: policy.product_id,
      side: "BUY",
      type: "limit",
      time_in_force: "IOC",
      quote_size: policy.size.value,
      limit_price: limitPrice,
    },
  };
  return {
    ...proposal,
    proposal_digest: digest(proposal),
  };
}
