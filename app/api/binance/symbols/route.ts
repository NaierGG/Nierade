import { NextResponse } from "next/server";

interface BinanceExchangeInfoSymbol {
  symbol: string;
  status?: string;
  quoteAsset?: string;
  baseAsset?: string;
  isSpotTradingAllowed?: boolean;
}

interface BinanceExchangeInfoResponse {
  symbols?: BinanceExchangeInfoSymbol[];
}

interface SymbolItem {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const LEVERAGED_SUFFIX_RE = /(UP|DOWN|BULL|BEAR|[0-9]+L|[0-9]+S)USDT$/;

let symbolsCache: { expiresAt: number; data: SymbolItem[] } | null = null;

function isTradableSpotUsdt(item: BinanceExchangeInfoSymbol) {
  if (!item.symbol || !item.baseAsset || !item.quoteAsset) return false;
  if (item.quoteAsset !== "USDT") return false;
  if (item.status !== "TRADING") return false;
  if (typeof item.isSpotTradingAllowed === "boolean" && !item.isSpotTradingAllowed) return false;
  if (LEVERAGED_SUFFIX_RE.test(item.symbol)) return false;
  return true;
}

function normalizeSymbols(raw: BinanceExchangeInfoSymbol[]) {
  return raw
    .filter(isTradableSpotUsdt)
    .map((item) => ({
      symbol: item.symbol,
      baseAsset: item.baseAsset as string,
      quoteAsset: item.quoteAsset as string
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export async function GET() {
  const now = Date.now();
  if (symbolsCache && symbolsCache.expiresAt > now) {
    return NextResponse.json({ symbols: symbolsCache.data, cached: true });
  }

  try {
    const response = await fetch("https://api.binance.com/api/v3/exchangeInfo", {
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`exchangeInfo failed: ${response.status}`);
    }

    const payload = (await response.json()) as BinanceExchangeInfoResponse;
    const normalized = normalizeSymbols(payload.symbols ?? []);

    symbolsCache = {
      data: normalized,
      expiresAt: now + SIX_HOURS_MS
    };

    return NextResponse.json({ symbols: normalized, cached: false });
  } catch {
    if (symbolsCache?.data?.length) {
      return NextResponse.json({ symbols: symbolsCache.data, cached: true, stale: true });
    }
    return NextResponse.json({ symbols: [], error: "Failed to load Binance symbols." }, { status: 502 });
  }
}

