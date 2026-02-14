import { NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-response";
import { guestIdSchema } from "@/lib/schemas";

export type AccountContext =
  | { mode: "AUTH"; userId: string; guestId: string }
  | { mode: "GUEST"; guestId: string };

interface ResolveAccountContextOptions {
  allowGuest?: boolean;
  guestId?: unknown;
}

export async function resolveAccountContext(
  request: NextRequest,
  options: ResolveAccountContextOptions = {}
): Promise<AccountContext> {
  const session = await getSessionFromRequest(request);
  const sessionUserId = session?.user.id ?? "";

  if (sessionUserId) {
    const linkedGuest = await prisma.guest.findFirst({
      where: { userId: sessionUserId },
      orderBy: { createdAt: "desc" },
      select: { id: true }
    });

    if (!linkedGuest) {
      throw new ApiError("ACCOUNT_NOT_LINKED", "Linked guest account not found for authenticated user.", 404);
    }

    return {
      mode: "AUTH",
      userId: sessionUserId,
      guestId: linkedGuest.id
    };
  }

  if (options.allowGuest === false) {
    throw new ApiError("UNAUTHORIZED", "Authentication required.", 401);
  }

  const candidateGuestId =
    (typeof options.guestId === "string" ? options.guestId : "") ||
    request.nextUrl.searchParams.get("guestId") ||
    request.headers.get("x-guest-id") ||
    "";

  const parsedGuestId = guestIdSchema.safeParse(candidateGuestId.trim());
  if (!parsedGuestId.success) {
    throw new ApiError("INVALID_GUEST_ID", "Invalid guestId format.", 400, {
      expected: "guest_<uuid>",
      source: "query|header|body"
    });
  }

  return {
    mode: "GUEST",
    guestId: parsedGuestId.data
  };
}
