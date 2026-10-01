type Element = { getBoundingClientRect(): { top: number; bottom: number } };
type Container = { scrollTop: number; getBoundingClientRect(): { top: number } };
export type ScrollAnchor = { id: string; offset: number };

// Ordered elements permit logarithmic lookup even after many history pages.
export function captureScrollAnchor(rows: { id: string }[], elementFor: (id: string) => Element | undefined, container: Container): ScrollAnchor | null {
  const top = container.getBoundingClientRect().top;
  let low = 0, high = rows.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const element = elementFor(rows[middle].id);
    if (!element || element.getBoundingClientRect().bottom <= top) low = middle + 1;
    else high = middle;
  }
  const row = rows[low];
  const element = row && elementFor(row.id);
  return element ? { id: row.id, offset: element.getBoundingClientRect().top - top } : null;
}

export function restoreScrollAnchor(anchor: ScrollAnchor | null, elementFor: (id: string) => Element | undefined, container: Container) {
  const element = anchor && elementFor(anchor.id);
  if (element) container.scrollTop += element.getBoundingClientRect().top - container.getBoundingClientRect().top - anchor!.offset;
}
