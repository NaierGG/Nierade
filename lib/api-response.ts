import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function okResponse<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function errorResponse(error: unknown, fallbackMessage: string, fallbackCode = "INTERNAL_ERROR") {
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details
        }
      },
      { status: error.status }
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          details: error.flatten()
        }
      },
      { status: 400 }
    );
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof (error as { statusCode?: unknown }).statusCode === "number" &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: fallbackCode,
          message: (error as { message: string }).message
        }
      },
      { status: (error as { statusCode: number }).statusCode }
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: {
        code: fallbackCode,
        message: fallbackMessage
      }
    },
    { status: 500 }
  );
}
