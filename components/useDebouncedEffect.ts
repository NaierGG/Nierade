import { DependencyList, EffectCallback, useEffect } from "react";

export function useDebouncedEffect(
  effect: EffectCallback,
  deps: DependencyList,
  delayMs = 400
) {
  useEffect(() => {
    const timer = setTimeout(() => {
      effect();
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [...deps, delayMs]);
}
