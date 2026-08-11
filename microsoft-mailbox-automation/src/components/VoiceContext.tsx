"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from "react";

/**
 * VoiceContext — deep integration layer between pages and the voice entity.
 *
 * Pages register:
 *   - their current state (what's on screen)
 *   - their capabilities (what voice actions they support)
 *   - a status reader (how to describe the page aloud)
 *   - action handlers that return results
 *
 * The VoiceOrb reads from this context to:
 *   - speak page state when asked "status" / "what's here"
 *   - know which actions are actually available (not hollow)
 *   - report action results back to the user
 *
 * This is NOT surface-level. Pages must register real handlers that
 * return real results, or the voice entity will say "not available."
 */

export interface VoiceAction {
  name: string;
  label: string;          // human-readable for suggestions
  handler: () => Promise<VoiceActionResult> | VoiceActionResult;
  available: boolean;     // is this action currently possible?
}

export interface VoiceActionResult {
  success: boolean;
  speech: string;         // what Foundry should say
  data?: any;
}

export interface PageVoiceState {
  pageId: string;
  title: string;
  summary: string;        // current state description for "status" command
  actions: VoiceAction[];
}

interface VoiceContextValue {
  // Page registration
  registerPage: (state: PageVoiceState) => void;
  unregisterPage: (pageId: string) => void;
  currentPage: PageVoiceState | null;

  // Action execution with feedback
  executeAction: (actionName: string) => Promise<VoiceActionResult>;

  // Status reading
  getStatus: () => string;

  // Feedback from pages (non-action events)
  reportEvent: (speech: string) => void;
  events: string[];
}

const VoiceContext = createContext<VoiceContextValue | null>(null);

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [currentPage, setCurrentPage] = useState<PageVoiceState | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const pageRef = useRef<PageVoiceState | null>(null);

  const registerPage = useCallback((state: PageVoiceState) => {
    const prev = pageRef.current;
    pageRef.current = state;

    // Avoid re-rendering VoiceOrb/children unless the *content* of the page
    // state actually changed. Handlers are captured by ref, so pages can pass
    // a new object literal every render without causing a setState cascade.
    if (prev && prev.pageId === state.pageId) {
      const prevKey = `${prev.title}|${prev.summary}|${prev.actions
        .map((a) => `${a.name}:${a.available}:${a.label}`)
        .join(",")}`;
      const nextKey = `${state.title}|${state.summary}|${state.actions
        .map((a) => `${a.name}:${a.available}:${a.label}`)
        .join(",")}`;
      if (prevKey === nextKey) return;
    }

    setCurrentPage(state);
  }, []);

  const unregisterPage = useCallback((pageId: string) => {
    if (pageRef.current?.pageId === pageId) {
      pageRef.current = null;
      setCurrentPage(null);
    }
  }, []);

  const executeAction = useCallback(async (actionName: string): Promise<VoiceActionResult> => {
    const page = pageRef.current;
    if (!page) {
      return { success: false, speech: "No page is active for voice actions." };
    }
    const action = page.actions.find((a) => a.name === actionName);
    if (!action) {
      return { success: false, speech: `That action isn't available on ${page.title}.` };
    }
    if (!action.available) {
      return { success: false, speech: `Can't do that right now. ${action.label} requires something to be selected or loaded first.` };
    }
    try {
      const result = await action.handler();
      return result;
    } catch (e: any) {
      return { success: false, speech: `Action failed: ${e.message || "unknown error"}` };
    }
  }, []);

  const getStatus = useCallback((): string => {
    const page = pageRef.current;
    if (!page) return "No page is active.";
    let status = page.summary;
    const available = page.actions.filter((a) => a.available);
    if (available.length > 0) {
      status += ` You can ask me to: ${available.map((a) => a.label).join(", ")}.`;
    }
    return status;
  }, []);

  const reportEvent = useCallback((speech: string) => {
    setEvents((prev) => [...prev.slice(-9), speech]);
  }, []);

  const value = useMemo(
    () => ({
      registerPage,
      unregisterPage,
      currentPage,
      executeAction,
      getStatus,
      reportEvent,
      events,
    }),
    [registerPage, unregisterPage, currentPage, executeAction, getStatus, reportEvent, events],
  );

  return (
    <VoiceContext.Provider value={value}>
      {children}
    </VoiceContext.Provider>
  );
}

export function useVoiceContext(): VoiceContextValue {
  const ctx = useContext(VoiceContext);
  if (!ctx) {
    throw new Error("useVoiceContext must be used within VoiceProvider");
  }
  return ctx;
}

/**
 * useVoicePage — hook for pages to register their voice state.
 *
 * Pages call this with their current state + actions.
 * The voice entity reads this to know what's on screen and what it can do.
 *
 * Example:
 *   useVoicePage({
 *     pageId: "today",
 *     title: "Today's Hypothesis",
 *     summary: `You have ${missions.length} active missions. Current hypothesis: ${hypothesis?.title}`,
 *     actions: [
 *       {
 *         name: "run_research",
 *         label: "run research",
 *         available: !!currentAssignment,
 *         handler: async () => {
 *           const result = await runLLMResearch();
 *           return { success: true, speech: `Research complete. Found ${result.findings} prior-art matches.` };
 *         },
 *       },
 *     ],
 *   });
 */
export function useVoicePage(state: PageVoiceState) {
  const { registerPage, unregisterPage } = useVoiceContext();
  const stateRef = useRef(state);
  stateRef.current = state;

  // Compute a stable identity key from the fields that VoiceOrb/LLM actually
  // care about. This lets pages pass a new object literal every render without
  // triggering a re-registration loop.
  const stableKey = useMemo(() => {
    return `${state.pageId}|${state.title}|${state.summary}|${state.actions
      .map((a) => `${a.name}:${a.available}:${a.label}`)
      .join(",")}`;
  }, [state.pageId, state.title, state.summary, state.actions]);

  useEffect(() => {
    const s = stateRef.current;
    registerPage(s);
    return () => unregisterPage(s.pageId);
  }, [stableKey, registerPage, unregisterPage]);
}
