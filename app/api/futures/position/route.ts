import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveAccountContext } from "@/lib/account-context";
import { errorResponse, okResponse } from "@/lib/api-response";
import { symbolSchema } from "@/lib/schemas";
import { assertAllowedSymbol } from "@/lib/pricing";
import { requireGuestAndAccounts } from "@/lib/trading";

export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveAccountContext(request, { allowGuest: true });
    await prisma.$transaction(async (tx) => {
      await requireGuestAndAccounts(tx, ctx.guestId);
    });

    const symbol = await assertAllowedSymbol(
      symbolSchema.parse(request.nextUrl.searchParams.get("symbol") ?? "")
    );

    const position = await prisma.futuresPosition.findUnique({
      where: {
        guestId_symbol: { guestId: ctx.guestId, symbol }
      }
    });

    return okResponse({ position });
  } catch (error) {
    return errorResponse(error, "Failed to fetch position.", "FUTURES_POSITION_FAILED");
  }
}
