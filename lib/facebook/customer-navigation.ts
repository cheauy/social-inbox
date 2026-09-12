/** Navigation only. Never interpret a Page-scoped ID as a public profile ID. */
export function facebookCustomerLinks(pageId: unknown, psid: unknown) {
  if (typeof pageId !== "string" || typeof psid !== "string" ||
      !/^\d{1,30}$/.test(pageId) || !/^\d{1,30}$/.test(psid)) return null;
  const inbox = new URL("https://business.facebook.com/latest/inbox/all");
  inbox.search = new URLSearchParams({ asset_id: pageId, selected_item_id: psid,
    mailbox_id: pageId, thread_type: "FB_MESSAGE" }).toString();
  return { businessSuiteUrl: inbox.toString(), pageMessengerUrl: `https://m.me/${pageId}?id=${psid}` };
}
