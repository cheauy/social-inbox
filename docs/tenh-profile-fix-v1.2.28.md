# TENH Companion 1.2.28 — profile lookup / automatic Facebook session detection

## Scope
This patch is based on the user's TENH profile fix 1.2.26 package plus the 1.2.27 global-navigation changes. It changes only the existing TENH web + existing Companion profile/status flow. No separate app, server, webhook, database, Messenger send flow, Telegram flow, sticker flow, realtime core, group chat or billing code is added or replaced.

## Changes

### 1. Heading-less Facebook customer cards
Some Business Suite layouts show one explicit `View profile` link but no semantic customer heading. Version 1.2.27 returned `profile_customer_heading_missing` even when diagnostics showed `profileActions: 1` and `linkActions: 1`.

1.2.28 keeps exact Page/conversation authorization and accepts one explicit, safe Facebook profile link when it is the only visible `View profile` destination for the already-authorized conversation. More than one candidate still fails as `ambiguous_profile`; message/feed links and PSID/Page-ID destinations are still rejected.

### 2. Customer photo flow
The customer photo remains one-click:
- click photo
- TENH shows `Finding profile…`
- Companion resolves/verifies the profile
- only after success, a public Facebook profile tab is opened
- the verified link is saved to the existing TENH customer record when permitted

The customer-facing UI no longer exposes `Copy lookup details` / `Show lookup details`. Detailed diagnostics remain an extension/developer concern rather than an Inbox action.

### 3. Automatic Facebook browser-session detection
The Companion can now check whether this Chrome profile is signed into Facebook by making a lightweight background request to `https://www.facebook.com/me` with the extension's existing Facebook host permission. This check:
- opens no Facebook or Business Suite tab
- reads no message/customer body content
- treats login/checkpoint redirects as signed-out
- is cached for 60 seconds

The popup reports `Facebook session detected • No Facebook tab required` when this succeeds.

This browser-session check is separate from TENH's Meta OAuth/Page integration. Normal TENH Messenger API/webhook operation remains authoritative and does not depend on a Facebook browser session.

### 4. Important profile lookup limitation
If Meta's provider conversation data already supplies a distinct navigation/global ID, TENH tries that path first. When it does not, the existing profile lookup may still create a short-lived **inactive** Facebook/Business Suite tab during an actual profile click so Facebook can render its explicit `View profile` destination. The tab is never focused and is closed by the worker if TENH still owns it. Version 1.2.28 removes the need to manually open Facebook just to detect the browser session; it does not claim that all profile-resolution work can be performed without a loaded Facebook document.

## Validation
- 51 profile-opening worker tests passed
- 13 customer-avatar lifecycle/UI tests passed
- 3 Open-in-Meta navigation tests passed
- 7 global-navigation tests passed
- 2 automatic Facebook-session probe tests passed
- 1 heading-less layout source guard passed
- total: 77 tests, 0 failures
- extension JavaScript syntax passed
- changed TS/TSX transpile diagnostics passed

Not verified: live Facebook/Business Suite DOM for this exact customer, live browser cookies/session behavior, full Next.js production build, Chrome Web Store review.
