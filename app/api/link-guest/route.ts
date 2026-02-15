import { NextRequest } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ApiError, errorResponse, okResponse } from "@/lib/api-response";
import { GUEST_COOKIE_NAME } from "@/lib/account-context";
import { GUEST_ID_RE } from "@/lib/schemas";

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const guestId = request.cookies.get(GUEST_COOKIE_NAME)?.value?.trim() ?? "";
    if (!GUEST_ID_RE.test(guestId)) {
      throw new ApiError("INVALID_GUEST_ID", "Valid guest session cookie is required.", 400);
    }

    const [guest, existingLinked] = await Promise.all([
      prisma.guest.findUnique({
        where: { id: guestId },
        select: { id: true, userId: true }
      }),
      prisma.guest.findFirst({
        where: { userId: user.id },
        select: { id: true }
      })
    ]);

    if (!guest) {
      throw new ApiError("GUEST_NOT_FOUND", "Guest not found.", 404);
    }
    if (existingLinked && existingLinked.id !== guestId) {
      throw new ApiError("GUEST_ALREADY_LINKED", "This user is already linked to another guest account.", 409);
    }
    if (guest.userId && guest.userId !== user.id) {
      throw new ApiError("GUEST_ALREADY_LINKED", "This guest account is linked to another user.", 409);
    }

    if (guest.userId !== user.id) {
      await prisma.guest.update({
        where: { id: guestId },
        data: { userId: user.id }
      });
    }

    return okResponse({ linked: true, guestId });
  } catch (error) {
    if (error instanceof AuthError) {
      return errorResponse(new ApiError("UNAUTHORIZED", error.message, error.statusCode), "Unauthorized.", "UNAUTHORIZED");
    }
    return errorResponse(error, "Failed to link guest.", "LINK_GUEST_FAILED");
  }
}
