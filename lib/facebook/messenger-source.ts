/** Public, persisted context supplied by Messenger referral webhooks. */
export type MessengerSource = {
  key: string;
  kind: "ad" | "post";
  occurred_at: string | null;
  message_id: string | null;
  ad_id: string | null;
  post_id: string | null;
  title: string | null;
  image_url: string | null;
  post_url: string | null;
};

export const MESSENGER_SOURCE_LIMIT = 20;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown, max = 1000) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max) : null;
}

function id(value: unknown, post = false) {
  const valueString = text(value, 100);
  return valueString && (post ? /^\d+(?:_\d+)?$/ : /^\d+$/).test(valueString)
    ? valueString : null;
}

export function messengerSourceImageUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function eventTime(value: unknown) {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  const ms = n < 100_000_000_000 ? n * 1000 : n;
  return Number.isFinite(ms) && ms > 0 && ms <= 8_640_000_000_000_000
    ? new Date(ms).toISOString() : null;
}

function postUrl(postId: string | null, pageId: string | null) {
  if (!postId) return null;
  const [owner, post] = postId.includes("_") ? postId.split("_") : [pageId, postId];
  return owner && post ? `https://www.facebook.com/${owner}/posts/${post}` : null;
}

/** Never derive a post/ad ID from a PSID, recipient ID, or arbitrary m.me ref. */
export function messengerSourceFromEvent(value: unknown): MessengerSource | null {
  const event = record(value);
  const message = record(event.message);
  if (message.is_echo === true) return null;
  const referral = record(message.referral ?? record(event.postback).referral ?? event.referral);
  const context = record(referral.ads_context_data);
  const adId = id(referral.ad_id);
  const postId = id(context.post_id, true) ?? id(referral.post_id, true);
  const imageUrl = messengerSourceImageUrl(context.photo_url)
    // Meta documents video_url in ads_context_data as the video's thumbnail.
    ?? messengerSourceImageUrl(context.video_url);
  const title = text(context.ad_title);
  if (!adId && !postId && !(referral.source === "ADS" && (imageUrl || title))) return null;
  const occurredAt = eventTime(event.timestamp);
  const messageId = text(message.mid, 250);
  const eventId = messageId ?? text(record(event.postback).mid, 250);
  return {
    key: `${occurredAt ?? eventId ?? "undated"}:${adId ?? ""}:${postId ?? ""}`,
    kind: adId || referral.source === "ADS" ? "ad" : "post",
    occurred_at: occurredAt,
    message_id: messageId,
    ad_id: adId,
    post_id: postId,
    title,
    image_url: imageUrl,
    post_url: postUrl(postId, id(record(event.recipient).id)),
  };
}

/** Bound and validate saved JSON before passing it to the UI or another write. */
export function readMessengerSources(value: unknown): MessengerSource[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-MESSENGER_SOURCE_LIMIT).flatMap((item) => {
    const source = record(item);
    const key = text(source.key, 500);
    if (!key || (source.kind !== "ad" && source.kind !== "post")) return [];
    const postId = id(source.post_id, true);
    let link = messengerSourceImageUrl(source.post_url);
    if (link && new URL(link).hostname !== "www.facebook.com") link = null;
    const occurredAt = text(source.occurred_at, 40);
    return [{
      key, kind: source.kind, ad_id: id(source.ad_id), post_id: postId,
      occurred_at: occurredAt && Number.isFinite(Date.parse(occurredAt)) ? occurredAt : null,
      message_id: text(source.message_id, 250), title: text(source.title),
      image_url: messengerSourceImageUrl(source.image_url), post_url: link,
    } satisfies MessengerSource];
  });
}

export function mergeMessengerSources(existing: unknown, incoming: MessengerSource[], limit = MESSENGER_SOURCE_LIMIT): MessengerSource[] {
  const byKey = new Map<string, MessengerSource>();
  for (const source of [...readMessengerSources(existing), ...incoming]) {
    const previous = byKey.get(source.key);
    byKey.set(source.key, previous ? {
      ...previous, ...source,
      image_url: source.image_url ?? previous.image_url,
      title: source.title ?? previous.title,
      post_url: source.post_url ?? previous.post_url,
      message_id: source.message_id ?? previous.message_id,
    } : source);
  }
  return [...byKey.values()].sort((a, b) => (a.occurred_at ?? "").localeCompare(b.occurred_at ?? ""))
    .slice(-limit);
}

type SourceMessage = {
  id: string;
  direction: string;
  raw_payload?: unknown;
  platform_message_id?: string | null;
  platform_created_at?: string | null;
  created_at: string;
};

/** Show only source context tied to an actual incoming message, never a visit. */
export function messengerSourceTimeline(saved: unknown, messages: SourceMessage[]) {
  const incoming = messages.filter(message => message.direction === "incoming");
  const embedded = incoming.flatMap((message) => {
    const source = messengerSourceFromEvent(message.raw_payload);
    // A persisted message row can supply the mid if a partial history payload
    // retained the referral but omitted message.mid.
    return source ? [{ ...source, message_id: source.message_id ?? message.platform_message_id ?? null }] : [];
  });
  // Saved metadata is the cache; rendering/reopening never needs a Graph lookup.
  // Loaded message history retains its own referrals beyond the saved limit.
  const sources = mergeMessengerSources(saved, embedded, Infinity);
  const targets = new Map(incoming.filter(message => message.platform_message_id)
    .map(message => [message.platform_message_id!, message]));
  const byMessage = new Map<string, MessengerSource>();
  for (const source of sources) {
    // OPEN_THREAD alone must not be attached to the next direct message merely
    // because its timestamp is later. Require the exact provider message ID.
    const target = source.message_id ? targets.get(source.message_id) : null;
    if (!target) continue;
    const previous = byMessage.get(target.id);
    byMessage.set(target.id, previous ? {
      ...previous, ...source,
      image_url: source.image_url ?? previous.image_url,
      title: source.title ?? previous.title,
      post_id: source.post_id ?? previous.post_id,
      post_url: source.post_url ?? previous.post_url,
      ad_id: source.ad_id ?? previous.ad_id,
      kind: source.ad_id || previous.ad_id ? "ad" : source.kind,
    } : source);
  }
  const before = new Map<string, MessengerSource[]>();
  for (const [messageId, source] of byMessage) before.set(messageId, [source]);
  return { before, after: [] as MessengerSource[] };
}
