import { useEffect, useRef, useState } from "react";

// Returns a CSS class for ~700ms whenever `value` changes, so live numbers can
// briefly flash green (up) or red (down) as the P&L ticks.
export function useFlash(value: number | null | undefined): string {
  const prev = useRef(value);
  const [cls, setCls] = useState("");

  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    if (value == null || before == null || value === before) return;
    setCls(value > before ? "flash-up" : "flash-down");
    const t = setTimeout(() => setCls(""), 700);
    return () => clearTimeout(t);
  }, [value]);

  return cls;
}
