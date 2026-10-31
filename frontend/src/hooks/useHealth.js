import { useState, useEffect } from "react";
import { checkHealth } from "../api/chat";

export function useHealth(intervalMs = 30000) {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      const ok = await checkHealth();
      if (mounted) setIsOnline(ok);
    };

    check();
    const timer = setInterval(check, intervalMs);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return isOnline;
}
