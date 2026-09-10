# Publishing TENH v1 to the Chrome Web Store

Everything a reviewer asks for, written out, so submission is copying rather
than composing. **You have to do the submission itself** — it needs your
Google account, the one-time $5 developer registration, and acceptance of
Google's terms in your name. Nothing here can be done on your behalf.

Build the upload with:

```bash
npm run extension:zip
```

That writes `dist/tenh-v1-1.0.0.zip` from the `tenh-extension` folder. Upload
that file; the store rejects a zip of the parent folder, so use this script
rather than zipping by hand.

---

## Where to go

1. <https://chrome.google.com/webstore/devconsole> — sign in with the Google
   account that should own the listing. Use a company account, not a personal
   one: the owner cannot be changed later without transferring the whole
   developer account.
2. Pay the one-time **$5** registration if this account has never published.
3. **Add new item** → upload `dist/tenh-v1-1.0.0.zip`.

---

## Listing

**Name**

```
TENH v1
```

**Summary** (132 characters max — this one is 122)

```
Your TENH Chat customer, tags, notes and quick replies beside Facebook. Optional — TENH works exactly the same without it.
```

**Description**

```
TENH v1 puts your TENH Chat records beside Facebook, in the browser you already
have open.

Open a Facebook conversation and the side panel shows that customer as TENH
knows them: their tags, their notes, who the conversation is assigned to, and
your workspace's quick replies. Add a tag and it is on the website a second
later, under your name in Change History. There is no second copy of anything —
everything shown is read from TENH and written back to TENH.

It also answers one question TENH cannot answer on its own: when somebody on
your team replies from Facebook itself, did that reply reach TENH? If Meta's
webhook never delivered it, TENH tells you which replies went missing instead of
leaving you to guess.

WHAT IT DOES

• Shows the customer's TENH tags, notes and assignment beside Facebook
• Puts your TENH quick replies into Facebook's reply box — you press Send
• Opens the right Facebook conversation from TENH, reusing a tab you have open
• Reports whether Facebook is showing an enabled reply box
• Tells you whether replies typed in Facebook reached TENH
• Shows your TENH unread count on the toolbar icon

WHAT IT WILL NOT DO

• It never reads or uploads Facebook passwords, cookies or session identifiers
• It never presses Send, and never works around a reply box Facebook has
  disabled — Meta's messaging rules stand
• It never reads your customers' messages
• It never creates a message in TENH; Meta's official webhook remains the only
  thing that does
• It runs no remote code

You need a TENH Chat account (https://app.tenhchat.com). Install it, open TENH
signed in, and it connects itself — no code to copy, and nothing to reconnect
tomorrow. Remove the browser from Settings → Integrations at any time and it
stops.
```

**Category:** Workflow & Planning
**Language:** English

---

## Privacy tab — answer exactly this

**Single purpose**

```
Show a TENH Chat user their own TENH customer records — tags, notes, assignment
and saved replies — beside the Facebook conversation they have open, and report
whether replies sent from Facebook reached TENH.
```

**Permission justifications**

| Field | Answer |
|---|---|
| `storage` | Stores the connection token for this browser and the last observed state of the Facebook tab. Nothing belonging to Facebook is stored. |
| `notifications` | Alerts the user to unread TENH conversations, only when no TENH tab is open to alert them itself. |
| `sidePanel` | The panel that displays the user's TENH records beside Facebook. |
| `tabs` | Finds and focuses a Facebook tab the user already has open, instead of opening duplicates, and checks whether a TENH tab exists before notifying. |
| `alarms` | Schedules a heartbeat every 30 seconds so TENH can show the browser as connected. |
| Host: `app.tenhchat.com` | The extension's own backend: connecting, heartbeat, and reading the user's TENH records. |
| Host: `www.facebook.com`, `business.facebook.com` | Reads the accessibility layer of the Facebook page the user already has open to identify the Page and conversation and whether a reply box is enabled, and inserts a saved reply the user chose. |
| Remote code | No. All code is in the package. |

**Data use disclosures** — tick these and nothing else:

- *Personally identifiable information*: **Yes** — "the user's own customer
  records are displayed; the text of replies the user's own team sends from
  Facebook is sent to their TENH workspace so it can be matched against
  messages TENH already has."
- *Authentication information*: **No.** The extension holds a TENH device token
  it mints for itself; it never handles passwords, and never touches Facebook
  credentials or cookies.
- *Website content*: **Yes** — limited to the Facebook page structure needed to
  identify the Page, conversation and reply box.

Then certify all three: data is not sold, not used for unrelated purposes, and
not used for creditworthiness or lending.

**Privacy policy URL**

```
https://app.tenhchat.com/privacy
```

Check before submitting that this page describes the extension. A policy that
does not mention it is the most common rejection of this kind of listing.

---

## Screenshots

Five slots, 1280×800 or 640×400. Take them from a real workspace with a test
customer — never a real customer's name, photo or messages.

1. The side panel beside a Facebook conversation, showing tags and notes.
2. Quick replies in the panel, with one inserted into Facebook's box unsent.
3. Settings → Integrations, showing the browser connected.
4. "Replies typed in Facebook" with one marked *In TENH*.
5. The Inbox with **Open in Facebook** in the blocked-composer notice.

---

## What review will ask about

Two things attract questions, and both have a short honest answer.

**Facebook host permissions.** Explain that the extension reads the tab the user
already has open, through roles and aria labels, to identify which Page and
conversation is on screen; that it never reads credentials or cookies; and that
it never sends a message.

**Automation on a third-party site.** State plainly that it inserts text the
user selected into the composer and stops — the user presses Send — and that it
respects a reply box Facebook has disabled rather than working around it. That
last part is the one that matters: an extension that circumvented Meta's
messaging window would be rejected, and this one is built not to.

First review usually takes a few days. Later versions go faster.

---

## Releasing an update

1. Raise `version` in `manifest.json` (the store refuses a repeat).
2. `npm run extension:zip`
3. Upload the new zip to the same item and submit.

Everything installed updates itself within a few hours. `browser_installation_id`
survives an update, so nobody has to reconnect.
