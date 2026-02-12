"use client";

import { useEffect, useMemo, useState } from "react";

interface CoinLogoProps {
  symbol: string;
  size?: number;
}

function getBaseAsset(symbol: string) {
  const upper = symbol.trim().toUpperCase();
  return upper.endsWith("USDT") ? upper.slice(0, -4) : upper;
}

export function CoinLogo({ symbol, size = 26 }: CoinLogoProps) {
  const [attempt, setAttempt] = useState(0);
  const base = getBaseAsset(symbol);
  const lower = base.toLowerCase();

  useEffect(() => {
    setAttempt(0);
  }, [lower]);

  const sources = useMemo(
    () => [
      `https://assets.coincap.io/assets/icons/${lower}@2x.png`,
      `https://cryptoicons.org/api/icon/${lower}/200`
    ],
    [lower]
  );

  const initials = (base.slice(0, 2) || "?").toUpperCase();
  const showInitials = attempt >= sources.length;

  return (
    <div
      className="inline-flex items-center justify-center rounded-full border border-border/70 bg-muted/30 text-[10px] font-semibold text-muted-foreground ring-1 ring-background/80"
      style={{ width: size, height: size }}
      aria-label={`${base} logo`}
    >
      {showInitials ? (
        <span>{initials}</span>
      ) : (
        <img
          src={sources[attempt]}
          alt={`${base} logo`}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="h-full w-full rounded-full object-cover"
          onError={() => setAttempt((prev) => prev + 1)}
        />
      )}
    </div>
  );
}
