import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAccountContext } from "@/lib/account-context";
import { errorResponse, okResponse, ApiError } from "@/lib/api-response";
import { requireGuestAndAccounts } from "@/lib/trading";

export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveAccountContext(request, { allowGuest: true });
    const guestId = ctx.guestId;

    await prisma.$transaction(async (tx) => {
      await requireGuestAndAccounts(tx, guestId);
    });

    const account = await prisma.account.findUnique({
      where: { guestId },
      select: {
        id: true,
        guestId: true,
        cashUSDT: true,
        startingCash: true,
        realizedPnl: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!account) {
      throw new ApiError("ACCOUNT_NOT_FOUND", "Account not found.", 404);
    }

    const holdings = await prisma.holding.findMany({
      where: {
        guestId,
        qty: { gt: 0 }
      },
      orderBy: { symbol: "asc" }
    });

    return okResponse({ account, holdings });
  } catch (error) {
    return errorResponse(error, "Failed to load account.");
  }
}
