import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  applyFill,
  assertSufficientBalanceOrHolding,
  ensureGuestAndAccount,
  ORDER_STATUS,
  ORDER_TYPE,
  TradingError
} from "@/lib/trading";
import { resolveAccountContext } from "@/lib/account-context";
import { createOrderSchema } from "@/lib/schemas";
import { errorResponse, ApiError } from "@/lib/api-response";
import { assertAllowedSymbol, resolveExecutionPrice } from "@/lib/pricing";

export async function GET(request: NextRequest) {
  try {
    const ctx = await resolveAccountContext(request, { allowGuest: true });

    const [openOrders, recentOrders] = await Promise.all([
      prisma.order.findMany({
        where: {
          guestId: ctx.guestId,
          status: ORDER_STATUS.OPEN
        },
        orderBy: { createdAt: "desc" }
      }),
      prisma.order.findMany({
        where: {
          guestId: ctx.guestId,
          status: { not: ORDER_STATUS.OPEN }
        },
        orderBy: { createdAt: "desc" },
        take: 25
      })
    ]);

    return NextResponse.json({
      ok: true,
      data: { openOrders, recentOrders },
      openOrders,
      recentOrders
    });
  } catch (error) {
    return errorResponse(error, "Failed to fetch orders.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = createOrderSchema.parse(await request.json());
    const ctx = await resolveAccountContext(request, {
      allowGuest: true,
      guestId: body.guestId
    });
    const guestId = ctx.guestId;

    const symbol = await assertAllowedSymbol(body.symbol);
    const side = body.side;
    const type = body.type;
    const qty = body.qty;

    if (type === ORDER_TYPE.MARKET && typeof body.currentPrice !== "number") {
      throw new ApiError("VALIDATION_ERROR", "currentPrice is required for MARKET order.", 400);
    }
    if (type === ORDER_TYPE.LIMIT && typeof body.limitPrice !== "number") {
      throw new ApiError("VALIDATION_ERROR", "limitPrice is required for LIMIT order.", 400);
    }

    const payload = await prisma.$transaction(async (tx) => {
      await ensureGuestAndAccount(tx, guestId);

      if (type === ORDER_TYPE.MARKET) {
        const { executionPrice, serverPrice } = await resolveExecutionPrice(symbol, body.currentPrice);
        const now = new Date();
        await assertSufficientBalanceOrHolding(tx, guestId, symbol, side, qty, executionPrice);

        const order = await tx.order.create({
          data: {
            guestId,
            symbol,
            side,
            type,
            qty,
            status: ORDER_STATUS.FILLED,
            filledAt: now
          }
        });

        const trade = await applyFill(tx, {
          guestId,
          symbol,
          side,
          qty,
          price: executionPrice,
          orderId: order.id
        });

        return {
          mode: "FILLED" as const,
          orderId: order.id,
          trade,
          serverPrice,
          executionPrice
        };
      }

      const pendingLimitPrice = Number(body.limitPrice);
      await assertSufficientBalanceOrHolding(tx, guestId, symbol, side, qty, pendingLimitPrice);

      const order = await tx.order.create({
        data: {
          guestId,
          symbol,
          side,
          type,
          qty,
          limitPrice: pendingLimitPrice,
          status: ORDER_STATUS.OPEN
        }
      });

      return { mode: "OPEN" as const, orderId: order.id, serverPrice: null, executionPrice: null, trade: null };
    });

    const account = await prisma.account.findUnique({
      where: { guestId }
    });
    const holdings = await prisma.holding.findMany({
      where: { guestId },
      orderBy: { symbol: "asc" }
    });
    const order = await prisma.order.findUnique({
      where: { id: payload.orderId }
    });

    return NextResponse.json({
      ok: true,
      data: {
        result: payload.mode,
        order,
        trade: payload.mode === "FILLED" ? payload.trade : null,
        account,
        holdings,
        price: {
          executionPrice: payload.executionPrice,
          serverPrice: payload.serverPrice
        }
      },
      result: payload.mode,
      order,
      trade: payload.mode === "FILLED" ? payload.trade : null,
      account,
      holdings
    });
  } catch (error) {
    if (error instanceof TradingError) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "ORDER_CREATE_FAILED",
            message: error.message
          }
        },
        { status: error.statusCode }
      );
    }
    return errorResponse(error, "Failed to create order.", "ORDER_CREATE_FAILED");
  }
}
