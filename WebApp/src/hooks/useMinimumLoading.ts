import { useEffect, useRef, useState } from "react";

const MINIMUM_LOADING_DURATION_MS = 750;

export function useMinimumLoading(isLoading: boolean) {
  const [isVisible, setIsVisible] = useState(isLoading);
  const startedAt = useRef(isLoading ? performance.now() : 0);

  useEffect(() => {
    if (isLoading) {
      startedAt.current = performance.now();
      setIsVisible(true);
      return;
    }

    const remaining = Math.max(
      0,
      MINIMUM_LOADING_DURATION_MS - (performance.now() - startedAt.current),
    );
    const timeout = window.setTimeout(() => setIsVisible(false), remaining);
    return () => window.clearTimeout(timeout);
  }, [isLoading]);

  return isLoading || isVisible;
}
