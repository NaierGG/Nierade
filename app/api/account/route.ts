import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  const sessionUserId = session?.user.id ?? "";
  const userIdQuery = request.nextUrl.searchParams.get("userId")?.trim() ?? "";
  const guestIdQuery = request.nextUrl.searchParams.get("guestId")?.trim() ?? "";
  const effectiveUserId = sessionUserId;

  let guestId = "";
  if (effectiveUserId) {
    const linkedGuest = await prisma.guest.findFirst({
      where: { userId: effectiveUserId },
      orderBy: { createdAt: "desc" },
      select: { id: true }
    });
    if (!linkedGuest) {
      return NextResponse.json({ error: "Linked account not found for user." }, { status: 404 });
    }
    guestId = linkedGuest.id;
  } else {
    guestId = guestIdQuery;
    if (!guestId) {
      return NextResponse.json({ error: "guestId is required when no authenticated session exists." }, { status: 400 });
    }
  }

  console.info("[account-balance:account-resolution]", {
    hasSession: Boolean(sessionUserId),
    sessionUserId: sessionUserId || null,
    queryUserId: userIdQuery || null,
    queryGuestId: guestIdQuery || null,
    resolvedGuestId: guestId,
    accountMode: effectiveUserId ? "AUTH_USER" : "GUEST"
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
