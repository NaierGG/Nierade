"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";

interface PriceTickerProps {
  symbol: string;
}

const MAX_RECONNECT_MS = 10000;

function formatPrice(value: number) {
  if (value >= 1000) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (value >= 1) {
    return value.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 4 });
  }
  return value.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 8 });
}

export function PriceTicker({ symbol }: PriceTickerProps) {
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let isUnmounted = false;

    const connect = () => {
      const url = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@trade`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isUnmounted) return;
        reconnectAttemptsRef.current = 0;
        setIsConnected(true);
        setError(null);
      };

      ws.onmessage = (event) => {
        if (isUnmounted) return;
        try {
          const payload = JSON.parse(event.data) as { p?: string };
          if (!payload.p) return;
          const price = Number.parseFloat(payload.p);
          if (!Number.isNaN(price)) {
            setLastPrice(price);
          }
        } catch {
          setError("Failed to parse price stream.");
        }
      };

      ws.onerror = () => {
        if (isUnmounted) return;
        setError("WebSocket error. Reconnecting...");
      };

      ws.onclose = () => {
        if (isUnmounted) return;
        setIsConnected(false);
        const attempt = reconnectAttemptsRef.current + 1;
        reconnectAttemptsRef.current = attempt;
        const timeout = Math.min(1000 * 2 ** (attempt - 1), MAX_RECONNECT_MS);

        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, timeout);
      };
    };

    setLastPrice(null);
    setIsConnected(false);
    setError(null);
    connect();

    return () => {
      isUnmounted = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [symbol]);

  const priceText = useMemo(() => {
    if (lastPrice === null) return "--";
    return formatPrice(lastPrice);
  }, [lastPrice]);

  return (
    <div className="flex items-center gap-3">
      <Badge variant={isConnected ? "success" : "outline"}>
        {isConnected ? "LIVE" : "DISCONNECTED"}
      </Badge>
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-muted-foreground">Last</span>
        <span className="font-mono text-lg font-semibold tracking-tight">${priceText}</span>
      </div>
      {error ? <span className="text-xs text-red-400">{error}</span> : null}
    </div>
  );
}
