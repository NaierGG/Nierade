"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";

interface SymbolSelectorProps {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
}

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const;

export function isSupportedSymbol(value: string): value is (typeof SYMBOLS)[number] {
  return SYMBOLS.includes(value as (typeof SYMBOLS)[number]);
}

export function SymbolSelector({ symbol, onSymbolChange }: SymbolSelectorProps) {
  return (
    <Select value={symbol} onValueChange={onSymbolChange}>
      <SelectTrigger>
        <SelectValue placeholder="Select symbol" />
      </SelectTrigger>
      <SelectContent>
        {SYMBOLS.map((item) => (
          <SelectItem key={item} value={item}>
            {item}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
