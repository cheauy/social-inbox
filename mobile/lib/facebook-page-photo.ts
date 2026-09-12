// Match the website's public Page avatar; never use a customer PSID here.
export function facebookPagePhoto(pageId?: string | null): string | null {
  const id = pageId?.trim();
  return id && /^\d+$/.test(id)
    ? `https://graph.facebook.com/${encodeURIComponent(id)}/picture?type=large&width=96&height=96`
    : null;
}
