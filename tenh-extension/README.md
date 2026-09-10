# TENH v1

An optional Chrome extension for TENH Chat. It reads what a Facebook tab is
already showing and puts TENH's own records beside it.

**TENH works exactly the same without it.** Nothing in the Inbox, the webhooks,
the send routes or the mobile app depends on anything this extension produces.

## What it does

- Tells `app.tenhchat.com` that it is installed, and which version.
- Connects itself to the TENH account already signed in on that browser, once,
  and stays connected. There is no code to copy and nothing to reconnect.
- Prepares a Facebook tab **itself** when a browser-side feature needs one, and
  reuses one that is already open. Nobody has to keep Business Suite open, and
  nobody is told to "open Facebook first".
- Reports, from that tab: whether somebody is signed in, which Page it is acting
  as, whether a conversation is open, and whether Facebook is showing a reply
  box and has enabled it.
- Brings the matching Facebook tab forward, or opens one, when TENH asks.
- Shows the customer's **TENH** tags, notes and assignment in a side panel, and
  the workspace's **TENH** quick replies. Adding a tag writes to TENH's own
  tables and appears in the Inbox, the phone and Change History.
- Puts a quick reply into Facebook's box for a person to read and send.
- Notices when a teammate sends a reply from Facebook itself, and asks TENH
  whether Meta's webhook ever delivered it.
- Shows TENH's unread count on the toolbar icon.
- Can be revoked from TENH, and stops at its next call to the server.

## What it does not do

- Never reads or uploads Facebook cookies, `c_user`, `xs`, tokens or passwords.
- Never presses Send, and never works around a reply box Facebook has disabled.
- Never reads a customer's messages. Send detection reads the composer your own
  team typed into — never the thread.
- Never creates a message in TENH. Meta's webhook stays the only writer; a
  browser observation is stored beside it, matched against it, and never
  merged into the conversation.
- Never runs remote code: no `eval`, no injected scripts, a locked-down CSP.
- Never asks for `<all_urls>`: three hosts, and nothing else.
- Never keeps its own copy of a tag, note, quick reply or unread count. Every
  one of those is read from TENH and written back to TENH.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. **Load unpacked** → choose this `tenh-extension` folder.
4. Pin **TENH v1** to the toolbar.

## Connect

Open `app.tenhchat.com` in that browser, signed in. That is the whole step:
the content script asks `/api/extension/auto-pair` with the session already in
that browser, and the token it gets back goes straight to the service worker —
it is never written to the page. The browser appears under **Connected
browsers** within half a minute and stays there.

There is no other way in, on purpose. A pairing code proved two things — that
you hold the browser and that you hold the TENH account — and a request from
TENH's own page with your session on it proves both already. Keeping a code as
well would be a second door to defend for no gain.

The token is dropped only on a real refusal (revoked in TENH, or removed from
the workspace). A timeout, a 500, a deploy or an expired subscription leave it
alone. Even after a revocation, opening TENH signed in reconnects it without
anybody typing anything.

**Not connecting?** Sign in to TENH in that browser, then use **Test
connection** in the popup.

## How the Facebook tab is managed

Everything that touches a tab is in `src/facebook-tab-manager.js`, and nothing
else in the extension calls `chrome.tabs` for Facebook.

**On demand — the default.** Normal TENH needs no Facebook tab at all: messages
arrive through Meta's webhook and send through the API. So nothing is opened
until a browser-side capability actually needs the page — the old-conversation
reply check, a quick reply insertion, "Open in Facebook", or a re-detect. Then:

1. Reuse an existing Facebook tab if there is one, preferring Business Suite's
   inbox and, above that, a tab already on the right Page.
2. Otherwise create **one** tab with `active: false`, so the customer stays in
   TENH and is not thrown into Facebook mid-sentence.
3. Wait for the content script, up to 20 seconds.
4. Report sign-in, Page, conversation and composer state.

Concurrent requests queue behind each other rather than each opening a tab —
the second finds the tab the first made.

**Keep Facebook companion active — the switch in the popup.** While Chrome runs
and the browser is connected, one managed tab is kept loaded so the bridge is
live. Turn this on if you want outgoing-send detection to be dependable:
detection reads a Facebook document, and with no document loaded there is
nothing to read. Off by default, because a background tab is a cost and most
work does not need one.

**What it never does.** It never closes a tab somebody else opened, never
reloads one (only a tab it created itself), and never takes the screen unless a
person pressed something that means "take me to Facebook" — Open in Facebook,
Open conversation, or Sign in to Facebook.

A managed tab that the customer closes is released, not reopened. On demand,
the next feature that needs Facebook makes a new one; keep-active restores one
at its next five-minute check.

## Facebook status, in five words

The popup and the panel say one of these, and none of them is "no tab":

| State | Means |
|---|---|
| **Ready** | A Facebook page is loaded and answering. |
| **Connecting** | A tab is preparing itself. |
| **Sleeping** | Nothing has needed Facebook. This is normal and not a fault. |
| **Sign-in required** | Facebook wants a sign-in. One button brings that tab forward — the extension never touches the form. |
| **Connection issue** | Detection failed. TENH messaging is unaffected, and there is a Retry. |

## Testing Facebook detection

1. With **no** Facebook tab open, open the popup: it should read **Sleeping**,
   not an error, and open nothing.
2. In TENH, open a Messenger conversation older than seven days. The extension
   prepares a Facebook tab in the background — you stay in TENH — and the
   notice reports what Facebook is showing.
3. Open Business Suite yourself, then trigger the same check: the existing tab
   is reused and no second one appears.
4. Open a conversation Facebook has closed to replies: it reports the box as
   disabled. That is the answer — the extension does not try to type in it.
5. Signed out of Facebook, the popup reads **Sign-in required** with a button
   that brings the tab forward. Sign in as normal; the next check notices.

## Testing the side panel

1. Open a Facebook conversation with a customer TENH already knows.
2. Open the side panel. It should name the customer, their TENH tags, their
   notes and who the conversation is assigned to.
3. Add a tag in the panel, then look at the Inbox on the website: the same tag
   is there, and Change History records who added it.
4. Press a quick reply. The text lands in Facebook's box and stops. Nothing is
   sent until a person sends it.

If the panel says the conversation is not matched, TENH has no record of that
Facebook thread — a comment thread, or a Page this workspace has not connected.
Nothing is guessed.

## Testing send detection

1. From Facebook itself, reply to a customer.
2. In TENH: **Settings → Integrations → TENH v1**. The reply is listed
   under **Replies typed in Facebook**.
3. Within a minute it should read **In TENH** — Meta's webhook delivered it.
4. If it stays on **Never arrived in TENH**, the webhook is not reaching this
   workspace. The usual cause is another app holding the Page's subscription.

## Testing an old (>10 day) conversation

1. Find a Messenger conversation older than Meta's messaging window.
2. In TENH, use **Open in Facebook**.
3. Look at what Facebook itself presents. If it gives an enabled reply box, a
   person may reply there, in Facebook, by hand.
4. Watch whether the reply reaches TENH through the normal Meta webhook.

If Facebook does not present an enabled box, that is the end of it. TENH does
not claim to lift Meta's messaging window, and nothing here is built to.

## When Facebook changes its interface

Use **Re-detect Facebook** in the popup, then **Test connection**. If detection
is broken, the popup says so — and TENH keeps working, because none of it
depends on this.

Facebook's markup changes without notice. Everything that knows what its page
looks like is in `src/facebook-selectors.js`, and nothing there reads a
generated class name — only roles, aria labels and `contenteditable`. When
detection breaks, that file is the only one to fix.

## Permissions, and why

| Permission | Why |
|---|---|
| `storage` | Keeps the connection token and the last observed Facebook state |
| `notifications` | Unread alerts, only when no TENH tab is open |
| `sidePanel` | The compact companion panel |
| `tabs` | Finding, preparing and focusing the one managed Facebook tab |
| `alarms` | The half-minute heartbeat, and keep-active's five-minute check |
| `app.tenhchat.com` | Connecting, heartbeat, and the page bridge |
| `www.facebook.com`, `business.facebook.com` | Reading the tab a person already has open |
