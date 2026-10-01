"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

// Keep loaded history in the parent, but mount expensive bubbles near the viewport.
// Every placeholder retains a measured height and a target for reply navigation.
export function DeferredInboxItem({ enabled, initiallyVisible, forceVisible, containerRef, onElement, estimatedHeight = 160, manualAnchoring = true, children }: {
  enabled: boolean;
  initiallyVisible: boolean;
  forceVisible: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  onElement?: (element: HTMLDivElement | null) => void;
  estimatedHeight?: number;
  manualAnchoring?: boolean;
  children: () => ReactNode;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const heightRef = useRef(estimatedHeight);
  const snapshotRef = useRef<{ height: number } | null>(null);
  const [visible, setVisible] = useState(initiallyVisible);
  const [placeholderHeight, setPlaceholderHeight] = useState(estimatedHeight);
  const rendered = !enabled || visible || forceVisible;

  useEffect(() => {
    const element = elementRef.current;
    const container = containerRef.current;
    if (!enabled || !element || !container || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      if (!entry.isIntersecting) {
        // Preserve keyboard focus and media playback even when they leave view.
        if (element.contains(document.activeElement) || [...element.querySelectorAll<HTMLMediaElement>("video,audio")].some(media => !media.paused)) return;
        heightRef.current = element.getBoundingClientRect().height;
        setPlaceholderHeight(heightRef.current);
      }
      const rect = element.getBoundingClientRect();
      snapshotRef.current = { height: rect.height };
      setVisible(entry.isIntersecting);
    }, { root: container, rootMargin: "800px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, containerRef]);

  useLayoutEffect(() => {
    const element = elementRef.current;
    const container = containerRef.current;
    if (!element || !container) return;
    const height = element.getBoundingClientRect().height;
    const snapshot = snapshotRef.current;
    // The scroll container opts out of native anchoring to avoid applying this twice.
    if (enabled && manualAnchoring && snapshot && element.getBoundingClientRect().top + snapshot.height <= container.getBoundingClientRect().top) {
      container.scrollTop += height - snapshot.height;
    }
    snapshotRef.current = null;
    if (rendered) heightRef.current = height;
    if (!rendered || typeof ResizeObserver === "undefined") return;
    const resize = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      const previous = heightRef.current;
      if (enabled && manualAnchoring && typeof IntersectionObserver !== "undefined" && rect.top + previous <= container.getBoundingClientRect().top) {
        container.scrollTop += rect.height - previous;
      }
      heightRef.current = rect.height;
    });
    resize.observe(element);
    return () => resize.disconnect();
  }, [rendered, enabled, manualAnchoring, containerRef]);

  // Without IntersectionObserver render normally; history must remain reachable.
  const supported = typeof IntersectionObserver !== "undefined";
  return <div ref={element => { elementRef.current = element; onElement?.(element); }}
    className="space-y-4" data-tenh-message-placeholder={enabled && supported && !rendered || undefined}
    style={enabled && supported && !rendered ? { height: placeholderHeight } : undefined}>
    {rendered || !supported ? children() : null}
  </div>;
}
