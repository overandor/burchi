"use client";

import { useEffect, useState, useRef, useCallback } from "react";

/**
 * useVoice — seamless TTS + STT via Web Speech API.
 *
 * Features:
 *   - Push-to-talk: hold spacebar or click to speak
 *   - Continuous listening mode
 *   - Text-to-speech with Foundry voice
 *   - Visual feedback states (idle, listening, speaking, processing)
 *   - Auto-restart on silence
 *   - Wake word detection ("Foundry, ...")
 */

interface VoiceState {
  listening: boolean;
  speaking: boolean;
  processing: boolean;
  supported: boolean;
  transcript: string;
  interimTranscript: string;
  error: string | null;
}

// Minimal type declarations for Web Speech API (not in standard TS lib)
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}
interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}
interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}

export function useVoice(options?: {
  onTranscript?: (text: string) => void;
  continuous?: boolean;
  wakeWord?: string;
}) {
  const onTranscript = options?.onTranscript;
  const continuous = options?.continuous ?? false;
  const wakeWord = options?.wakeWord ?? "foundry";

  const [state, setState] = useState<VoiceState>({
    listening: false,
    speaking: false,
    processing: false,
    supported: false,
    transcript: "",
    interimTranscript: "",
    error: null,
  });

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const shouldListenRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);

  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);

  // Initialize speech recognition
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setState((s) => ({ ...s, supported: false, error: "Speech recognition not supported in this browser" }));
      return;
    }

    const recognition = new SR();
    recognition.continuous = continuous;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setState((s) => ({ ...s, listening: true, error: null }));
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      setState((s) => ({ ...s, interimTranscript: interim }));

      if (final) {
        let text = final.trim();
        // Strip wake word if present
        const wakeRegex = new RegExp(`^${wakeWord}[\\s,]+`, "i");
        text = text.replace(wakeRegex, "").trim();
        setState((s) => ({ ...s, transcript: text, interimTranscript: "" }));
        if (onTranscriptRef.current && text) {
          onTranscriptRef.current(text);
        }
      }
    };

    recognition.onerror = (event: Event) => {
      const errEvent = event as any;
      let errorMsg = "Speech recognition error";
      if (errEvent.error === "not-allowed") errorMsg = "Microphone access denied";
      else if (errEvent.error === "no-speech") errorMsg = ""; // Silent — auto-restart handles this
      else if (errEvent.error === "aborted") errorMsg = "";
      else errorMsg = `Speech error: ${errEvent.error}`;
      setState((s) => ({ ...s, error: errorMsg }));
    };

    recognition.onend = () => {
      setState((s) => ({ ...s, listening: false, interimTranscript: "" }));
      // Auto-restart if we should still be listening (continuous mode)
      if (shouldListenRef.current && continuous) {
        try { recognition.start(); } catch { /* already started */ }
      }
    };

    recognitionRef.current = recognition;
    setState((s) => ({ ...s, supported: true }));

    return () => {
      shouldListenRef.current = false;
      try { recognition.abort(); } catch { /* noop */ }
    };
  }, [continuous, wakeWord]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return;
    shouldListenRef.current = true;
    try { recognitionRef.current.start(); } catch { /* already started */ }
  }, []);

  const stopListening = useCallback(() => {
    shouldListenRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* noop */ }
    }
    setState((s) => ({ ...s, listening: false, interimTranscript: "" }));
  }, []);

  const speak = useCallback((text: string, options?: { rate?: number; pitch?: number; onEnd?: () => void }) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options?.rate ?? 1.0;
    utterance.pitch = options?.pitch ?? 0.9;
    utterance.volume = 1.0;

    // Try to find a good voice
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.name.includes("Google") && v.lang.startsWith("en"))
      || voices.find(v => v.lang.startsWith("en-US"))
      || voices[0];
    if (preferred) utterance.voice = preferred;

    utterance.onstart = () => setState((s) => ({ ...s, speaking: true }));
    utterance.onend = () => {
      setState((s) => ({ ...s, speaking: false }));
      options?.onEnd?.();
    };
    utterance.onerror = () => setState((s) => ({ ...s, speaking: false }));

    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setState((s) => ({ ...s, speaking: false }));
  }, []);

  const clearTranscript = useCallback(() => {
    setState((s) => ({ ...s, transcript: "", interimTranscript: "" }));
  }, []);

  return {
    ...state,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    clearTranscript,
  };
}
