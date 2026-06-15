import { useState } from "react";

const STORAGE_KEY = "ironclaw-verbose";

export function useVerboseMode() {
  const [verbose, setVerbose] = useState(() => localStorage.getItem(STORAGE_KEY) === "1");

  const toggle = () => {
    setVerbose((v) => {
      const next = !v;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  };

  return { verbose, toggle };
}
