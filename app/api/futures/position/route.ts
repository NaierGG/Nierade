import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAccountContext } from "@/lib/account-context";
import { errorResponse } from "@/lib/api-response";
import { symbolSchema } from "@/lib/schemas";
import { assertAllowedSymbol } from "@/lib/pricing";

export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveAccountContext(request, { allowGuest: true });
    const symbol = await assertAllowedSymbol(
      symbolSchema.parse(request.nextUrl.searchParams.get("symbol") ?? "")
    );

    const position = await prisma.futuresPosition.findUnique({
      where: {
        guestId_symbol: { guestId: ctx.guestId, symbol }
      }
    });

    return NextResponse.json({ ok: true, data: { position }, position });
  } catch (error) {
    return errorResponse(error, "Failed to fetch position.", "FUTURES_POSITION_FAILED");
  }
}
