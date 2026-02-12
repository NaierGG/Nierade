import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  applyFill,
  assertSufficientBalanceOrHolding,
  ensureGuestAndAccount,
  normalizeSymbol,
  ORDER_SIDE,
  ORDER_STATUS,
  ORDER_TYPE,
  OrderSide,
  OrderType,
  TradingError,
  validateNewOrderInput
} from "@/lib/trading";

function parseOrderSide(value: unknown): OrderSide {
  if (value === ORDER_SIDE.BUY || value === ORDER_SIDE.SELL) {
    return value;
  }
  throw new TradingError("side must be BUY or SELL.");
}

function parseOrderType(value: unknown): OrderType {
  if (value === ORDER_TYPE.MARKET || value === ORDER_TYPE.LIMIT) {
    return value;
  }
  throw new TradingError("type must be MARKET or LIMIT.");
}

export async function GET(request: NextRequest) {
  const guestId = request.nextUrl.searchParams.get("guestId")?.trim();
  if (!guestId) {
    return NextResponse.json({ error: "guestId is required." }, { status: 400 });
  }

  const [openOrders, recentOrders] = await Promise.all([
    prisma.order.findMany({
      where: {
        guestId,
        status: ORDER_STATUS.OPEN
      },
      orderBy: { createdAt: "desc" }
    }),
    prisma.order.findMany({
      where: {
        guestId,
        status: { not: ORDER_STATUS.OPEN }
      },
      orderBy: { createdAt: "desc" },
      take: 25
    })
  ]);

  return NextResponse.json({
    openOrders,
    recentOrders
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      guestId?: unknown;
      symbol?: unknown;
      side?: unknown;
      type?: unknown;
      qty?: unknown;
      limitPrice?: unknown;
      currentPrice?: unknown;
    };

    const guestId =
      typeof body.guestId === "string" ? body.guestId.trim() : "";
    const symbol = normalizeSymbol(typeof body.symbol === "string" ? body.symbol : "");
    const side = parseOrderSide(body.side);
    const type = parseOrderType(body.type);
    const qty = Number(body.qty);
    const limitPrice =
      body.limitPrice === null || body.limitPrice === undefined
        ? undefined
        : Number(body.limitPrice);
    const currentPrice =
      body.currentPrice === null || body.currentPrice === undefined
        ? undefined
        : Number(body.currentPrice);

    validateNewOrderInput({
      guestId,
      symbol,
      side,
      type,
      qty,
      limitPrice,
      currentPrice
    });

    const payload = await prisma.$transaction(async (tx) => {
      await ensureGuestAndAccount(tx, guestId);

      if (type === ORDER_TYPE.MARKET) {
        const fillPrice = Number(currentPrice);
        const now = new Date();
        await assertSufficientBalanceOrHolding(tx, guestId, symbol, side, qty, fillPrice);

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
          price: fillPrice,
          orderId: order.id
        });

        return { mode: "FILLED", orderId: order.id, trade };
      }

      const pendingLimitPrice = Number(limitPrice);
      await assertSufficientBalanceOrHolding(
        tx,
        guestId,
        symbol,
        side,
        qty,
        pendingLimitPrice
      );

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

      return { mode: "OPEN", orderId: order.id };
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
      result: payload.mode,
      order,
      trade: payload.mode === "FILLED" ? payload.trade : null,
      account,
      holdings
    });
  } catch (error) {
    const message =
      error instanceof TradingError ? error.message : "Failed to create order.";
    const statusCode = error instanceof TradingError ? error.statusCode : 500;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
