import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const SESSION_COOKIE_NAME = "session_token";
const SESSION_TTL_DAYS = 30;

export class AuthError extends Error {
  constructor(message: string, public readonly statusCode = 401) {
    super(message);
    this.name = "AuthError";
  }
}

function getCookieSecure() {
  if (process.env.AUTH_COOKIE_SECURE === "true") return true;
  if (process.env.AUTH_COOKIE_SECURE === "false") return false;
  return process.env.NODE_ENV === "production";
}

export function getSessionExpiryDate() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_TTL_DAYS);
  return expiresAt;
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: Date) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: getCookieSecure(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: getCookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = getSessionExpiryDate();

  const session = await prisma.session.create({
    data: {
      userId,
      token,
      expiresAt
    }
  });

  return { session, token, expiresAt };
}

export async function getSessionFromRequest(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { token },
    include: {
      user: {
        select: {
          id: true,
          email: true
        }
      }
    }
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => null);
    return null;
  }

  return session;
}

export async function requireUser(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    throw new AuthError("Unauthorized.");
  }
  return session.user;
}

export async function logout(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return;
  }

  await prisma.session.deleteMany({
    where: { token }
  });
}
