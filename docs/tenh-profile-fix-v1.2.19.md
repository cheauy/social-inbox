# TENH Companion 1.2.19

## Behavior

- Enabling, installing, updating, pairing, and browser startup no longer create Business Suite tabs. This also applies to installations with the old `keepFacebookActive` setting enabled.
- Closing an old managed Facebook tab does not recreate it.
- Reply availability checks and quick-reply inspection use existing tabs without opening or navigating Business Suite.
- Customer photo clicks open a known public Facebook profile directly. Username links stay username links; no manual profile URL entry is required.
- If no saved/verified link exists, the extension can read a matching profile link from an already loaded, exact Page/conversation tab. It never opens a temporary Business Suite lookup tab. Verification and the final opening use Facebook profile URLs only.
- Without a verified link, TENH displays an unavailable message and opens no tab. It does not infer public Facebook IDs from Messenger IDs or choose profiles by name alone. Automatic discovery for every customer is not implemented or guaranteed.
- The separately requested **Open in Meta Business Suite** action remains available; this change concerns automatic tabs and customer-photo clicks.

## Install

Deploy the updated website code and update/reload the existing Chrome extension from `dist/tenh-companion-1.2.19.zip` (extract first for an unpacked installation). Refresh TENH after reloading. The website requires 1.2.19 for unknown-profile lookup so the previous version cannot silently open Business Suite.

No database change or new permission is required. Existing user-created tabs are not closed.

## Verification

`node --test scripts/test-facebook-profile-opening.cjs scripts/test-customer-facebook-avatar.cjs scripts/test-extension-passive-tabs.cjs scripts/test-profile-bridge-contract.cjs`

These are automated Chrome/API and component mocks, not live Facebook tests. For live acceptance: enable the extension with no Facebook tabs; no Business Suite tab should appear. Click a customer with a verified link; the matching Facebook profile should open. Click a customer without one; TENH should show the unavailable message without opening Business Suite. Check that closing an existing managed tab does not reopen it.
