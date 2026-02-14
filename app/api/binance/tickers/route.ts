import { NextResponse } from "next/server";
import { getMarketTickers } from "@/lib/market-data";

export async function GET() {
  const payload = await getMarketTickers();
  return NextResponse.json({ tickers: payload.data });
}
