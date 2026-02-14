import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { guestIdSchema } from "@/lib/schemas";

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { guestId?: unknown };
    const parsedGuestId = guestIdSchema.safeParse(
      typeof body.guestId === "string" ? body.guestId.trim() : ""
    );
    if (!parsedGuestId.success) {
      return NextResponse.json(
        { ok: false, error: { code: "INVALID_GUEST_ID", message: "Invalid guestId format." } },
        { status: 400 }
      );
    }
    const guestId = parsedGuestId.data;

    const existingGuest = await prisma.guest.findUnique({
      where: { id: guestId },
      select: { id: true, userId: true }
    });
    if (!existingGuest) {
      return NextResponse.json(
        { ok: false, error: { code: "GUEST_NOT_FOUND", message: "Guest not found." } },
        { status: 404 }
      );
    }

    if (existingGuest.userId === null) {
      await prisma.guest.update({
        where: { id: guestId },
        data: { userId: user.id }
      });
    }

    return NextResponse.json({ ok: true, data: { linked: true } });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, error: { code: "UNAUTHORIZED", message: error.message } },
        { status: error.statusCode }
      );
    }
    return NextResponse.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "Failed to link guest." } },
      { status: 500 }
    );
  }
}
