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
      return NextResponse.json({ error: "Linked futures account not found for user." }, { status: 404 });
    }
    guestId = linkedGuest.id;
  } else {
    guestId = guestIdQuery;
    if (!guestId) {
      return NextResponse.json({ error: "guestId is required when no authenticated session exists." }, { status: 400 });
    }
  }

  console.info("[futures-balance:account-resolution]", {
    hasSession: Boolean(sessionUserId),
    sessionUserId: sessionUserId || null,
    queryUserId: userIdQuery || null,
    queryGuestId: guestIdQuery || null,
    resolvedGuestId: guestId,
    accountMode: effectiveUserId ? "AUTH_USER" : "GUEST"
  });

  const account = await prisma.futuresAccount.findUnique({
    where: { guestId },
    select: {
      id: true,
      guestId: true,
      cashUSDT: true,
      createdAt: true,
      updatedAt: true
    }
  });

  if (!account) {
    return NextResponse.json({ error: "Futures account not found." }, { status: 404 });
  }

  return NextResponse.json({ account });
}
