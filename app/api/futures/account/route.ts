import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const guestId = request.nextUrl.searchParams.get("guestId")?.trim();
  if (!guestId) {
    return NextResponse.json({ error: "guestId is required." }, { status: 400 });
  }

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
