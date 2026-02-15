import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-response";
import { GUEST_ID_RE } from "@/lib/schemas";

export type AccountContext =
  | { mode: "AUTH"; userId: string; guestId: string }
  | { mode: "GUEST"; guestId: string; createdGuestId?: string };

interface ResolveAccountContextOptions {
  allowGuest?: boolean;
  allowCreateGuest?: boolean;
}

export const GUEST_COOKIE_NAME = "guest_id";

function getCookieSecure() {
  if (process.env.AUTH_COOKIE_SECURE === "true") return true;
  if (process.env.AUTH_COOKIE_SECURE === "false") return false;
  return process.env.NODE_ENV === "production";
}

function validateGuestIdFormat(guestId: string) {
  if (!GUEST_ID_RE.test(guestId)) {
    throw new ApiError("INVALID_GUEST_ID", "Invalid guestId format.", 400, {
      expected: "guest_<uuid>",
      source: "cookie"
    });
  }
  return guestId;
}

export function setGuestCookie(response: NextResponse, guestId: string) {
  const validatedGuestId = validateGuestIdFormat(guestId);
  response.cookies.set({
    name: GUEST_COOKIE_NAME,
    value: validatedGuestId,
    httpOnly: true,
    secure: getCookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365
  });
}

export function clearGuestCookie(response: NextResponse) {
  response.cookies.set({
    name: GUEST_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: getCookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
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

  const cookieGuestId = request.cookies.get(GUEST_COOKIE_NAME)?.value?.trim() ?? "";
  if (cookieGuestId) {
    return {
      mode: "GUEST",
      guestId: validateGuestIdFormat(cookieGuestId)
    };
  }

  if (!options.allowCreateGuest) {
    throw new ApiError("GUEST_SESSION_REQUIRED", "Guest session not initialized.", 401);
  }

  const guestId = `guest_${crypto.randomUUID()}`;
  validateGuestIdFormat(guestId);

  return {
    mode: "GUEST",
    guestId,
    createdGuestId: guestId
  };
}
