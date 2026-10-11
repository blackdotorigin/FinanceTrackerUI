import { useEffect } from "react";

const IDLE_DELAY_MS = 2000;

export function useAutoHideScrollbars() {
  useEffect(() => {
    const root = document.documentElement;
    let hideTimeout: number | undefined;

    const showScrollbars = () => {
      root.classList.add("scrollbars-visible");
      window.clearTimeout(hideTimeout);
      hideTimeout = window.setTimeout(() => {
        root.classList.remove("scrollbars-visible");
      }, IDLE_DELAY_MS);
    };

    const activityEvents: (keyof DocumentEventMap)[] = [
      "keydown",
      "pointerdown",
      "scroll",
      "touchmove",
      "wheel",
    ];

    showScrollbars();
    activityEvents.forEach((eventName) => {
      document.addEventListener(eventName, showScrollbars, { capture: true, passive: true });
    });

    return () => {
      window.clearTimeout(hideTimeout);
      root.classList.remove("scrollbars-visible");
      activityEvents.forEach((eventName) => {
        document.removeEventListener(eventName, showScrollbars, true);
      });
    };
  }, []);
}
