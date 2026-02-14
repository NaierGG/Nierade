import { NextResponse } from "next/server";
import { getMarketTickers } from "@/lib/market-data";

export async function GET() {
  const payload = await getMarketTickers();
  return NextResponse.json(
    {
      ok: true,
      data: payload.data,
      source: payload.source,
      cached: payload.cached,
      fallback: payload.fallback
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
