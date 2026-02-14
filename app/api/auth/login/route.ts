import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { createSession, setSessionCookie } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getKey } from "@/lib/rate-limit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

function getClientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const limit = await checkRateLimit(getKey("auth:login", ip), RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "RATE_LIMITED",
          message: "Too many login attempts. Please try again later."
        }
      },
      { status: 429 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_EMAIL", message: "Please provide a valid email." } },
      { status: 400 }
    );
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password." } },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      passwordHash: true
    }
  });
  if (!user) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password." } },
      { status: 401 }
    );
  }

  const isValidPassword = await bcrypt.compare(password, user.passwordHash);
  if (!isValidPassword) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password." } },
      { status: 401 }
    );
  }

  const { token, expiresAt } = await createSession(user.id);
  const response = NextResponse.json({
    ok: true,
    data: {
      user: {
        id: user.id,
        email: user.email
      }
    },
    user: {
      id: user.id,
      email: user.email
    }
  });
  setSessionCookie(response, token, expiresAt);
  return response;
}
