import { NextResponse } from "next/server";

interface CoinGeckoMarketItem {
  symbol?: string;
  current_price?: number;
  price_change_percentage_24h?: number | null;
  total_volume?: number;
}

interface TickerItem {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
}

const COINGECKO_MARKETS_URL =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h";
const FETCH_TIMEOUT_MS = 5000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 350;
const CACHE_TTL_MS = 30_000;

const MOCK_TICKERS: TickerItem[] = [
  { symbol: "BTCUSDT", lastPrice: 98000, priceChangePercent: 1.45, quoteVolume: 2_450_000_000 },
  { symbol: "ETHUSDT", lastPrice: 5300, priceChangePercent: 2.12, quoteVolume: 1_380_000_000 },
  { symbol: "SOLUSDT", lastPrice: 240, priceChangePercent: -0.64, quoteVolume: 680_000_000 },
  { symbol: "XRPUSDT", lastPrice: 1.86, priceChangePercent: 0.88, quoteVolume: 520_000_000 },
  { symbol: "DOGEUSDT", lastPrice: 0.32, priceChangePercent: 3.26, quoteVolume: 470_000_000 }
];

let marketsCache: { expiresAt: number; tickers: TickerItem[] } | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(input: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      cache: "no-store",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCoinGeckoMarketsWithRetry() {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetchWithTimeout(COINGECKO_MARKETS_URL, FETCH_TIMEOUT_MS);
      if (!response.ok) {
        throw new Error(`coins/markets failed: ${response.status}`);
      }
      const payload = (await response.json()) as CoinGeckoMarketItem[];
      return payload;
    } catch (error) {
      lastError = error;
      console.error("[api/markets] CoinGecko markets fetch failed", {
        attempt: attempt + 1,
        maxAttempts: MAX_RETRIES + 1,
        error: error instanceof Error ? error.message : String(error)
      });
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to fetch CoinGecko markets.");
}

function normalizeTickers(payload: CoinGeckoMarketItem[]) {
  const seen = new Set<string>();
  const tickers: TickerItem[] = [];

  for (const item of payload) {
    if (!item.symbol) continue;
    const base = item.symbol.trim().toUpperCase();
    if (!base) continue;

    const symbol = `${base}USDT`;
    if (seen.has(symbol)) continue;

    const lastPrice = item.current_price;
    const priceChangePercent = item.price_change_percentage_24h ?? 0;
    const quoteVolume = item.total_volume;
    if (
      typeof lastPrice !== "number" ||
      !Number.isFinite(lastPrice) ||
      typeof priceChangePercent !== "number" ||
      !Number.isFinite(priceChangePercent) ||
      typeof quoteVolume !== "number" ||
      !Number.isFinite(quoteVolume)
    ) {
      continue;
    }

    seen.add(symbol);
    tickers.push({
      symbol,
      lastPrice,
      priceChangePercent,
      quoteVolume
    });
  }
  return tickers;
}

export async function GET() {
  const now = Date.now();
  if (marketsCache && marketsCache.expiresAt > now) {
    return NextResponse.json(
      { ok: true, data: marketsCache.tickers, source: "coingecko", cached: true },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }

  try {
    const payload = await fetchCoinGeckoMarketsWithRetry();
    const tickers = normalizeTickers(payload);
    marketsCache = {
      tickers,
      expiresAt: now + CACHE_TTL_MS
    };

    return NextResponse.json(
      { ok: true, data: tickers, source: "coingecko", cached: false },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  } catch (error) {
    console.error("[api/markets] Falling back to mock data", {
      error: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json(
      {
        ok: true,
        data: MOCK_TICKERS,
        source: "mock",
        fallback: true,
        error: "Failed to load CoinGecko markets; serving mock data."
      },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }
}
