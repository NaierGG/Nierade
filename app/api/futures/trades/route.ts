import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAccountContext } from "@/lib/account-context";
import { errorResponse, okResponse } from "@/lib/api-response";
import { requireGuestAndAccounts } from "@/lib/trading";

export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveAccountContext(request, { allowGuest: true });
    await prisma.$transaction(async (tx) => {
      await requireGuestAndAccounts(tx, ctx.guestId);
    });

    const trades = await prisma.futuresTrade.findMany({
      where: { guestId: ctx.guestId },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    return okResponse({ trades });
  } catch (error) {
    return errorResponse(error, "Failed to fetch futures trades.", "FUTURES_TRADES_FAILED");
  }
}
