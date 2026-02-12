export function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2
  }).format(value);
}

export function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
}

export function formatTradePrice(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  if (value >= 1000) {
    return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (value >= 1) {
    return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }
  return value.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 8 });
}

export function formatQty(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 6 });
}

export function formatUsd(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatPct(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return `${value.toFixed(2)}%`;
}
