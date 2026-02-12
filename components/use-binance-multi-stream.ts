"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const MAX_RECONNECT_MS = 10000;
const PRICE_FLUSH_MS = 100;

type WsStatus = "CONNECTING" | "LIVE" | "RECONNECTING" | "ERROR";

interface CombinedTradeMessage {
  stream?: string;
  data?: {
    s?: string;
    p?: string;
  };
}

export function useBinanceMultiStream(symbols: string[]) {
  const [priceMap, setPriceMap] = useState<Record<string, number>>({});
  const [wsStatus, setWsStatus] = useState<WsStatus>("CONNECTING");
  const [error, setError] = useState<string | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingUpdatesRef = useRef<Record<string, number>>({});
  const wsRef = useRef<WebSocket | null>(null);

  const normalizedSymbols = useMemo(() => {
    const unique = new Set<string>();
    for (const symbol of symbols) {
      if (!symbol) continue;
      unique.add(symbol.toUpperCase());
    }
    return Array.from(unique).sort();
  }, [symbols]);

  const streamKey = useMemo(() => normalizedSymbols.join("|"), [normalizedSymbols]);

  useEffect(() => {
    if (!streamKey) {
      setPriceMap({});
      setWsStatus("ERROR");
      setError("No symbols available for stream.");
      return;
    }

    let isUnmounted = false;

    const flushUpdates = () => {
      flushTimerRef.current = null;
      const updates = pendingUpdatesRef.current;
      pendingUpdatesRef.current = {};
      const entries = Object.entries(updates);
      if (entries.length === 0) return;

      setPriceMap((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [symbol, price] of entries) {
          if (next[symbol] !== price) {
            next[symbol] = price;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };

    const queuePriceUpdate = (symbol: string, price: number) => {
      pendingUpdatesRef.current[symbol] = price;
      if (flushTimerRef.current !== null) return;
      flushTimerRef.current = setTimeout(flushUpdates, PRICE_FLUSH_MS);
    };

    const connect = () => {
      setWsStatus((prev) => (prev === "LIVE" ? "LIVE" : "CONNECTING"));
      const streams = normalizedSymbols.map((symbol) => `${symbol.toLowerCase()}@trade`).join("/");
      const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
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
          const payload = JSON.parse(event.data) as CombinedTradeMessage;
          const symbol = payload.data?.s?.toUpperCase();
          const rawPrice = payload.data?.p;
          if (!symbol || !rawPrice) return;
          const price = Number(rawPrice);
          if (!Number.isFinite(price)) return;
          queuePriceUpdate(symbol, price);
        } catch {
          setError("Failed to parse combined market stream.");
          setWsStatus("ERROR");
        }
      };

      ws.onerror = () => {
        if (isUnmounted) return;
        setError("Combined market stream error.");
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

    setWsStatus("CONNECTING");
    setError(null);
    connect();

    return () => {
      isUnmounted = true;
      pendingUpdatesRef.current = {};
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [normalizedSymbols, streamKey]);

  return { priceMap, wsStatus, error };
}
