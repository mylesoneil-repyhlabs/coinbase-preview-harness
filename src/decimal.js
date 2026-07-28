const DECIMAL_PATTERN = /^(0|[1-9]\d*)(?:\.(\d+))?$/;

export function parseDecimal(value, field = "value") {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) {
    throw new Error(`${field} must be a non-negative decimal string`);
  }

  const [integerPart, fractionPart = ""] = value.split(".");
  if (integerPart.length > 18 || fractionPart.length > 18) {
    throw new Error(`${field} exceeds the supported decimal precision`);
  }

  return {
    coefficient: BigInt(`${integerPart}${fractionPart}`),
    scale: fractionPart.length,
  };
}

export function compareDecimals(left, right) {
  const a = parseDecimal(left, "left");
  const b = parseDecimal(right, "right");
  const scale = Math.max(a.scale, b.scale);
  const scaledA = a.coefficient * 10n ** BigInt(scale - a.scale);
  const scaledB = b.coefficient * 10n ** BigInt(scale - b.scale);
  return scaledA === scaledB ? 0 : scaledA < scaledB ? -1 : 1;
}

export function addDecimals(left, right) {
  const a = parseDecimal(left, "left");
  const b = parseDecimal(right, "right");
  const scale = Math.max(a.scale, b.scale);
  return formatDecimal(toScale(a, scale) + toScale(b, scale), scale);
}

export function subtractDecimals(left, right) {
  const a = parseDecimal(left, "left");
  const b = parseDecimal(right, "right");
  const scale = Math.max(a.scale, b.scale);
  const difference = toScale(a, scale) - toScale(b, scale);
  if (difference < 0n) {
    throw new Error("decimal subtraction would be negative");
  }
  return formatDecimal(difference, scale);
}

export function multiplyDecimals(left, right) {
  const a = parseDecimal(left, "left");
  const b = parseDecimal(right, "right");
  let coefficient = a.coefficient * b.coefficient;
  let scale = a.scale + b.scale;
  while (scale > 18 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  if (scale > 18) {
    throw new Error("decimal product exceeds the supported precision");
  }
  return formatDecimal(coefficient, scale);
}

export function divideDecimals(
  dividend,
  divisor,
  { scale = 18 } = {},
) {
  const a = parseDecimal(dividend, "dividend");
  const b = parseDecimal(divisor, "divisor");
  if (b.coefficient <= 0n) throw new Error("divisor must be positive");
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
    throw new Error("division scale must be an integer between 0 and 18");
  }
  const numerator =
    a.coefficient * 10n ** BigInt(scale + b.scale);
  const denominator =
    b.coefficient * 10n ** BigInt(a.scale);
  return formatDecimal(numerator / denominator, scale);
}

export function isWithinDecimalTolerance(left, right, tolerance) {
  try {
    const a = parseDecimal(left, "left");
    const b = parseDecimal(right, "right");
    const allowed = parseDecimal(tolerance, "tolerance");
    const scale = Math.max(a.scale, b.scale, allowed.scale);
    const scaledA = toScale(a, scale);
    const scaledB = toScale(b, scale);
    const difference = scaledA >= scaledB ? scaledA - scaledB : scaledB - scaledA;
    return difference <= toScale(allowed, scale);
  } catch {
    return false;
  }
}

export function isPositiveDecimal(value) {
  try {
    return parseDecimal(value).coefficient > 0n;
  } catch {
    return false;
  }
}

export function formatDecimal(coefficient, scale) {
  if (typeof coefficient !== "bigint" || coefficient < 0n) {
    throw new Error("coefficient must be a non-negative bigint");
  }
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
    throw new Error("scale must be an integer between 0 and 18");
  }
  if (scale === 0) return coefficient.toString();
  const digits = coefficient.toString().padStart(scale + 1, "0");
  const integer = digits.slice(0, -scale);
  const fraction = digits.slice(-scale);
  return `${integer}.${fraction}`;
}

function toScale(decimal, scale) {
  return decimal.coefficient * 10n ** BigInt(scale - decimal.scale);
}

export function priceBoundFromBps(reference, bps, increment, side = "BUY") {
  const parsedReference = parseDecimal(reference, "reference");
  const parsedIncrement = parseDecimal(increment, "increment");
  if (parsedReference.coefficient <= 0n || parsedIncrement.coefficient <= 0n) {
    throw new Error("reference and increment must be positive");
  }
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new Error("bps must be an integer between 0 and 10000");
  }
  if (!["BUY", "SELL"].includes(side)) {
    throw new Error("side must be BUY or SELL");
  }

  const scale = Math.max(parsedReference.scale, parsedIncrement.scale);
  const referenceAtScale = toScale(parsedReference, scale);
  const incrementAtScale = toScale(parsedIncrement, scale);
  const ratio = side === "BUY" ? 10_000n + BigInt(bps) : 10_000n - BigInt(bps);
  const numerator = referenceAtScale * ratio;
  let boundAtScale = numerator / 10_000n;

  if (side === "BUY") {
    boundAtScale = (boundAtScale / incrementAtScale) * incrementAtScale;
  } else {
    if (numerator % 10_000n !== 0n) boundAtScale += 1n;
    boundAtScale =
      ((boundAtScale + incrementAtScale - 1n) / incrementAtScale) * incrementAtScale;
  }
  if (boundAtScale <= 0n) throw new Error("computed price bound is not positive");
  return formatDecimal(boundAtScale, scale);
}

export function isSlippageWithinBps(fillPrice, referencePrice, maxBps, side = "BUY") {
  const fill = parseDecimal(fillPrice, "fill_price");
  const reference = parseDecimal(referencePrice, "reference_price");
  if (fill.coefficient <= 0n || reference.coefficient <= 0n) return false;
  if (!Number.isInteger(maxBps) || maxBps < 0 || maxBps > 10_000) return false;

  const scale = Math.max(fill.scale, reference.scale);
  const fillAtScale = toScale(fill, scale);
  const referenceAtScale = toScale(reference, scale);
  if (side === "BUY") {
    return fillAtScale * 10_000n <= referenceAtScale * (10_000n + BigInt(maxBps));
  }
  if (side === "SELL") {
    return fillAtScale * 10_000n >= referenceAtScale * (10_000n - BigInt(maxBps));
  }
  return false;
}

export function isIncrementAligned(value, increment) {
  try {
    const parsedValue = parseDecimal(value, "value");
    const parsedIncrement = parseDecimal(increment, "increment");
    if (parsedIncrement.coefficient <= 0n) return false;
    const scale = Math.max(parsedValue.scale, parsedIncrement.scale);
    return toScale(parsedValue, scale) % toScale(parsedIncrement, scale) === 0n;
  } catch {
    return false;
  }
}
