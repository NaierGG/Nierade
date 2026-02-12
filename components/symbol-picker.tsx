"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SymbolItem {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
}

interface SymbolPickerProps {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const FAV_KEY = "fav_symbols";
const CACHE_KEY = "binance_symbols_cache";
const FALLBACK_SYMBOLS: SymbolItem[] = [
  { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT" },
  { symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT" },
  { symbol: "SOLUSDT", baseAsset: "SOL", quoteAsset: "USDT" },
  { symbol: "BNBUSDT", baseAsset: "BNB", quoteAsset: "USDT" },
  { symbol: "XRPUSDT", baseAsset: "XRP", quoteAsset: "USDT" }
];

function isSymbolItemArray(value: unknown): value is SymbolItem[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as { symbol?: unknown }).symbol === "string" &&
      typeof (item as { baseAsset?: unknown }).baseAsset === "string" &&
      typeof (item as { quoteAsset?: unknown }).quoteAsset === "string"
  );
}

export function SymbolPicker({ symbol, onSymbolChange }: SymbolPickerProps) {
  const [symbols, setSymbols] = useState<SymbolItem[]>(FALLBACK_SYMBOLS);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const persistFavorites = useCallback((next: Set<string>) => {
    localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(next)));
  }, []);

  const toggleFavorite = useCallback(
    (target: string) => {
      setFavorites((prev) => {
        const next = new Set(prev);
        if (next.has(target)) {
          next.delete(target);
        } else {
          next.add(target);
        }
        persistFavorites(next);
        return next;
      });
    },
    [persistFavorites]
  );

  const fetchSymbols = useCallback(
    async (background = false) => {
      if (!background) setLoading(true);
      try {
        const response = await fetch("/api/binance/symbols", {
          cache: "no-store"
        });
        const data = (await response.json().catch(() => ({}))) as {
          symbols?: SymbolItem[];
          error?: string;
        };

        if (!response.ok || !isSymbolItemArray(data.symbols)) {
          throw new Error(data.error ?? "Failed to load symbols.");
        }

        if (data.symbols.length > 0) {
          setSymbols(data.symbols);
          setUsedFallback(false);
          localStorage.setItem(
            CACHE_KEY,
            JSON.stringify({
              ts: Date.now(),
              symbols: data.symbols
            })
          );
        }
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load symbols.";
        setError(message);
        setUsedFallback(true);
      } finally {
        if (!background) setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    try {
      const rawFav = localStorage.getItem(FAV_KEY);
      if (rawFav) {
        const parsed = JSON.parse(rawFav) as unknown;
        if (Array.isArray(parsed)) {
          const next = new Set(
            parsed.filter((item): item is string => typeof item === "string").map((v) => v.toUpperCase())
          );
          setFavorites(next);
        }
      }
    } catch {
      // Keep UI resilient to malformed localStorage values.
    }

    try {
      const rawCache = localStorage.getItem(CACHE_KEY);
      if (rawCache) {
        const parsed = JSON.parse(rawCache) as { ts?: number; symbols?: unknown };
        const cacheSymbols = parsed.symbols;
        const hasValidCache = isSymbolItemArray(cacheSymbols) && cacheSymbols.length > 0;
        if (hasValidCache) {
          setSymbols(cacheSymbols);
          setUsedFallback(false);
          setLoading(false);
        }

        const isFresh = typeof parsed.ts === "number" && Date.now() - parsed.ts < SIX_HOURS_MS;
        if (isFresh && hasValidCache) {
          void fetchSymbols(true);
          return;
        }
      }
    } catch {
      // Ignore cache parse errors and fetch fresh data.
    }

    void fetchSymbols(false);
  }, [fetchSymbols]);

  useEffect(() => {
    if (!isOpen) return;

    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    searchInputRef.current?.focus();
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    const matched = q
      ? symbols.filter((item) => item.symbol.includes(q) || item.baseAsset.includes(q))
      : symbols;
    return matched.sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [search, symbols]);

  const favoriteSymbols = useMemo(
    () => filtered.filter((item) => favorites.has(item.symbol)),
    [favorites, filtered]
  );
  const otherSymbols = useMemo(
    () => filtered.filter((item) => !favorites.has(item.symbol)),
    [favorites, filtered]
  );
  const topResult = filtered[0]?.symbol;

  return (
    <div className="relative w-[260px]" ref={rootRef}>
      <Button
        size="sm"
        variant="outline"
        className="w-full justify-between font-mono"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span>{symbol}</span>
        <span className="text-[10px] text-muted-foreground">USDT</span>
      </Button>

      {isOpen ? (
        <div className="absolute right-0 z-50 mt-2 w-[340px] rounded-md border border-border/80 bg-card/95 p-2 shadow-xl backdrop-blur-sm">
          <div className="mb-2 flex items-center gap-2">
            <Input
              ref={searchInputRef}
              value={search}
              placeholder="Search symbol or base asset"
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && topResult) {
                  onSymbolChange(topResult);
                  setIsOpen(false);
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setSearch("")}
              className="px-2"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          {error ? (
            <p className="mb-2 text-[11px] text-amber-400/90">
              {usedFallback ? "Symbol API failed. Using fallback list." : error}
            </p>
          ) : null}

          <div className="max-h-80 space-y-2 overflow-auto pr-1">
            {loading ? <p className="text-[11px] text-muted-foreground">Loading symbols...</p> : null}

            {favoriteSymbols.length > 0 ? (
              <section>
                <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Favorites</p>
                <div className="space-y-1">
                  {favoriteSymbols.map((item) => (
                    <button
                      type="button"
                      key={`fav-${item.symbol}`}
                      className={cn(
                        "flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-accent/70",
                        symbol === item.symbol ? "bg-accent/80" : ""
                      )}
                      onClick={() => {
                        onSymbolChange(item.symbol);
                        setIsOpen(false);
                      }}
                    >
                      <span className="font-mono">{item.symbol}</span>
                      <span
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleFavorite(item.symbol);
                        }}
                        className="text-amber-400"
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggleFavorite(item.symbol);
                          }
                        }}
                      >
                        <Star className="h-3.5 w-3.5 fill-current" />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            <section>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {favoriteSymbols.length > 0 ? "All Symbols" : "Symbols"}
              </p>
              <div className="space-y-1">
                {otherSymbols.length === 0 ? (
                  <p className="px-2 py-1 text-[11px] text-muted-foreground">No symbols found.</p>
                ) : (
                  otherSymbols.map((item) => (
                    <button
                      type="button"
                      key={item.symbol}
                      className={cn(
                        "flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-accent/70",
                        symbol === item.symbol ? "bg-accent/80" : ""
                      )}
                      onClick={() => {
                        onSymbolChange(item.symbol);
                        setIsOpen(false);
                      }}
                    >
                      <span className="font-mono">{item.symbol}</span>
                      <span
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleFavorite(item.symbol);
                        }}
                        className={cn("text-muted-foreground", favorites.has(item.symbol) ? "text-amber-400" : "")}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggleFavorite(item.symbol);
                          }
                        }}
                      >
                        <Star className={cn("h-3.5 w-3.5", favorites.has(item.symbol) ? "fill-current" : "")} />
                      </span>
                    </button>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}

