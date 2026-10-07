"use client";

// Light/dark theme shared by every page. The choice is stored in localStorage
// and applied as `body.dark` (an inline script in the layout applies it before
// first paint, so there is no flash).
import { useEffect, useState } from "react";

import { THEME_KEY } from "./theme";

export function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    try { setDark(document.body.classList.contains("dark") || localStorage.getItem(THEME_KEY) === "dark"); } catch {}
  }, []);
  const toggle = () => {
    setDark((d) => {
      const next = !d;
      document.body.classList.toggle("dark", next);
      try { localStorage.setItem(THEME_KEY, next ? "dark" : "light"); } catch {}
      return next;
    });
  };
  return [dark, toggle];
}
