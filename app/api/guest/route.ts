import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createGuestAndAccounts } from "@/lib/trading";
import { errorResponse, okResponse } from "@/lib/api-response";
import { resolveAccountContext, setGuestCookie } from "@/lib/account-context";

async function handleGuest(request: NextRequest) {
  const ctx = await resolveAccountContext(request, { allowGuest: true, allowCreateGuest: true });
  await prisma.$transaction(async (tx) => {
    await createGuestAndAccounts(tx, ctx.guestId);
  });

  const response = okResponse(
    { guestId: ctx.guestId },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
  setGuestCookie(response, ctx.guestId);
  return response;
}

export async function GET(request: NextRequest) {
  try {
    return await handleGuest(request);
  } catch (error) {
    return errorResponse(error, "Failed to initialize guest.", "GUEST_INIT_FAILED");
  }
}

export async function POST(request: NextRequest) {
  try {
    return await handleGuest(request);
  } catch (error) {
    return errorResponse(error, "Failed to initialize guest.", "GUEST_INIT_FAILED");
  }
}
