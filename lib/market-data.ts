interface CoinGeckoMarketItem {
  symbol?: string;
  current_price?: number;
  price_change_percentage_24h?: number | null;
  total_volume?: number;
}

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

export interface TickerItem {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
}

export interface SymbolItem {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
}

const COINGECKO_MARKETS_URL =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h";
const FETCH_TIMEOUT_MS = 5000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 350;
const MARKETS_CACHE_TTL_MS = 30_000;

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const LEVERAGED_SUFFIX_RE = /(UP|DOWN|BULL|BEAR|[0-9]+L|[0-9]+S)USDT$/;

const MOCK_TICKERS: TickerItem[] = [
  { symbol: "BTCUSDT", lastPrice: 98000, priceChangePercent: 1.45, quoteVolume: 2_450_000_000 },
  { symbol: "ETHUSDT", lastPrice: 5300, priceChangePercent: 2.12, quoteVolume: 1_380_000_000 },
  { symbol: "SOLUSDT", lastPrice: 240, priceChangePercent: -0.64, quoteVolume: 680_000_000 },
  { symbol: "XRPUSDT", lastPrice: 1.86, priceChangePercent: 0.88, quoteVolume: 520_000_000 },
  { symbol: "DOGEUSDT", lastPrice: 0.32, priceChangePercent: 3.26, quoteVolume: 470_000_000 }
];

let marketsCache: { expiresAt: number; tickers: TickerItem[]; source: "coingecko" | "mock"; fallback?: boolean } | null = null;
let symbolsCache: { expiresAt: number; data: SymbolItem[] } | null = null;

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
      return (await response.json()) as CoinGeckoMarketItem[];
    } catch (error) {
      lastError = error;
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
    tickers.push({ symbol, lastPrice, priceChangePercent, quoteVolume });
  }
  return tickers;
}

export async function getMarketTickers() {
  const now = Date.now();
  if (marketsCache && marketsCache.expiresAt > now) {
    return {
      ok: true as const,
      data: marketsCache.tickers,
      source: marketsCache.source,
      cached: true,
      fallback: marketsCache.fallback ?? false
    };
  }

  try {
    const payload = await fetchCoinGeckoMarketsWithRetry();
    const tickers = normalizeTickers(payload);
    marketsCache = {
      tickers,
      source: "coingecko",
      expiresAt: now + MARKETS_CACHE_TTL_MS
    };

    return { ok: true as const, data: tickers, source: "coingecko", cached: false, fallback: false };
  } catch {
    marketsCache = {
      tickers: MOCK_TICKERS,
      source: "mock",
      fallback: true,
      expiresAt: now + MARKETS_CACHE_TTL_MS
    };
    return { ok: true as const, data: MOCK_TICKERS, source: "mock", cached: false, fallback: true };
  }
}

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

export async function getTradableSymbols() {
  const now = Date.now();
  if (symbolsCache && symbolsCache.expiresAt > now) {
    return { symbols: symbolsCache.data, cached: true as const, stale: false as const };
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

    return { symbols: normalized, cached: false as const, stale: false as const };
  } catch {
    if (symbolsCache?.data?.length) {
      return { symbols: symbolsCache.data, cached: true as const, stale: true as const };
    }
    return { symbols: [] as SymbolItem[], cached: false as const, stale: false as const, error: "Failed to load Binance symbols." };
  }
}

export async function isAllowedSymbol(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  const [symbolsResp, tickersResp] = await Promise.all([getTradableSymbols(), getMarketTickers()]);
  const symbolSet = new Set<string>(symbolsResp.symbols.map((item) => item.symbol));
  for (const ticker of tickersResp.data) {
    symbolSet.add(ticker.symbol);
  }
  return symbolSet.has(normalized);
}

export async function getLastPriceForSymbol(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  const tickersResp = await getMarketTickers();
  const ticker = tickersResp.data.find((item) => item.symbol === normalized);
  return typeof ticker?.lastPrice === "number" ? ticker.lastPrice : null;
}
