const DECIMAL_STRING_RE = /^\d+(?:\.\d+)?$/;

function normalize(value: string) {
  return value.trim();
}

export function isDecimalString(value: string) {
  return DECIMAL_STRING_RE.test(normalize(value));
}

export function decimalPlaces(value: string) {
  const normalized = normalize(value);
  const dotIndex = normalized.indexOf(".");
  return dotIndex === -1 ? 0 : normalized.length - dotIndex - 1;
}

function toScaledBigInt(value: string, scale: number) {
  const normalized = normalize(value);
  const [intPart, fracPart = ""] = normalized.split(".");
  const paddedFrac = (fracPart + "0".repeat(scale)).slice(0, scale);
  return BigInt(`${intPart}${paddedFrac}`);
}

export function compareDecimalStrings(a: string, b: string, scale = 6) {
  if (!isDecimalString(a) || !isDecimalString(b)) return null;
  const left = toScaledBigInt(a, scale);
  const right = toScaledBigInt(b, scale);
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

export function isValidTransferAmountString(value: string, maxDecimals = 6) {
  if (!isDecimalString(value)) return false;
  if (decimalPlaces(value) > maxDecimals) return false;
  const comparison = compareDecimalStrings(value, "0", maxDecimals);
  return comparison !== null && comparison > 0;
}
