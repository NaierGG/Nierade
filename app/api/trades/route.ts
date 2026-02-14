import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAccountContext } from "@/lib/account-context";
import { errorResponse } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveAccountContext(request, { allowGuest: true });
    const trades = await prisma.trade.findMany({
      where: { guestId: ctx.guestId },
      orderBy: { createdAt: "desc" },
      take: 50
    });

    return NextResponse.json({ ok: true, data: { trades }, trades });
  } catch (error) {
    return errorResponse(error, "Failed to fetch trades.");
  }
}
