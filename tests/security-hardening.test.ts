import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resolveAccountContext } from "@/lib/account-context";
import { spendSpotCash } from "@/lib/ledger";
import { ApiError } from "@/lib/api-response";
import { verifyDrift } from "@/lib/pricing";

vi.mock("@/lib/auth", () => ({
  getSessionFromRequest: vi.fn()
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    guest: {
      findFirst: vi.fn()
    }
  }
}));

describe("Security hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("AUTH mode ignores client guestId and resolves by linked user guest", async () => {
    const { getSessionFromRequest } = await import("@/lib/auth");
    const { prisma } = await import("@/lib/prisma");

    vi.mocked(getSessionFromRequest).mockResolvedValue({
      user: { id: "user_1", email: "u@test.com" }
    } as never);
    vi.mocked(prisma.guest.findFirst).mockResolvedValue({ id: "guest_auth" } as never);

    const request = new NextRequest("http://localhost/api/orders?guestId=guest_attacker", {
      headers: { cookie: "guest_id=guest_attacker" }
    });

    const ctx = await resolveAccountContext(request, { allowGuest: true });
    expect(ctx).toEqual({
      mode: "AUTH",
      userId: "user_1",
      guestId: "guest_auth"
    });
  });

  it("Concurrent spend cannot overdraft spot cash", async () => {
    let cash = 150;
    const tx = {
      account: {
        updateMany: vi.fn(async ({ where, data }: { where: { cashUSDT: { gte: number } }; data: { cashUSDT: { decrement: number } } }) => {
          await Promise.resolve();
          if (cash >= where.cashUSDT.gte) {
            cash -= data.cashUSDT.decrement;
            return { count: 1 };
          }
          return { count: 0 };
        })
      }
    };

    const results = await Promise.allSettled([
      spendSpotCash(tx as never, "guest_1", 100),
      spendSpotCash(tx as never, "guest_1", 100)
    ]);

    const successCount = results.filter((r) => r.status === "fulfilled").length;
    const failCount = results.filter((r) => r.status === "rejected").length;
    expect(successCount).toBe(1);
    expect(failCount).toBe(1);
    expect(cash).toBe(50);
  });

  it("Cron fill fills eligible LIMIT orders using server price", async () => {
    vi.resetModules();

    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "order_1",
          guestId: "guest_1",
          symbol: "BTCUSDT"
        }
      ])
      .mockResolvedValueOnce([]);
    const tx = {};
    const prismaMock = {
      order: { findMany },
      $transaction: vi.fn(async (fn: (txArg: unknown) => Promise<unknown>) => fn(tx))
    };

    vi.doMock("@/lib/prisma", () => ({ prisma: prismaMock }));
    vi.doMock("@/lib/pricing", () => ({ getServerPrice: vi.fn().mockResolvedValue(100) }));
    vi.doMock("@/lib/order-fill", () => ({
      fillLimitOrderWithPrice: vi.fn().mockResolvedValue({ filled: true, trade: { id: "trade_1" } })
    }));

    process.env.CRON_SECRET = "test-secret";
    const { GET } = await import("@/app/api/cron/fill-limit-orders/route");
    const response = await GET({
      headers: { get: (key: string) => (key === "x-cron-secret" ? "test-secret" : null) }
    } as unknown as NextRequest);

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.filled).toBe(1);
    expect(body.data.scanned).toBe(1);
  });

  it("Price drift rejects manipulated client price", () => {
    expect(() => verifyDrift(110, 100, 0.5)).toThrowError(ApiError);
    try {
      verifyDrift(110, 100, 0.5);
    } catch (error) {
      expect((error as ApiError).code).toBe("PRICE_DRIFT");
    }
  });
});
