"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface SliderProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value?: number[];
  onValueChange?: (value: number[]) => void;
}

export function Slider({ className, value = [0], onValueChange, ...props }: SliderProps) {
  const current = Number.isFinite(value[0]) ? value[0] : 0;

  return (
    <input
      type="range"
      className={cn("h-2 w-full cursor-pointer accent-primary", className)}
      value={current}
      onChange={(event) => onValueChange?.([Number(event.target.value)])}
      {...props}
    />
  );
}

