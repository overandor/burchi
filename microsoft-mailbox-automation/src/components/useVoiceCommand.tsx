"use client";

import { useEffect, useCallback } from "react";

/**
 * useVoiceCommand — listens for voice-command CustomEvents
 * dispatched by the VoiceOrb and calls the appropriate handler.
 *
 * Usage in a page:
 *   useVoiceCommand({
 *     run_research: () => researchRef.current?.click(),
 *     run_confounders: () => confoundersRef.current?.click(),
 *     ...
 *   });
 */
export function useVoiceCommand(handlers: Record<string, () => void>) {
  const onCommand = useCallback((event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (detail?.action && handlers[detail.action]) {
      handlers[detail.action]();
    }
  }, [handlers]);

  useEffect(() => {
    window.addEventListener("voice-command", onCommand as EventListener);
    return () => window.removeEventListener("voice-command", onCommand as EventListener);
  }, [onCommand]);
}
