import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const guestId = request.nextUrl.searchParams.get("guestId")?.trim();
  if (!guestId) {
    return NextResponse.json({ error: "guestId is required." }, { status: 400 });
  }

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
    return NextResponse.json({ error: "Account not found." }, { status: 404 });
  }

  const holdings = await prisma.holding.findMany({
    where: {
      guestId,
      qty: { gt: 0 }
    },
    orderBy: { symbol: "asc" }
  });

  return NextResponse.json({
    account,
    holdings
  });
}
