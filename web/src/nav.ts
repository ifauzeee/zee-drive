import { useEffect, useState } from "react";

export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}

export function navigate(to: string): void {
  const go = () => {
    window.history.pushState(null, "", to);
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.scrollTo(0, 0);
  };
  // Use the View Transition API when supported, otherwise navigate normally.
  if (document.startViewTransition) document.startViewTransition(go);
  else go();
}
