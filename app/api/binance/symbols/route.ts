import { NextResponse } from "next/server";
import { getTradableSymbols } from "@/lib/market-data";

export async function GET() {
  const payload = await getTradableSymbols();
  if (!payload.symbols.length && payload.error) {
    return NextResponse.json({ symbols: [], error: payload.error }, { status: 502 });
  }
  return NextResponse.json({ symbols: payload.symbols, cached: payload.cached, stale: payload.stale });
}
