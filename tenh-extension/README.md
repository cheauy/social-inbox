# TENH Companion

An optional Chrome extension for TENH Chat. It reads what a Facebook tab is
already showing and puts TENH's own records beside it.

**TENH works exactly the same without it.** Nothing in the Inbox, the webhooks,
the send routes or the mobile app depends on anything this extension produces.

## What it does

- Tells `app.tenhchat.com` that a companion is installed, and which version.
- Pairs a browser to one TENH member with a five-minute, single-use code.
- Reports, from an open Facebook tab: whether somebody is signed in, which Page
  the tab is acting as, whether a conversation is open, and whether Facebook is
  showing a reply box and has enabled it.
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
4. Pin **TENH Companion** to the toolbar.

## Pair

1. In TENH: **Settings → Integrations → TENH Companion → Pair browser**.
2. Copy the code (five minutes, one use).
3. Open the extension popup, paste it, press **Pair this browser**.
4. The card in TENH lists the browser as online within half a minute.

## Testing Facebook detection

1. Open `https://business.facebook.com/latest/inbox/all` and sign in as usual.
2. The popup should show **Signed in** and the Page name once one is selected.
3. Open a conversation: the popup reports the reply box as available.
4. Open a conversation Facebook has closed to replies: it reports the box as
   disabled. That is the answer — the extension does not try to type in it.

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
2. In TENH: **Settings → Integrations → TENH Companion**. The reply is listed
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
| `storage` | Keeps the pairing token and the last observed Facebook state |
| `notifications` | Unread alerts, only when no TENH tab is open |
| `sidePanel` | The compact companion panel |
| `tabs` | Finding and focusing an already-open Facebook tab |
| `alarms` | The half-minute heartbeat |
| `app.tenhchat.com` | Pairing, heartbeat, and the page bridge |
| `www.facebook.com`, `business.facebook.com` | Reading the tab a person already has open |
