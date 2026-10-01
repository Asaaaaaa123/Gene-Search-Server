'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Tracks an element's content-box width. Returns a callback ref so the observer
 * follows the element even if React swaps the DOM node.
 */
export function useElementWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
    });
    ro.observe(el);
    observer.current = ro;
    setWidth(el.getBoundingClientRect().width);
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return [ref, width] as const;
}

/**
 * Slider-friendly state: the control follows the pointer immediately, while the
 * expensive `commit` (re-building a matrix, re-laying a network) runs once it settles.
 */
export function useDraft<T>(value: T, commit: (v: T) => void, delay = 200) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<number | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => setDraft(value), [value]);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  const set = useCallback(
    (v: T) => {
      setDraft(v);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => commitRef.current(v), delay);
    },
    [delay],
  );
  return [draft, set] as const;
}

export function useViewportHeight() {
  const [h, setH] = useState(900);
  useEffect(() => {
    const update = () => setH(window.innerHeight);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return h;
}
