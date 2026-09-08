/*
 * Where an announcement's "Learn more" is allowed to point.
 *
 * No imports, so the rule can be tested directly and so the API and the banner
 * share one definition. They each carried their own startsWith("/") before,
 * which is how they came to agree on the wrong answer.
 *
 * startsWith("/") is not a test for "relative". "//evil.com" starts with a
 * slash and is a protocol-relative URL: a browser resolves it to
 * https://evil.com. "/\evil.com" is treated the same way by Chrome and
 * Firefox. Both passed validation as relative links, and the banner then
 * classified them as internal -- routing them through next/link and skipping
 * the target="_blank" rel="noreferrer" it applies to off-site links, while the
 * whole-banner click path called window.location.assign on them directly.
 *
 * Only the single env-pinned admin account, which carries a verified TOTP
 * factor, can write one of these, so this was never a way in for anyone else.
 * It is here because "relative" should mean relative.
 */

const MAX_LINK_LENGTH = 500;

/**
 * A same-origin path: one leading slash, and the next character is not another
 * slash or a backslash.
 */
export function isInternalAnnouncementLink(value: string) {
  return /^\/(?![/\\])/.test(value);
}

/**
 * Returns the link to store, or null when it is not one we allow.
 */
export function normalizeAnnouncementLink(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("/")) {
    return isInternalAnnouncementLink(trimmed)
      ? trimmed.slice(0, MAX_LINK_LENGTH)
      : null;
  }

  try {
    const url = new URL(trimmed);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    return url.toString().slice(0, MAX_LINK_LENGTH);
  } catch {
    return null;
  }
}
