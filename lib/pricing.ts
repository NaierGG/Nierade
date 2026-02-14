import { ApiError } from "@/lib/api-response";
import { getLastPriceForSymbol, isAllowedSymbol } from "@/lib/market-data";
import { normalizeSymbol } from "@/lib/trading";

export async function assertAllowedSymbol(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  const allowed = await isAllowedSymbol(normalized);
  if (!allowed) {
    throw new ApiError("UNSUPPORTED_SYMBOL", `Symbol ${normalized} is not supported.`, 400);
  }
  return normalized;
}

export async function getServerPrice(symbol: string) {
  const normalized = normalizeSymbol(symbol);
  const serverPrice = await getLastPriceForSymbol(normalized);
  if (typeof serverPrice !== "number" || !Number.isFinite(serverPrice) || serverPrice <= 0) {
    throw new ApiError("PRICE_UNAVAILABLE", `No server price available for ${normalized}.`, 502);
  }
  return serverPrice;
}

export function verifyPriceDrift(clientPrice: number, serverPrice: number, maxDriftPct = 0.5) {
  if (!Number.isFinite(clientPrice) || clientPrice <= 0) {
    throw new ApiError("INVALID_CLIENT_PRICE", "clientPrice must be a positive number.", 400);
  }
  if (!Number.isFinite(serverPrice) || serverPrice <= 0) {
    throw new ApiError("INVALID_SERVER_PRICE", "serverPrice must be a positive number.", 500);
  }
  const driftPct = Math.abs((clientPrice - serverPrice) / serverPrice) * 100;
  if (driftPct > maxDriftPct) {
    throw new ApiError("PRICE_DRIFT_EXCEEDED", `Price drift exceeds ${maxDriftPct}% threshold.`, 400, {
      clientPrice,
      serverPrice,
      driftPct
    });
  }
  return driftPct;
}

export async function resolveExecutionPrice(symbol: string, clientPrice?: number, maxDriftPct = 0.5) {
  const serverPrice = await getServerPrice(symbol);
  if (typeof clientPrice === "number" && Number.isFinite(clientPrice)) {
    verifyPriceDrift(clientPrice, serverPrice, maxDriftPct);
    return {
      executionPrice: clientPrice,
      serverPrice
    };
  }
  return {
    executionPrice: serverPrice,
    serverPrice
  };
}
