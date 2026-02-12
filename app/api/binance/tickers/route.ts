import { NextResponse } from "next/server";

interface Binance24hTicker {
  symbol?: string;
  lastPrice?: string;
  priceChangePercent?: string;
  quoteVolume?: string;
}

interface TickerItem {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
}

const LEVERAGED_SUFFIX_RE = /(UP|DOWN|BULL|BEAR|[0-9]+L|[0-9]+S)USDT$/;

function isTargetSymbol(symbol: string) {
  return symbol.endsWith("USDT") && !LEVERAGED_SUFFIX_RE.test(symbol);
}

function toFiniteNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET() {
  try {
    const response = await fetch("https://api.binance.com/api/v3/ticker/24hr", {
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`ticker/24hr failed: ${response.status}`);
    }

    const payload = (await response.json()) as Binance24hTicker[];
    const tickers: TickerItem[] = [];

    for (const item of payload) {
      if (!item.symbol || !isTargetSymbol(item.symbol)) continue;
      const lastPrice = toFiniteNumber(item.lastPrice);
      const priceChangePercent = toFiniteNumber(item.priceChangePercent);
      const quoteVolume = toFiniteNumber(item.quoteVolume);
      if (lastPrice === null || priceChangePercent === null || quoteVolume === null) continue;
      tickers.push({
        symbol: item.symbol,
        lastPrice,
        priceChangePercent,
        quoteVolume
      });
    }

    return NextResponse.json({ tickers });
  } catch {
    return NextResponse.json({ tickers: [], error: "Failed to load Binance tickers." }, { status: 502 });
  }
}

