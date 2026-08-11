"use client";

import { useEffect, useState, useRef } from "react";

/**
 * useStreamingText — progressively reveals text character by character,
 * creating a streaming LLM response effect.
 */
export function useStreamingText(fullText: string, speed: number = 15) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  const indexRef = useRef(0);

  useEffect(() => {
    if (!fullText) {
      setDisplayed("");
      setDone(true);
      return;
    }
    setDisplayed("");
    setDone(false);
    indexRef.current = 0;

    const interval = setInterval(() => {
      if (indexRef.current >= fullText.length) {
        clearInterval(interval);
        setDone(true);
        return;
      }
      // Reveal 2-3 chars per tick for natural speed
      const chunk = Math.min(3, fullText.length - indexRef.current);
      indexRef.current += chunk;
      setDisplayed(fullText.slice(0, indexRef.current));
    }, speed);

    return () => clearInterval(interval);
  }, [fullText, speed]);

  return { displayed, done };
}

/**
 * useCountUp — animates a number from 0 to target.
 */
export function useCountUp(target: number, duration: number = 1000) {
  const [value, setValue] = useState(0);
  const startTime = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    startTime.current = null;
    if (target === 0) {
      setValue(0);
      return;
    }

    const animate = (time: number) => {
      if (startTime.current === null) startTime.current = time;
      const progress = Math.min((time - startTime.current) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setValue(Math.round(target * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);

  return value;
}

/**
 * useScrollReveal — reveals elements when they enter the viewport.
 */
export function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, visible };
}
