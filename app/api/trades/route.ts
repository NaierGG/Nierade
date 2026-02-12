import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const guestId = request.nextUrl.searchParams.get("guestId")?.trim();
  if (!guestId) {
    return NextResponse.json({ error: "guestId is required." }, { status: 400 });
  }

  const trades = await prisma.trade.findMany({
    where: { guestId },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  return NextResponse.json({ trades });
}
