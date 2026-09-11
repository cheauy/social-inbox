type Rect = { left: number; top: number; bottom: number };
type Viewport = { left: number; top: number; width: number; height: number };

export function quickReplyPosition(anchor: Rect, viewport: Viewport) {
  const margin = 12;
  const width = Math.min(540, Math.max(0, viewport.width - margin * 2));
  const available = Math.max(0, viewport.height - margin * 2);
  const anchorTop = Math.max(viewport.top + margin, Math.min(anchor.top, viewport.top + viewport.height - margin));
  const anchorBottom = Math.max(viewport.top + margin, Math.min(anchor.bottom, viewport.top + viewport.height - margin));
  const above = anchorTop - viewport.top - margin * 2;
  const below = viewport.top + viewport.height - anchorBottom - margin * 2;
  const left = Math.max(viewport.left + margin, Math.min(anchor.left, viewport.left + viewport.width - width - margin));
  // If the composer is too close to the top, use the available viewport rather
  // than putting the title above the screen. The popup is portaled to body.
  if (above >= Math.min(320, available)) {
    const maxHeight = Math.min(600, above);
    return { left, top: anchorTop - margin, transform: "translateY(-100%)", width, maxHeight };
  }
  if (below >= Math.min(320, available)) {
    return { left, top: anchorBottom + margin, width, maxHeight: Math.min(600, below) };
  }
  return { left, top: viewport.top + margin, width, maxHeight: Math.min(600, available) };
}
