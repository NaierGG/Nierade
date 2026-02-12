import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { guestId?: unknown };
    const guestId = typeof body.guestId === "string" ? body.guestId.trim() : "";

    if (!guestId) {
      return NextResponse.json({ error: "guestId is required." }, { status: 400 });
    }

    const existingGuest = await prisma.guest.findUnique({
      where: { id: guestId },
      select: { id: true, userId: true }
    });
    if (!existingGuest) {
      return NextResponse.json({ error: "Guest not found." }, { status: 404 });
    }

    if (existingGuest.userId === null) {
      await prisma.guest.update({
        where: { id: guestId },
        data: { userId: user.id }
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json({ error: "Failed to link guest." }, { status: 500 });
  }
}
