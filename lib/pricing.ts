import { ApiError } from "@/lib/api-response";
import { isAllowedSymbol } from "@/lib/market-data";
import { normalizeSymbol } from "@/lib/trading";

const BINANCE_TICKER_URL = "https://api.binance.com/api/v3/ticker/price";
const PRICE_CACHE_TTL_MS = 1_000;
const PRICE_TIMEOUT_MS = 2_500;

const priceCache = new Map<string, { value: number; expiresAt: number }>();

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
  const now = Date.now();
  const cached = priceCache.get(normalized);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PRICE_TIMEOUT_MS);
  try {
    const response = await fetch(`${BINANCE_TICKER_URL}?symbol=${encodeURIComponent(normalized)}`, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store"
    });
    if (!response.ok) {
      throw new ApiError("PRICE_UNAVAILABLE", `Failed to load server price for ${normalized}.`, 502, {
        status: response.status
      });
    }

    const payload = (await response.json()) as { price?: string };
    const parsed = Number(payload.price);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new ApiError("PRICE_UNAVAILABLE", `Invalid server price for ${normalized}.`, 502);
    }

    priceCache.set(normalized, { value: parsed, expiresAt: now + PRICE_CACHE_TTL_MS });
    return parsed;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError("PRICE_UNAVAILABLE", `Server price lookup failed for ${normalized}.`, 502);
  } finally {
    clearTimeout(timeout);
  }
}

export function verifyDrift(clientPrice: number, serverPrice: number, maxPct = 0.5) {
  if (!Number.isFinite(clientPrice) || clientPrice <= 0) {
    throw new ApiError("INVALID_CLIENT_PRICE", "clientPrice must be a positive number.", 400);
  }
  if (!Number.isFinite(serverPrice) || serverPrice <= 0) {
    throw new ApiError("PRICE_UNAVAILABLE", "serverPrice must be a positive number.", 502);
  }
  const driftPct = Math.abs(((clientPrice - serverPrice) / serverPrice) * 100);
  if (driftPct > maxPct) {
    throw new ApiError("PRICE_DRIFT", `Price drift exceeds ${maxPct}% threshold.`, 400, {
      clientPrice,
      serverPrice,
      driftPct
    });
  }
  return driftPct;
}
