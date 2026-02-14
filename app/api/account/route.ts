import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAccountContext } from "@/lib/account-context";
import { errorResponse } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveAccountContext(request, { allowGuest: true });
    const guestId = ctx.guestId;

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
      return NextResponse.json(
        { ok: false, error: { code: "ACCOUNT_NOT_FOUND", message: "Account not found." } },
        { status: 404 }
      );
    }

    const holdings = await prisma.holding.findMany({
      where: {
        guestId,
        qty: { gt: 0 }
      },
      orderBy: { symbol: "asc" }
    });

    return NextResponse.json({
      ok: true,
      data: { account, holdings },
      account,
      holdings
    });
  } catch (error) {
    return errorResponse(error, "Failed to load account.");
  }
}
