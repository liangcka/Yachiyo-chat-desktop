import { useCallback, useEffect, useRef, useState } from "react";

const SCROLLBAR_LINGER_MS = 2000;

export function useScrollbarLinger() {
  const [pointerInside, setPointerInside] = useState(false);
  const lingerTimer = useRef<number | undefined>(undefined);

  const cancelLinger = useCallback(() => {
    if (lingerTimer.current !== undefined) {
      window.clearTimeout(lingerTimer.current);
      lingerTimer.current = undefined;
    }
  }, []);

  const armLinger = useCallback(() => {
    if (lingerTimer.current !== undefined) return;
    lingerTimer.current = window.setTimeout(() => {
      lingerTimer.current = undefined;
      setPointerInside(false);
    }, SCROLLBAR_LINGER_MS);
  }, []);

  const handlePointerEnter = useCallback(() => {
    cancelLinger();
    setPointerInside(true);
  }, [cancelLinger]);

  const handlePointerLeave = useCallback(() => {
    armLinger();
  }, [armLinger]);

  useEffect(() => {
    return () => {
      cancelLinger();
    };
  }, [cancelLinger]);

  return {
    handlePointerEnter,
    handlePointerLeave,
    pointerInside,
  };
}
