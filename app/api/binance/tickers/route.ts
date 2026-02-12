import { NextRequest, NextResponse } from "next/server";

interface TickerItem {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
}

export async function GET(request: NextRequest) {
  try {
    const upstream = await fetch(`${request.nextUrl.origin}/api/markets`, {
      cache: "no-store"
    });
    const body = (await upstream.json().catch(() => ({}))) as {
      ok?: boolean;
      data?: TickerItem[];
      error?: string;
    };
    if (!upstream.ok || body.ok !== true || !Array.isArray(body.data)) {
      return NextResponse.json({ tickers: [], error: "Failed to load market data." }, { status: 502 });
    }
    return NextResponse.json({ tickers: body.data });
  } catch {
    return NextResponse.json({ tickers: [], error: "Failed to load market data." }, { status: 502 });
  }
}
