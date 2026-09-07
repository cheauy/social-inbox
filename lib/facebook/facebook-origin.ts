import "server-only";

import type { NextRequest } from "next/server";

/*
 * The origin Facebook is told to come back to.
 *
 * This was `https://tenhchat.com`, written out separately in each of the four
 * OAuth routes. That domain 308s to www.tenhchat.com, which does serve the
 * app, so the flow worked -- but it meant every OAuth callback made an extra
 * hop through a redirect, and moving the app to a new domain meant editing the
 * same constant in four files and hoping none was missed.
 *
 * One definition, and an environment variable in front of it, so the next move
 * is a Vercel setting rather than a deploy.
 *
 * It must match a Valid OAuth Redirect URI in the Meta app exactly -- Meta
 * compares the string, not the destination -- so changing this without adding
 * the new URI in the Meta dashboard first will break connecting a Page.
 *
 * It deliberately does not fall back to TENH_APP_URL. That variable is the
 * public TENH domain -- what Telegram webhooks register against and what
 * PayWay returns to -- and it points at tenhchat.com, which is now the
 * marketing site. Chaining to it kept sending Facebook to the marketing
 * domain after the app had already moved. The two answer different questions,
 * so they get different variables.
 */
export const FACEBOOK_PRODUCTION_ORIGIN =
  process.env.FACEBOOK_APP_ORIGIN?.trim() ||
  "https://app.tenhchat.com";

/*
 * The cookie has to be readable by whichever host finishes the flow, so it is
 * set on the parent domain rather than on one subdomain. That is what lets a
 * callback landing on www still find the state cookie written by app.
 */
export const FACEBOOK_COOKIE_DOMAIN =
  process.env.NODE_ENV === "production"
    ? ".tenhchat.com"
    : undefined;

/*
 * Development follows whatever host the request arrived on, so a local tunnel
 * or a preview deployment works without configuration.
 */
export function getFacebookAppOrigin(
  request: NextRequest,
) {
  return process.env.NODE_ENV === "production"
    ? FACEBOOK_PRODUCTION_ORIGIN
    : request.nextUrl.origin;
}
