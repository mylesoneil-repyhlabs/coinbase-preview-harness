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

export function isPositiveDecimal(value) {
  try {
    return parseDecimal(value).coefficient > 0n;
  } catch {
    return false;
  }
}
