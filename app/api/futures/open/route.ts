import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  computeLiquidationPrice,
  FUTURES_ACTION,
  FUTURES_MMR,
  FUTURES_TAKER_FEE,
  normalizeFuturesSymbol,
  parseFuturesSide,
  parsePositiveNumber,
  validateLeverage
} from "@/lib/futures";
import { ensureGuestAndAccount, TradingError } from "@/lib/trading";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      guestId?: unknown;
      symbol?: unknown;
      side?: unknown;
      leverage?: unknown;
      margin?: unknown;
      currentPrice?: unknown;
    };

    const guestId = typeof body.guestId === "string" ? body.guestId.trim() : "";
    if (!guestId) {
      throw new TradingError("guestId is required.");
    }
    const symbol = normalizeFuturesSymbol(body.symbol);
    const side = parseFuturesSide(body.side);
    const parsedLeverage = Number(body.leverage);
    if (!Number.isFinite(parsedLeverage)) {
      throw new TradingError("leverage must be a finite number.");
    }
    const leverage = validateLeverage(Math.floor(parsedLeverage));
    const margin = parsePositiveNumber(body.margin, "margin");
    const currentPrice = parsePositiveNumber(body.currentPrice, "currentPrice");

    const payload = await prisma.$transaction(async (tx) => {
      await ensureGuestAndAccount(tx, guestId);

      const existing = await tx.futuresPosition.findUnique({
        where: { guestId_symbol: { guestId, symbol } }
      });
      if (existing) {
        throw new TradingError("Position already exists for this symbol.");
      }

      const futuresAccount = await tx.futuresAccount.findUnique({ where: { guestId } });
      if (!futuresAccount) {
        throw new TradingError("Futures account not found.", 404);
      }

      const notional = margin * leverage;
      const qty = notional / currentPrice;
      const maintenance = notional * FUTURES_MMR;
      const liquidationPrice = computeLiquidationPrice(side, currentPrice, margin, leverage);
      const openFee = notional * FUTURES_TAKER_FEE;
      const required = margin + openFee;

      if (futuresAccount.cashUSDT < required) {
        throw new TradingError("Insufficient Futures cashUSDT.");
      }

      const [account, position, trade] = await Promise.all([
        tx.futuresAccount.update({
          where: { guestId },
          data: {
            cashUSDT: { decrement: required }
          }
        }),
        tx.futuresPosition.create({
          data: {
            guestId,
            symbol,
            side,
            leverage,
            margin,
            entryPrice: currentPrice,
            qty,
            liquidationPrice
          }
        }),
        tx.futuresTrade.create({
          data: {
            guestId,
            symbol,
            side,
            action: FUTURES_ACTION.OPEN,
            qty,
            price: currentPrice,
            fee: openFee,
            realizedPnl: 0
          }
        })
      ]);

      return { account, position, trade, maintenance };
    });

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof TradingError ? error.message : "Failed to open futures position.";
    const statusCode = error instanceof TradingError ? error.statusCode : 500;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
