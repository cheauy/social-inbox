# TENH Companion

An optional Chrome extension for TENH Chat. It reports what a Facebook tab is
showing and opens the right Facebook inbox from TENH.

**TENH works exactly the same without it.** Nothing in the Inbox, the webhooks,
the send routes or the mobile app reads anything this extension produces.

## What it does

- Tells `app.tenhchat.com` that a companion is installed, and which version.
- Pairs a browser to one TENH member with a five-minute, single-use code.
- Reports, from an open Facebook tab: whether somebody is signed in, which Page
  the tab is acting as, whether a conversation is open, and whether Facebook is
  showing a reply box and has enabled it.
- Brings the matching Facebook tab forward, or opens one, when TENH asks.
- Can be revoked from TENH, and stops at its next call to the server.

## What it does not do

- Never reads or uploads Facebook cookies, `c_user`, `xs`, tokens or passwords.
- Never types into Facebook, presses Send, or works around a reply box Facebook
  has disabled. Version 0.1 reads only.
- Never reads the contents of a conversation.
- Never runs remote code: no `eval`, no injected scripts, a locked-down CSP.
- Never asks for `<all_urls>`: three hosts, and nothing else.

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

## Testing an old (>10 day) conversation

1. Find a Messenger conversation older than Meta's messaging window.
2. In TENH, use **Open in Facebook**.
3. Look at what Facebook itself presents. If it gives an enabled reply box, a
   person may reply there, in Facebook, by hand.
4. Watch whether the reply reaches TENH through the normal Meta webhook.

If Facebook does not present an enabled box, that is the end of it. TENH does
not claim to lift Meta's messaging window, and nothing here is built to.

## Permissions, and why

| Permission | Why |
|---|---|
| `storage` | Keeps the pairing token and the last observed Facebook state |
| `notifications` | Optional desktop notification support |
| `sidePanel` | The compact companion panel |
| `tabs` | Finding and focusing an already-open Facebook tab |
| `alarms` | The half-minute heartbeat |
| `app.tenhchat.com` | Pairing, heartbeat, and the page bridge |
| `www.facebook.com`, `business.facebook.com` | Reading the tab a person already has open |

## Repairing it when Facebook changes

Facebook's markup changes without notice. Everything that knows what its page
looks like is in `src/facebook-selectors.js`, and nothing there reads a
generated class name — only roles, aria labels and `contenteditable`. When
detection breaks, that file is the only one to fix.
