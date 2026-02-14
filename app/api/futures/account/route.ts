import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAccountContext } from "@/lib/account-context";
import { errorResponse } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveAccountContext(request, { allowGuest: true });
    const account = await prisma.futuresAccount.findUnique({
      where: { guestId: ctx.guestId },
      select: {
        id: true,
        guestId: true,
        cashUSDT: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!account) {
      return NextResponse.json(
        { ok: false, error: { code: "ACCOUNT_NOT_FOUND", message: "Futures account not found." } },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, data: { account }, account });
  } catch (error) {
    return errorResponse(error, "Failed to load futures account.");
  }
}
