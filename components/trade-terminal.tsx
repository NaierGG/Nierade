
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ChartPanel } from "@/components/chart-panel";
import { SymbolPicker } from "@/components/symbol-picker";
import { useBinanceMultiStream } from "@/components/use-binance-multi-stream";
import { useDebouncedEffect } from "@/components/useDebouncedEffect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { compareDecimalStrings, isValidTransferAmountString } from "@/lib/money";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { formatPct, formatQty, formatTradePrice as formatPrice, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

const DEFAULT_SYMBOL = "BTCUSDT";
const LIMIT_FILL_DEBOUNCE_MS = 800;
const LIQUIDATION_CHECK_DEBOUNCE_MS = 400;
const MAX_RECONNECT_MS = 10000;
const FUTURES_MMR = 0.005;
const FUTURES_TAKER_FEE = 0.0004;
const FUTURES_MIN_LEVERAGE = 1;
const FUTURES_MAX_LEVERAGE = 100;
const FUTURES_LEVERAGE_PRESETS = [1, 5, 10, 20, 50, 100] as const;
const TRANSFER_MIN_USDT_TEXT = "0.01";
const SYMBOL_RE = /^[A-Z0-9]{5,20}$/;

type Side = "BUY" | "SELL";
type OrderType = "MARKET" | "LIMIT";
type OrderStatus = "OPEN" | "FILLED" | "CANCELED";
type WsStatus = "CONNECTING" | "LIVE" | "RECONNECTING" | "ERROR";
type TradeMode = "SPOT" | "FUTURES";
type FuturesSide = "LONG" | "SHORT";

interface AccountData {
  id: string;
  guestId: string;
  cashUSDT: number;
  startingCash: number;
  realizedPnl: number;
  createdAt: string;
  updatedAt: string;
}

interface HoldingData {
  id: string;
  guestId: string;
  symbol: string;
  qty: number;
  avgPrice: number;
}

interface OrderData {
  id: string;
  guestId: string;
  symbol: string;
  side: Side;
  type: OrderType;
  qty: number;
  limitPrice: number | null;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
}

interface TradeData {
  id: string;
  guestId: string;
  symbol: string;
  side: Side;
  qty: number;
  price: number;
  orderId: string | null;
  createdAt: string;
}

interface FuturesAccountData {
  id: string;
  guestId: string;
  cashUSDT: number;
  createdAt: string;
  updatedAt: string;
}

interface FuturesPositionData {
  id: string;
  guestId: string;
  symbol: string;
  side: FuturesSide;
  leverage: number;
  margin: number;
  entryPrice: number;
  qty: number;
  liquidationPrice: number;
  createdAt: string;
  updatedAt: string;
}

function toNumberOrNull(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function toInputQty(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return String(Number(value.toFixed(6)));
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function roundDown(n: number, decimals = 6) {
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** decimals;
  return Math.floor(n * factor) / factor;
}

function isUsdtSymbolCandidate(value: string) {
  return SYMBOL_RE.test(value) && value.endsWith("USDT");
}

function clampFuturesLeverage(value: number) {
  if (!Number.isFinite(value)) return FUTURES_MIN_LEVERAGE;
  return Math.min(FUTURES_MAX_LEVERAGE, Math.max(FUTURES_MIN_LEVERAGE, Math.floor(value)));
}

function useSelectedSymbolLastPrice(symbol: string) {
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<WsStatus>("CONNECTING");
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let isUnmounted = false;

    const connect = () => {
      setWsStatus((prev) => (prev === "LIVE" ? "LIVE" : "CONNECTING"));
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@trade`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isUnmounted) return;
        reconnectAttemptsRef.current = 0;
        setError(null);
        setWsStatus("LIVE");
      };

      ws.onmessage = (event) => {
        if (isUnmounted) return;
        try {
          const payload = JSON.parse(event.data) as { p?: string };
          if (!payload.p) return;
          const price = Number(payload.p);
          if (!Number.isNaN(price)) setLastPrice(price);
        } catch {
          setError("Failed to parse market stream.");
          setWsStatus("ERROR");
        }
      };

      ws.onerror = () => {
        if (isUnmounted) return;
        setError("Market stream error.");
        setWsStatus("ERROR");
      };

      ws.onclose = () => {
        if (isUnmounted) return;
        setWsStatus("RECONNECTING");
        const attempt = reconnectAttemptsRef.current + 1;
        reconnectAttemptsRef.current = attempt;
        const timeout = Math.min(1000 * 2 ** (attempt - 1), MAX_RECONNECT_MS);
        reconnectTimerRef.current = setTimeout(connect, timeout);
      };
    };

    setLastPrice(null);
    setError(null);
    setWsStatus("CONNECTING");
    connect();

    return () => {
      isUnmounted = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [symbol]);

  return { lastPrice, error, wsStatus };
}

export function TradeTerminal() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [symbol, setSymbol] = useState(DEFAULT_SYMBOL);
  const [guestId, setGuestId] = useState<string | null>(null);
  const [guestError, setGuestError] = useState<string | null>(null);
  const [tradeMode, setTradeMode] = useState<TradeMode>("SPOT");
  const [account, setAccount] = useState<AccountData | null>(null);
  const [futuresAccount, setFuturesAccount] = useState<FuturesAccountData | null>(null);
  const [futuresPosition, setFuturesPosition] = useState<FuturesPositionData | null>(null);
  const [holdings, setHoldings] = useState<HoldingData[]>([]);
  const [openOrders, setOpenOrders] = useState<OrderData[]>([]);
  const [trades, setTrades] = useState<TradeData[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferAmount, setTransferAmount] = useState("");
  const [isOpeningFutures, setIsOpeningFutures] = useState(false);
  const [isClosingFutures, setIsClosingFutures] = useState(false);
  const [futuresSide, setFuturesSide] = useState<FuturesSide>("LONG");
  const [futuresLeverage, setFuturesLeverage] = useState(10);
  const [futuresMargin, setFuturesMargin] = useState("");
  const [orderSide, setOrderSide] = useState<Side>("BUY");
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [qtyInput, setQtyInput] = useState("");
  const [limitPriceInput, setLimitPriceInput] = useState("");
  const portfolioSymbols = useMemo(() => {
    const unique = new Set<string>([symbol]);
    for (const holding of holdings) {
      unique.add(holding.symbol);
    }
    return Array.from(unique);
  }, [symbol, holdings]);
  const { priceMap } = useBinanceMultiStream(portfolioSymbols);
  const {
    lastPrice: selectedSymbolLastPrice,
    error: streamError,
    wsStatus
  } = useSelectedSymbolLastPrice(symbol);
  const lastPrice = priceMap[symbol] ?? selectedSymbolLastPrice ?? null;
  const inFlightLimitFillRef = useRef<Set<string>>(new Set());
  const inFlightLiquidationCheckRef = useRef(false);

  useEffect(() => {
    const symbolFromUrl = searchParams.get("symbol")?.toUpperCase();
    if (symbolFromUrl && isUsdtSymbolCandidate(symbolFromUrl)) {
      setSymbol(symbolFromUrl);
      return;
    }
    setSymbol(DEFAULT_SYMBOL);
  }, [searchParams]);

  useEffect(() => {
    const existing = localStorage.getItem("guestId");
    const setupGuest = async () => {
      try {
        const response = await fetch("/api/guest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(existing ? { guestId: existing } : {})
        });
        if (!response.ok) {
          throw new Error("Failed to initialize guest session.");
        }

        const data = (await response.json()) as { guestId?: string };
        if (!data.guestId) {
          throw new Error("Invalid guest response.");
        }
        localStorage.setItem("guestId", data.guestId);
        setGuestId(data.guestId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown guest setup error.";
        setGuestError(message);
      }
    };

    void setupGuest();
  }, []);

  const fetchAccountData = useCallback(async (currentGuestId: string) => {
    const response = await fetch(`/api/account?guestId=${encodeURIComponent(currentGuestId)}`, {
      cache: "no-store"
    });
    const data = (await response.json().catch(() => ({}))) as {
      account?: AccountData;
      holdings?: HoldingData[];
      error?: string;
    };
    if (!response.ok) {
      throw new Error(data.error ?? "Failed to fetch account.");
    }
    setAccount(data.account ?? null);
    setHoldings(data.holdings ?? []);
  }, []);

  useEffect(() => {
    setFuturesLeverage((prev) => clampFuturesLeverage(prev));
  }, [tradeMode, symbol]);

  const fetchFuturesAccountData = useCallback(async (currentGuestId: string) => {
    const response = await fetch(
      `/api/futures/account?guestId=${encodeURIComponent(currentGuestId)}`,
      { cache: "no-store" }
    );
    const data = (await response.json().catch(() => ({}))) as {
      account?: FuturesAccountData;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(data.error ?? "Failed to fetch futures account.");
    }
    setFuturesAccount(data.account ?? null);
  }, []);

  const fetchFuturesPositionData = useCallback(
    async (currentGuestId: string, currentSymbol: string) => {
      const response = await fetch(
        `/api/futures/position?guestId=${encodeURIComponent(currentGuestId)}&symbol=${encodeURIComponent(currentSymbol)}`,
        {
          cache: "no-store"
        }
      );
      const data = (await response.json().catch(() => ({}))) as {
        position?: FuturesPositionData | null;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to fetch futures position.");
      }
      setFuturesPosition(data.position ?? null);
    },
    []
  );

  const fetchOrdersData = useCallback(async (currentGuestId: string) => {
    const response = await fetch(`/api/orders?guestId=${encodeURIComponent(currentGuestId)}`, {
      cache: "no-store"
    });
    const data = (await response.json().catch(() => ({}))) as {
      openOrders?: OrderData[];
      error?: string;
    };
    if (!response.ok) {
      throw new Error(data.error ?? "Failed to fetch orders.");
    }
    setOpenOrders(data.openOrders ?? []);
    return data;
  }, []);

  const fetchTradesData = useCallback(async (currentGuestId: string) => {
    const response = await fetch(`/api/trades?guestId=${encodeURIComponent(currentGuestId)}`, {
      cache: "no-store"
    });
    const data = (await response.json().catch(() => ({}))) as {
      trades?: TradeData[];
      error?: string;
    };
    if (!response.ok) {
      throw new Error(data.error ?? "Failed to fetch trades.");
    }
    setTrades(data.trades ?? []);
  }, []);

  const refreshAccountAndOrders = useCallback(
    async (currentGuestId: string) => {
      setIsRefreshing(true);
      try {
        await Promise.all([
          fetchAccountData(currentGuestId),
          fetchOrdersData(currentGuestId),
          fetchTradesData(currentGuestId)
        ]);
      } finally {
        setIsRefreshing(false);
      }
    },
    [fetchAccountData, fetchOrdersData, fetchTradesData]
  );

  const refreshFuturesData = useCallback(
    async (currentGuestId: string, currentSymbol: string) => {
      await Promise.all([
        fetchFuturesAccountData(currentGuestId),
        fetchFuturesPositionData(currentGuestId, currentSymbol)
      ]);
    },
    [fetchFuturesAccountData, fetchFuturesPositionData]
  );

  useEffect(() => {
    if (!guestId) return;
    void Promise.all([
      refreshAccountAndOrders(guestId),
      refreshFuturesData(guestId, symbol)
    ]);
  }, [guestId, refreshAccountAndOrders, refreshFuturesData, symbol]);

  const runLimitAutoFill = useCallback(
    async (currentGuestId: string, currentMarketPrice: number) => {
      try {
        const snapshot = await fetchOrdersData(currentGuestId);
        const candidates = (snapshot.openOrders ?? []).filter(
          (order) =>
            order.status === "OPEN" && order.type === "LIMIT" && order.symbol === symbol
        );
        if (candidates.length === 0) return;

        let filledCount = 0;
        await Promise.all(
          candidates.map(async (order) => {
            if (inFlightLimitFillRef.current.has(order.id)) {
              return;
            }

            inFlightLimitFillRef.current.add(order.id);
            try {
              const response = await fetch("/api/orders/fill", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  guestId: currentGuestId,
                  orderId: order.id,
                  currentPrice: currentMarketPrice
                })
              });

              if (!response.ok) {
                return;
              }

              const data = (await response.json().catch(() => ({}))) as {
                filled?: boolean;
              };
              if (data.filled) {
                filledCount += 1;
              }
            } finally {
              inFlightLimitFillRef.current.delete(order.id);
            }
          })
        );

        if (filledCount > 0) {
          toast.success(`${filledCount} order${filledCount > 1 ? "s" : ""} filled.`);
          await refreshAccountAndOrders(currentGuestId);
        }
      } catch {
        // keep UI resilient for background fill loop
      }
    },
    [fetchOrdersData, refreshAccountAndOrders, symbol]
  );

  useDebouncedEffect(() => {
    if (!guestId || lastPrice === null) return;
    void runLimitAutoFill(guestId, lastPrice);
  }, [guestId, lastPrice, runLimitAutoFill], LIMIT_FILL_DEBOUNCE_MS);

  useDebouncedEffect(() => {
    if (!guestId || lastPrice === null || !futuresPosition) return;
    if (futuresPosition.symbol !== symbol) return;
    if (inFlightLiquidationCheckRef.current) return;

    inFlightLiquidationCheckRef.current = true;
    void (async () => {
      try {
        const response = await fetch("/api/futures/check-liquidation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guestId,
            symbol,
            currentPrice: lastPrice
          })
        });
        if (!response.ok) return;
        const data = (await response.json().catch(() => ({}))) as { liquidated?: boolean };
        if (data.liquidated) {
          toast.warning("Position liquidated.");
          await refreshFuturesData(guestId, symbol);
        }
      } finally {
        inFlightLiquidationCheckRef.current = false;
      }
    })();
  }, [futuresPosition, guestId, lastPrice, refreshFuturesData, symbol], LIQUIDATION_CHECK_DEBOUNCE_MS);

  const onSymbolChange = (nextSymbol: string) => {
    if (!isUsdtSymbolCandidate(nextSymbol)) return;
    setSymbol(nextSymbol);

    const params = new URLSearchParams(searchParams.toString());
    params.set("symbol", nextSymbol);
    router.replace(`/trade?${params.toString()}`, { scroll: false });
  };

  useEffect(() => {
    if (!guestId) return;
    void fetchFuturesPositionData(guestId, symbol);
  }, [fetchFuturesPositionData, guestId, symbol]);

  const shortGuest = useMemo(() => {
    if (!guestId) return "loading...";
    return guestId.slice(0, 12);
  }, [guestId]);

  const selectedHolding = useMemo(
    () => holdings.find((holding) => holding.symbol === symbol),
    [holdings, symbol]
  );

  const qtyValue = toNumberOrNull(qtyInput);
  const limitPriceValue = toNumberOrNull(limitPriceInput);

  const priceStep = useMemo(() => {
    const base = orderType === "LIMIT" ? limitPriceValue ?? lastPrice ?? 0 : lastPrice ?? 0;
    if (base >= 1000) return "0.1";
    if (base >= 1) return "0.01";
    return "0.0001";
  }, [orderType, limitPriceValue, lastPrice]);

  const effectivePrice = useMemo(() => {
    if (orderType === "MARKET") return lastPrice;
    if (typeof limitPriceValue === "number" && limitPriceValue > 0) return limitPriceValue;
    return null;
  }, [orderType, lastPrice, limitPriceValue]);

  const holdingMetrics = useMemo(
    () =>
      holdings.map((holding) => {
        const price = priceMap[holding.symbol];
        const hasPrice = typeof price === "number";
        const unrealized = hasPrice ? (price - holding.avgPrice) * holding.qty : null;
        const pnlPct =
          hasPrice && holding.avgPrice > 0 ? ((price - holding.avgPrice) / holding.avgPrice) * 100 : null;
        const marketValue = hasPrice ? holding.qty * price : 0;
        return {
          holding,
          price: hasPrice ? price : null,
          unrealized,
          pnlPct,
          marketValue
        };
      }),
    [holdings, priceMap]
  );

  const totalUnrealized = useMemo(
    () => holdingMetrics.reduce((sum, row) => sum + (row.unrealized ?? 0), 0),
    [holdingMetrics]
  );

  const totalHoldingsValue = useMemo(
    () => holdingMetrics.reduce((sum, row) => sum + row.marketValue, 0),
    [holdingMetrics]
  );

  const equity = useMemo(() => {
    const cash = account?.cashUSDT ?? 0;
    return cash + totalHoldingsValue;
  }, [account?.cashUSDT, totalHoldingsValue]);

  const realizedPnl = account?.realizedPnl ?? 0;
  const totalPnl = realizedPnl + totalUnrealized;
  const startingCash = account?.startingCash ?? 10000;
  const totalReturnPct = useMemo(
    () => (startingCash > 0 ? (totalPnl / startingCash) * 100 : 0),
    [startingCash, totalPnl]
  );

  const futuresMarginValue = toNumberOrNull(futuresMargin);
  const futuresLeverageValue = clampFuturesLeverage(futuresLeverage);
  const transferAmountText = transferAmount.trim();
  const transferAmountValid = isValidTransferAmountString(transferAmountText);
  const transferAmountMeetsMin =
    transferAmountValid &&
    (compareDecimalStrings(transferAmountText, TRANSFER_MIN_USDT_TEXT) ?? -1) >= 0;
  const spotCashText = (account?.cashUSDT ?? 0).toFixed(6);
  const futuresCashText = (futuresAccount?.cashUSDT ?? 0).toFixed(6);
  const spotInsufficient =
    transferAmountMeetsMin && compareDecimalStrings(transferAmountText, spotCashText) === 1;
  const futuresInsufficient =
    transferAmountMeetsMin && compareDecimalStrings(transferAmountText, futuresCashText) === 1;

  const futuresNotionalEstimate = useMemo(() => {
    if (
      typeof futuresMarginValue !== "number" ||
      futuresMarginValue <= 0 ||
      futuresLeverageValue <= 0
    ) {
      return null;
    }
    return futuresMarginValue * futuresLeverageValue;
  }, [futuresLeverageValue, futuresMarginValue]);

  const futuresQtyEstimate = useMemo(() => {
    if (typeof futuresNotionalEstimate !== "number" || typeof lastPrice !== "number" || lastPrice <= 0) {
      return null;
    }
    return futuresNotionalEstimate / lastPrice;
  }, [futuresNotionalEstimate, lastPrice]);

  const futuresLiqEstimate = useMemo(() => {
    if (
      typeof futuresQtyEstimate !== "number" ||
      typeof futuresNotionalEstimate !== "number" ||
      typeof futuresMarginValue !== "number" ||
      typeof lastPrice !== "number"
    ) {
      return null;
    }
    const maintenance = futuresNotionalEstimate * FUTURES_MMR;
    if (futuresSide === "LONG") {
      return lastPrice + (maintenance - futuresMarginValue) / futuresQtyEstimate;
    }
    return lastPrice - (maintenance - futuresMarginValue) / futuresQtyEstimate;
  }, [futuresMarginValue, futuresNotionalEstimate, futuresQtyEstimate, futuresSide, lastPrice]);

  const futuresOpenFeeEstimate = useMemo(() => {
    if (typeof futuresNotionalEstimate !== "number") return null;
    return futuresNotionalEstimate * FUTURES_TAKER_FEE;
  }, [futuresNotionalEstimate]);

  const futuresRequiredEstimate = useMemo(() => {
    if (typeof futuresMarginValue !== "number" || futuresMarginValue <= 0) return null;
    if (typeof futuresOpenFeeEstimate !== "number") return null;
    return futuresMarginValue + futuresOpenFeeEstimate;
  }, [futuresMarginValue, futuresOpenFeeEstimate]);

  const futuresCashInsufficient = useMemo(() => {
    if (typeof futuresRequiredEstimate !== "number") return false;
    return (futuresAccount?.cashUSDT ?? 0) < futuresRequiredEstimate;
  }, [futuresAccount?.cashUSDT, futuresRequiredEstimate]);

  const futuresUnrealized = useMemo(() => {
    if (!futuresPosition || typeof lastPrice !== "number") return null;
    if (futuresPosition.side === "LONG") {
      return (lastPrice - futuresPosition.entryPrice) * futuresPosition.qty;
    }
    return (futuresPosition.entryPrice - lastPrice) * futuresPosition.qty;
  }, [futuresPosition, lastPrice]);

  const futuresPositionEquity = useMemo(() => {
    if (!futuresPosition || futuresUnrealized === null) return 0;
    return futuresPosition.margin + futuresUnrealized;
  }, [futuresPosition, futuresUnrealized]);

  const futuresEquity = useMemo(() => {
    const wallet = futuresAccount?.cashUSDT ?? 0;
    return wallet + futuresPositionEquity;
  }, [futuresAccount?.cashUSDT, futuresPositionEquity]);

  const futuresPnlPct = useMemo(() => {
    if (!futuresPosition || futuresUnrealized === null || futuresPosition.margin <= 0) return null;
    return (futuresUnrealized / futuresPosition.margin) * 100;
  }, [futuresPosition, futuresUnrealized]);

  const estimatedValue = useMemo(() => {
    if (typeof qtyValue !== "number" || qtyValue <= 0 || typeof effectivePrice !== "number") {
      return null;
    }
    return qtyValue * effectivePrice;
  }, [qtyValue, effectivePrice]);

  const validationMessage = useMemo(() => {
    if (!guestId) return "Guest session initializing.";
    if (typeof qtyValue !== "number" || qtyValue <= 0) return "Enter a valid quantity.";
    if (orderType === "MARKET" && lastPrice === null) {
      return "Live price is required for MARKET order.";
    }
    if (orderType === "LIMIT" && (typeof limitPriceValue !== "number" || limitPriceValue <= 0)) {
      return "Enter a valid limit price.";
    }
    if (typeof effectivePrice !== "number") {
      return "Price is unavailable.";
    }

    if (orderSide === "BUY") {
      const cash = account?.cashUSDT ?? 0;
      if (qtyValue * effectivePrice > cash) {
        return "Insufficient cashUSDT.";
      }
    } else {
      const holdingQty = selectedHolding?.qty ?? 0;
      if (qtyValue > holdingQty) {
        return "Insufficient holding quantity.";
      }
    }

    return null;
  }, [
    account?.cashUSDT,
    effectivePrice,
    guestId,
    lastPrice,
    limitPriceValue,
    orderSide,
    orderType,
    qtyValue,
    selectedHolding?.qty
  ]);

  const placeOrderDisabled =
    isPlacingOrder || isRefreshing || validationMessage !== null || !guestId;

  const quickQtyBase = useMemo(() => {
    if (!effectivePrice || effectivePrice <= 0) return 0;
    if (orderSide === "BUY") {
      return (account?.cashUSDT ?? 0) / effectivePrice;
    }
    return selectedHolding?.qty ?? 0;
  }, [account?.cashUSDT, effectivePrice, orderSide, selectedHolding?.qty]);

  const onQuickQty = (ratio: number) => {
    const next = quickQtyBase * ratio;
    setQtyInput(toInputQty(next));
  };

  const onPlaceOrder = async () => {
    if (!guestId || validationMessage) {
      setApiError(validationMessage ?? "Guest session not initialized.");
      return;
    }

    const qty = Number(qtyValue);
    const payload: Record<string, unknown> = {
      guestId,
      symbol,
      side: orderSide,
      type: orderType,
      qty
    };

    if (orderType === "LIMIT") {
      payload.limitPrice = limitPriceValue;
    } else {
      payload.currentPrice = lastPrice;
    }

    setApiError(null);
    setIsPlacingOrder(true);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; result?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to place order.");
      }

      setQtyInput("");
      if (orderType === "MARKET") {
        setLimitPriceInput("");
      }

      toast.success(data.result === "FILLED" ? "Order filled." : "Order placed.");
      await refreshAccountAndOrders(guestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to place order.";
      setApiError(message);
      toast.error(message);
    } finally {
      setIsPlacingOrder(false);
    }
  };

  const onTransfer = useCallback(
    async (direction: "SPOT_TO_FUTURES" | "FUTURES_TO_SPOT") => {
      if (!guestId) {
        toast.error("Guest session not initialized.");
        return;
      }
      if (!transferAmountMeetsMin) {
        toast.error("Enter a valid transfer amount.");
        return;
      }

      setIsTransferring(true);
      setApiError(null);
      try {
        const response = await fetch("/api/futures/transfer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guestId,
            direction,
            amount: transferAmountText
          })
        });
        const data = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: { code?: string; message?: string };
        };
        if (!response.ok || data.ok === false) {
          throw new Error(data.error?.message ?? "Transfer failed.");
        }
        toast.success("Transfer completed.");
        setTransferAmount("");
        await Promise.all([
          refreshAccountAndOrders(guestId),
          refreshFuturesData(guestId, symbol)
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Transfer failed.";
        setApiError(message);
        toast.error(message);
      } finally {
        setIsTransferring(false);
      }
    },
    [guestId, refreshAccountAndOrders, refreshFuturesData, symbol, transferAmountMeetsMin, transferAmountText]
  );

  const onOpenFutures = useCallback(async () => {
    if (!guestId) {
      toast.error("Guest session not initialized.");
      return;
    }
    if (futuresPosition) {
      toast.error("Position already exists for this symbol.");
      return;
    }
    if (typeof lastPrice !== "number" || lastPrice <= 0) {
      toast.error("Live price is required.");
      return;
    }
    if (typeof futuresMarginValue !== "number" || futuresMarginValue <= 0) {
      toast.error("Enter a valid margin.");
      return;
    }
    if (
      !Number.isInteger(futuresLeverageValue) ||
      futuresLeverageValue < FUTURES_MIN_LEVERAGE ||
      futuresLeverageValue > FUTURES_MAX_LEVERAGE
    ) {
      toast.error(`Leverage must be an integer between ${FUTURES_MIN_LEVERAGE} and ${FUTURES_MAX_LEVERAGE}.`);
      return;
    }
    if (futuresCashInsufficient) {
      toast.error("Insufficient Futures cashUSDT.");
      return;
    }

    setIsOpeningFutures(true);
    setApiError(null);
    try {
      const response = await fetch("/api/futures/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestId,
          symbol,
          side: futuresSide,
          leverage: futuresLeverageValue,
          margin: futuresMarginValue,
          currentPrice: lastPrice
        })
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to open futures position.");
      }

      toast.success("Futures position opened.");
      setFuturesMargin("");
      await refreshFuturesData(guestId, symbol);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open futures position.";
      setApiError(message);
      toast.error(message);
    } finally {
      setIsOpeningFutures(false);
    }
  }, [
    futuresLeverageValue,
    futuresMarginValue,
    futuresCashInsufficient,
    futuresPosition,
    futuresSide,
    guestId,
    lastPrice,
    refreshFuturesData,
    symbol
  ]);

  const onCloseFutures = useCallback(async () => {
    if (!guestId) {
      toast.error("Guest session not initialized.");
      return;
    }
    if (!futuresPosition) {
      toast.error("No futures position to close.");
      return;
    }
    if (typeof lastPrice !== "number" || lastPrice <= 0) {
      toast.error("Live price is required.");
      return;
    }

    setIsClosingFutures(true);
    setApiError(null);
    try {
      const response = await fetch("/api/futures/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestId,
          symbol,
          currentPrice: lastPrice
        })
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to close futures position.");
      }

      toast.success("Futures position closed.");
      await refreshFuturesData(guestId, symbol);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to close futures position.";
      setApiError(message);
      toast.error(message);
    } finally {
      setIsClosingFutures(false);
    }
  }, [futuresPosition, guestId, lastPrice, refreshFuturesData, symbol]);

  const getLivePriceForSymbol = useCallback(
    (targetSymbol: string) => {
      const direct = priceMap[targetSymbol];
      if (typeof direct === "number" && Number.isFinite(direct)) return direct;
      if (targetSymbol === symbol && typeof selectedSymbolLastPrice === "number") {
        return selectedSymbolLastPrice;
      }
      return null;
    },
    [priceMap, selectedSymbolLastPrice, symbol]
  );

  const placeMarketSell = useCallback(
    async (targetSymbol: string, rawQty: number) => {
      if (!guestId) {
        const message = "Guest session not initialized.";
        setApiError(message);
        toast.error(message);
        return;
      }

      if (!Number.isFinite(rawQty) || rawQty <= 0) {
        const message = "Invalid sell quantity.";
        setApiError(message);
        toast.error(message);
        return;
      }

      const holding = holdings.find((item) => item.symbol === targetSymbol);
      const holdingQty = holding?.qty ?? 0;
      const qty = Math.min(roundDown(rawQty, 6), roundDown(holdingQty, 6));
      if (!Number.isFinite(qty) || qty <= 0) {
        const message = "Quantity too small to sell.";
        setApiError(message);
        toast.error(message);
        return;
      }

      const livePrice = getLivePriceForSymbol(targetSymbol);
      if (typeof livePrice !== "number" || !Number.isFinite(livePrice)) {
        const message = "No live price yet";
        setApiError(message);
        toast.error(message);
        return;
      }

      console.debug("[placeMarketSell] attempt", {
        symbol: targetSymbol,
        qty,
        price: livePrice
      });

      setApiError(null);
      setIsPlacingOrder(true);
      try {
        const response = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guestId,
            symbol: targetSymbol,
            side: "SELL",
            type: "MARKET",
            qty,
            currentPrice: livePrice
          })
        });

        const data = (await response.json().catch(() => ({}))) as { error?: string; result?: string };
        if (!response.ok) {
          throw new Error(data.error ?? "Failed to place market sell.");
        }

        toast.success(
          data.result === "FILLED"
            ? `${targetSymbol} sell filled (${formatQty(qty)}).`
            : `${targetSymbol} sell order placed (${formatQty(qty)}).`
        );
        await refreshAccountAndOrders(guestId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to place market sell.";
        setApiError(message);
        toast.error(message);
      } finally {
        setIsPlacingOrder(false);
      }
    },
    [getLivePriceForSymbol, guestId, holdings, refreshAccountAndOrders]
  );

  const cancelOrder = useCallback(
    async (
      orderId: string,
      options?: {
        refreshAfter?: boolean;
        showToast?: boolean;
      }
    ) => {
      if (!guestId) return false;

      const refreshAfter = options?.refreshAfter ?? true;
      const showToast = options?.showToast ?? true;

      const response = await fetch("/api/orders/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId, orderId })
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        const message = data.error ?? "Failed to cancel order.";
        setApiError(message);
        if (showToast) toast.error(message);
        return false;
      }

      if (showToast) toast.success("Order canceled.");
      if (refreshAfter) {
        await refreshAccountAndOrders(guestId);
      }
      return true;
    },
    [guestId, refreshAccountAndOrders]
  );

  const onCancelOrder = async (orderId: string) => {
    setApiError(null);
    await cancelOrder(orderId);
  };

  const onCancelAll = async () => {
    if (!guestId || openOrders.length === 0) return;
    const proceed = window.confirm("Cancel all open orders for this account?");
    if (!proceed) return;

    setApiError(null);
    const results = await Promise.all(
      openOrders.map((order) => cancelOrder(order.id, { refreshAfter: false, showToast: false }))
    );
    const successCount = results.filter(Boolean).length;
    const failCount = results.length - successCount;

    if (successCount > 0) {
      toast.success(`${successCount} order${successCount > 1 ? "s" : ""} canceled.`);
    }
    if (failCount > 0) {
      toast.error(`${failCount} order${failCount > 1 ? "s" : ""} failed to cancel.`);
    }

    await refreshAccountAndOrders(guestId);
  };

  const wsBadgeVariant = wsStatus === "LIVE" ? "success" : wsStatus === "ERROR" ? "danger" : "outline";
  const futuresOpenDisabled =
    isOpeningFutures ||
    isRefreshing ||
    !guestId ||
    !!futuresPosition ||
    typeof lastPrice !== "number" ||
    typeof futuresMarginValue !== "number" ||
    futuresMarginValue <= 0 ||
    !Number.isInteger(futuresLeverageValue) ||
    futuresLeverageValue < FUTURES_MIN_LEVERAGE ||
    futuresLeverageValue > FUTURES_MAX_LEVERAGE ||
    futuresCashInsufficient;

  const orderedOpenOrders = useMemo(
    () => [...openOrders].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [openOrders]
  );

  const orderedTrades = useMemo(
    () => [...trades].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [trades]
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1500px] p-3 md:p-4 lg:p-6">
      <header className="mb-4 rounded-lg border border-border/80 bg-card/80 p-3 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-sm font-semibold tracking-tight md:text-base">Crypto Paper Terminal</h1>
            <p className="text-[11px] text-muted-foreground md:text-xs">
              Guest: {shortGuest}
              {guestError ? ` - ${guestError}` : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 md:gap-3">
            <div className="grid grid-cols-2 gap-1 rounded-md border border-border/70 bg-background/50 p-1">
              <Button
                size="sm"
                variant={tradeMode === "SPOT" ? "default" : "secondary"}
                onClick={() => setTradeMode("SPOT")}
              >
                Spot
              </Button>
              <Button
                size="sm"
                variant={tradeMode === "FUTURES" ? "default" : "secondary"}
                onClick={() => setTradeMode("FUTURES")}
              >
                Futures
              </Button>
            </div>
            <SymbolPicker symbol={symbol} onSymbolChange={onSymbolChange} />
            <div className="rounded-md border border-border/70 bg-background/50 px-3 py-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Last Price</p>
              <p className="font-mono text-base font-semibold md:text-lg">${formatPrice(lastPrice)}</p>
            </div>
            <Badge variant={wsBadgeVariant}>{wsStatus}</Badge>
          </div>
        </div>
      </header>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <div className="space-y-4">
          <ChartPanel symbol={symbol} />

          <Card className="border-border/80 bg-card/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Trades</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orderedTrades.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        No filled trades yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    orderedTrades.map((trade) => (
                      <TableRow key={trade.id}>
                        <TableCell className="font-mono">{formatTime(trade.createdAt)}</TableCell>
                        <TableCell>
                          <Badge variant={trade.side === "BUY" ? "success" : "danger"}>{trade.side}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">{formatQty(trade.qty)}</TableCell>
                        <TableCell className="text-right font-mono">${formatPrice(trade.price)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              {apiError ? <p className="mt-2 text-xs text-red-300">{apiError}</p> : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="border-border/80 bg-card/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Wallet Transfer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-border/70 bg-background/40 p-2.5">
                  <p className="text-[11px] text-muted-foreground">Spot Cash</p>
                  <p className="font-mono text-sm font-medium">${formatUsd(account?.cashUSDT)}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/40 p-2.5">
                  <p className="text-[11px] text-muted-foreground">Futures Cash</p>
                  <p className="font-mono text-sm font-medium">${formatUsd(futuresAccount?.cashUSDT)}</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground" htmlFor="transfer-amount-input">
                  Amount (USDT)
                </label>
                <Input
                  id="transfer-amount-input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={transferAmount}
                  onChange={(event) => setTransferAmount(event.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void onTransfer("SPOT_TO_FUTURES")}
                  disabled={isTransferring || !transferAmountMeetsMin || spotInsufficient}
                >
                  Transfer to Futures
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void onTransfer("FUTURES_TO_SPOT")}
                  disabled={isTransferring || !transferAmountMeetsMin || futuresInsufficient}
                >
                  Transfer to Spot
                </Button>
              </div>
              {!transferAmountMeetsMin && transferAmountText.length > 0 ? (
                <p className="text-xs text-red-300">Minimum transfer amount is 0.01 USDT.</p>
              ) : null}
              {spotInsufficient ? (
                <p className="text-xs text-red-300">Insufficient funds in Spot wallet.</p>
              ) : null}
              {futuresInsufficient ? (
                <p className="text-xs text-red-300">Insufficient funds in Futures wallet.</p>
              ) : null}
            </CardContent>
          </Card>

          {tradeMode === "SPOT" ? (
          <Card className="border-border/80 bg-card/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Account Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-border/70 bg-background/40 p-2.5">
                  <p className="text-[11px] text-muted-foreground">Cash (USDT)</p>
                  <p className="font-mono text-sm font-medium">${formatUsd(account?.cashUSDT)}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/40 p-2.5">
                  <p className="text-[11px] text-muted-foreground">Total Equity</p>
                  <p className="font-mono text-sm font-medium">${formatUsd(equity)}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/40 p-2.5">
                  <p className="text-[11px] text-muted-foreground">Realized PnL</p>
                  <p className={cn("font-mono text-sm font-medium", realizedPnl >= 0 ? "text-emerald-300" : "text-red-300")}>
                    ${formatUsd(realizedPnl)}
                  </p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/40 p-2.5">
                  <p className="text-[11px] text-muted-foreground">Total Unrealized</p>
                  <p
                    className={cn(
                      "font-mono text-sm font-medium",
                      totalUnrealized >= 0 ? "text-emerald-300" : "text-red-300"
                    )}
                  >
                    ${formatUsd(totalUnrealized)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 border-t border-border/60 pt-2">
                <div className="text-xs">
                  <p className="text-muted-foreground">Total PnL</p>
                  <p className={cn("font-mono", totalPnl >= 0 ? "text-emerald-300" : "text-red-300")}>
                    ${formatUsd(totalPnl)}
                  </p>
                </div>
                <div className="text-xs">
                  <p className="text-muted-foreground">Total Return</p>
                  <p className={cn("font-mono", totalReturnPct >= 0 ? "text-emerald-300" : "text-red-300")}>
                    {formatPct(totalReturnPct)}
                  </p>
                </div>
              </div>

              {streamError ? <p className="text-xs text-red-300">Price stream: {streamError}</p> : null}
            </CardContent>
          </Card>
          ) : (
            <Card className="border-border/80 bg-card/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Futures Account Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-border/70 bg-background/40 p-2.5">
                    <p className="text-[11px] text-muted-foreground">Cash (USDT)</p>
                    <p className="font-mono text-sm font-medium">${formatUsd(futuresAccount?.cashUSDT)}</p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-background/40 p-2.5">
                    <p className="text-[11px] text-muted-foreground">Total Equity</p>
                    <p className="font-mono text-sm font-medium">${formatUsd(futuresEquity)}</p>
                  </div>
                </div>
                {streamError ? <p className="text-xs text-red-300">Price stream: {streamError}</p> : null}
              </CardContent>
            </Card>
          )}

          {tradeMode === "SPOT" ? (
          <Card className="border-border/80 bg-card/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Order Panel</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <p className="text-[11px] uppercase text-muted-foreground">Side</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant={orderSide === "BUY" ? "default" : "secondary"}
                    size="sm"
                    className="font-semibold"
                    onClick={() => setOrderSide("BUY")}
                  >
                    BUY
                  </Button>
                  <Button
                    variant={orderSide === "SELL" ? "destructive" : "secondary"}
                    size="sm"
                    className="font-semibold"
                    onClick={() => setOrderSide("SELL")}
                  >
                    SELL
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <p className="text-[11px] uppercase text-muted-foreground">Type</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant={orderType === "MARKET" ? "default" : "secondary"}
                    size="sm"
                    onClick={() => setOrderType("MARKET")}
                  >
                    MARKET
                  </Button>
                  <Button
                    variant={orderType === "LIMIT" ? "default" : "secondary"}
                    size="sm"
                    onClick={() => setOrderType("LIMIT")}
                  >
                    LIMIT
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground" htmlFor="qty-input">
                  Quantity
                </label>
                <Input
                  id="qty-input"
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  inputMode="decimal"
                  placeholder="0.0000"
                  value={qtyInput}
                  onChange={(event) => setQtyInput(event.target.value)}
                />
              </div>

              {orderType === "LIMIT" ? (
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground" htmlFor="limit-price-input">
                    Limit Price
                  </label>
                  <Input
                    id="limit-price-input"
                    type="number"
                    min={priceStep}
                    step={priceStep}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={limitPriceInput}
                    onChange={(event) => setLimitPriceInput(event.target.value)}
                  />
                </div>
              ) : null}

              <div className="grid grid-cols-3 gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => onQuickQty(0.25)}>
                  25%
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => onQuickQty(0.5)}>
                  50%
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => onQuickQty(1)}>
                  100%
                </Button>
              </div>

              <div className="rounded-md border border-border/70 bg-background/40 px-2.5 py-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {orderSide === "BUY" ? "Est. Cost" : "Est. Proceeds"}
                  </span>
                  <span className="font-mono">
                    {estimatedValue === null ? "--" : `$${formatUsd(estimatedValue)}`}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-muted-foreground">Available</span>
                  <span className="font-mono">
                    {formatQty(quickQtyBase)} {symbol.replace("USDT", "")}
                  </span>
                </div>
              </div>

              {validationMessage ? <p className="text-xs text-red-300">{validationMessage}</p> : null}
              {apiError ? <p className="text-xs text-red-300">{apiError}</p> : null}

              <Button className="w-full" onClick={onPlaceOrder} disabled={placeOrderDisabled}>
                {isPlacingOrder ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Placing...
                  </span>
                ) : (
                  "Place Order"
                )}
              </Button>
            </CardContent>
          </Card>
          ) : (
            <Card className="border-border/80 bg-card/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Futures Order Panel</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <p className="text-[11px] uppercase text-muted-foreground">Side</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant={futuresSide === "LONG" ? "default" : "secondary"}
                      size="sm"
                      onClick={() => setFuturesSide("LONG")}
                    >
                      LONG
                    </Button>
                    <Button
                      variant={futuresSide === "SHORT" ? "destructive" : "secondary"}
                      size="sm"
                      onClick={() => setFuturesSide("SHORT")}
                    >
                      SHORT
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">Leverage</p>
                  <p className="font-mono text-2xl font-semibold leading-none">{futuresLeverageValue}x</p>
                  <Slider
                    min={FUTURES_MIN_LEVERAGE}
                    max={FUTURES_MAX_LEVERAGE}
                    step={1}
                    value={[futuresLeverageValue]}
                    onValueChange={(value) => setFuturesLeverage(clampFuturesLeverage(value[0] ?? futuresLeverageValue))}
                    aria-label="Futures leverage"
                  />
                  <div className="grid grid-cols-6 gap-1">
                    {FUTURES_LEVERAGE_PRESETS.map((preset) => (
                      <Button
                        key={preset}
                        type="button"
                        size="sm"
                        variant={futuresLeverageValue === preset ? "default" : "secondary"}
                        onClick={() => setFuturesLeverage(preset)}
                      >
                        {preset}x
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground" htmlFor="futures-margin-input">
                    Margin (USDT)
                  </label>
                  <Input
                    id="futures-margin-input"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={futuresMargin}
                    onChange={(event) => setFuturesMargin(event.target.value)}
                  />
                </div>

                <div className="rounded-md border border-border/70 bg-background/40 px-2.5 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Notional</span>
                    <span className="font-mono">
                      {futuresNotionalEstimate === null ? "--" : `$${formatUsd(futuresNotionalEstimate)}`}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-muted-foreground">Qty Est.</span>
                    <span className="font-mono">{futuresQtyEstimate === null ? "--" : formatQty(futuresQtyEstimate)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-muted-foreground">Liq Price Est.</span>
                    <span className="font-mono">{futuresLiqEstimate === null ? "--" : `$${formatPrice(futuresLiqEstimate)}`}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-muted-foreground">Open Fee Est.</span>
                    <span className="font-mono">{futuresOpenFeeEstimate === null ? "--" : `$${formatUsd(futuresOpenFeeEstimate)}`}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-muted-foreground">Required</span>
                    <span className="font-mono">{futuresRequiredEstimate === null ? "--" : `$${formatUsd(futuresRequiredEstimate)}`}</span>
                  </div>
                </div>

                {futuresCashInsufficient ? (
                  <p className="text-xs text-red-300">Insufficient Futures cash for margin + open fee.</p>
                ) : null}

                {apiError ? <p className="text-xs text-red-300">{apiError}</p> : null}

                <Button className="w-full" onClick={() => void onOpenFutures()} disabled={futuresOpenDisabled}>
                  {isOpeningFutures ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Opening...
                    </span>
                  ) : (
                    "Open Position"
                  )}
                </Button>
              </CardContent>
            </Card>
          )}

          {tradeMode === "SPOT" ? (
          <Card className="border-border/80 bg-card/80">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm">Open Orders</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onCancelAll}
                  disabled={openOrders.length === 0 || isRefreshing}
                >
                  Cancel All
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">LimitPx</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orderedOpenOrders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        No open orders.
                      </TableCell>
                    </TableRow>
                  ) : (
                    orderedOpenOrders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-mono">{formatTime(order.createdAt)}</TableCell>
                        <TableCell>
                          <Badge variant={order.side === "BUY" ? "success" : "danger"}>{order.side}</Badge>
                        </TableCell>
                        <TableCell>{order.type}</TableCell>
                        <TableCell className="text-right font-mono">{formatQty(order.qty)}</TableCell>
                        <TableCell className="text-right font-mono">
                          {order.limitPrice ? formatPrice(order.limitPrice) : "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{order.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void onCancelOrder(order.id)}
                          >
                            Cancel
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          ) : null}

          {tradeMode === "SPOT" ? (
          <Card className="border-border/80 bg-card/80">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Positions</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Symbol</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Avg</TableHead>
                    <TableHead className="text-right">Last</TableHead>
                    <TableHead className="text-right">Unreal PnL</TableHead>
                    <TableHead className="text-right">PnL%</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holdings.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        No positions.
                      </TableCell>
                    </TableRow>
                  ) : (
                    holdingMetrics.map(({ holding, price, unrealized, pnlPct }) => {
                      const hasLivePrice = getLivePriceForSymbol(holding.symbol) !== null;
                      const disableSell = isPlacingOrder || isRefreshing || holding.qty <= 0 || !hasLivePrice;
                      return (
                        <TableRow key={holding.id}>
                          <TableCell>{holding.symbol}</TableCell>
                          <TableCell className="text-right font-mono">{formatQty(holding.qty)}</TableCell>
                          <TableCell className="text-right font-mono">${formatPrice(holding.avgPrice)}</TableCell>
                          <TableCell className="text-right font-mono">
                            {price === null ? "-" : `$${formatPrice(price)}`}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right font-mono",
                              unrealized === null
                                ? ""
                                : unrealized >= 0
                                  ? "text-emerald-300"
                                  : "text-red-300"
                            )}
                          >
                            {unrealized === null ? "-" : `$${formatUsd(unrealized)}`}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right font-mono",
                              pnlPct === null ? "" : pnlPct >= 0 ? "text-emerald-300" : "text-red-300"
                            )}
                          >
                            {pnlPct === null ? "-" : formatPct(pnlPct)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-wrap justify-end gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void placeMarketSell(holding.symbol, holding.qty * 0.25)}
                                disabled={disableSell}
                              >
                                25%
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void placeMarketSell(holding.symbol, holding.qty * 0.5)}
                                disabled={disableSell}
                              >
                                50%
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void placeMarketSell(holding.symbol, holding.qty)}
                                disabled={disableSell}
                              >
                                100%
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => void placeMarketSell(holding.symbol, holding.qty)}
                                disabled={disableSell}
                              >
                                Sell All
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          ) : (
            <Card className="border-border/80 bg-card/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Futures Position</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!futuresPosition ? (
                  <p className="text-sm text-muted-foreground">No open futures position for {symbol}.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md border border-border/70 bg-background/40 p-2.5">
                        <p className="text-[11px] text-muted-foreground">Side</p>
                        <p className={cn("font-mono text-sm font-medium", futuresPosition.side === "LONG" ? "text-emerald-300" : "text-red-300")}>
                          {futuresPosition.side}
                        </p>
                      </div>
                      <div className="rounded-md border border-border/70 bg-background/40 p-2.5">
                        <p className="text-[11px] text-muted-foreground">Leverage</p>
                        <p className="font-mono text-sm font-medium">{futuresPosition.leverage}x</p>
                      </div>
                      <div className="rounded-md border border-border/70 bg-background/40 p-2.5">
                        <p className="text-[11px] text-muted-foreground">Margin</p>
                        <p className="font-mono text-sm font-medium">${formatUsd(futuresPosition.margin)}</p>
                      </div>
                      <div className="rounded-md border border-border/70 bg-background/40 p-2.5">
                        <p className="text-[11px] text-muted-foreground">Qty</p>
                        <p className="font-mono text-sm font-medium">{formatQty(futuresPosition.qty)}</p>
                      </div>
                      <div className="rounded-md border border-border/70 bg-background/40 p-2.5">
                        <p className="text-[11px] text-muted-foreground">Entry</p>
                        <p className="font-mono text-sm font-medium">${formatPrice(futuresPosition.entryPrice)}</p>
                      </div>
                      <div className="rounded-md border border-border/70 bg-background/40 p-2.5">
                        <p className="text-[11px] text-muted-foreground">Mark</p>
                        <p className="font-mono text-sm font-medium">${formatPrice(lastPrice)}</p>
                      </div>
                      <div className="rounded-md border border-border/70 bg-background/40 p-2.5">
                        <p className="text-[11px] text-muted-foreground">Liq Price</p>
                        <p className="font-mono text-sm font-medium">${formatPrice(futuresPosition.liquidationPrice)}</p>
                      </div>
                      <div className="rounded-md border border-border/70 bg-background/40 p-2.5">
                        <p className="text-[11px] text-muted-foreground">Unrealized PnL</p>
                        <p className={cn("font-mono text-sm font-medium", (futuresUnrealized ?? 0) >= 0 ? "text-emerald-300" : "text-red-300")}>
                          {futuresUnrealized === null ? "--" : `$${formatUsd(futuresUnrealized)}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-md border border-border/70 bg-background/40 px-2.5 py-2 text-xs">
                      <span className="text-muted-foreground">PnL %</span>
                      <span className={cn("font-mono", (futuresPnlPct ?? 0) >= 0 ? "text-emerald-300" : "text-red-300")}>
                        {futuresPnlPct === null ? "--" : formatPct(futuresPnlPct)}
                      </span>
                    </div>

                    <Button
                      variant="destructive"
                      className="w-full"
                      onClick={() => void onCloseFutures()}
                      disabled={isClosingFutures || typeof lastPrice !== "number"}
                    >
                      {isClosingFutures ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Closing...
                        </span>
                      ) : (
                        "Close Position"
                      )}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </section>
    </main>
  );
}
