# TENH customer profile discovery — 1.2.25

The user reports that Jame Jame opens successfully after 1.2.24, while another customer returns the generic profile-matching error. That error occurs during browser discovery, after the conversation-link authorization stage. The affected customer's rendered Facebook interface was not supplied, so its precise cause is still unconfirmed.

## Code gaps corrected

Two reproducible gaps were found in 1.2.24:

- The worker never invoked the existing customer-card reveal function. A card whose profile link appeared only after opening the customer's details could not complete automatic lookup.
- Link detection chose one text label using `textContent || aria-label`. Whitespace or different visible text could mask a matching accessibility label on the same profile link.

Version 1.2.25 checks the link's visible text, accessibility label, title and image label independently, within the existing verified customer identity area. It also detects a unique matching customer-name control and can open that card once in its own inactive lookup tab. Existing tabs remain read-only; if one needs its card opened, lookup continues in a disposable tab. Expanded, disabled, ambiguous and chat-message controls are excluded. Taking over the lookup tab prevents automatic interaction.

The earlier Meta conversation-link fixes remain included. Page IDs, Messenger PSIDs, inbox path IDs and public-profile IDs remain separate. No customer-specific mapping or manual URL field is introduced. Saved public links still open directly.

## Install

This is a cumulative patch for the original project: changed/new files with folders, plus a complete extension ZIP. It is not a standalone website project.

1. Back up your project and extract the patch over its root, preserving its folders.
2. Deploy the updated website files through your normal Vercel workflow. These include the version check and more specific failure messages.
3. Extract `dist/tenh-companion-1.2.25.zip` into your existing unpacked extension folder. Reload TENH Companion at `chrome://extensions` and confirm **1.2.25**. Keep one enabled TENH Companion. For a fresh install, use **Load unpacked** on the extracted folder.
4. Refresh TENH and Facebook/Business Suite. Click the failing customer's avatar from their Messenger conversation.

No new SQL is needed for an installation already updated to 1.2.24. The earlier profile-column migration remains included for projects that have never applied it.

## If discovery still fails

The new messages distinguish:

| Message topic | What the resolver observed |
| --- | --- |
| Customer name not identified | No supported matching customer heading was found in the loaded identity area. |
| Public profile link not exposed | The matching identity area did not yield a profile link before lookup ended. |
| Link label needs checking | Links were present, but their labels did not identify the customer's profile. |
| Link could not be verified | A labeled link was present but failed public-profile URL validation. |

For one remaining failing customer, open their conversation directly in Business Suite, click their name to show the customer details, and capture a screenshot including the customer card, any View profile action and the browser address bar. Supply the new TENH error text too. This evidence is needed to identify a different layout without assuming the wrong customer's link is acceptable.

## Validation

**204 focused automated tests passed with zero failures.** Seven of the initial eight new regression cases failed against 1.2.24; all eight passed after the change. Additional checks cover distinct failure stages, excluded chat-message links and stopping before interaction on mismatches or unavailable contact cards.

Changed TypeScript sources and their imported dependencies passed the temporary strict type check. Changed extension JavaScript passed syntax checks. The package was compared against source files, and the messaging sync core and extension permissions were checked against the original archive.

These checks use API/Chrome mocks and simulated rendered DOM. They do not establish the cause of the newly reported customer's failure or prove that every Facebook layout is supported. A live browser check is still needed. No Vercel deployment or live database operation was performed here.

A full Next.js production build was not run because the supplied archive has no root `tsconfig.json`. The previously reported unrelated missing-file check in the broader message-safety suite remains outside this correction.

To repeat the focused suite after installing project dependencies and `jsdom@26` (or setting `TENH_JSDOM_PATH`):

```sh
node --test scripts/test-facebook-conversation-link.cjs scripts/test-facebook-profile-opening.cjs scripts/test-facebook-profile-resolver.cjs scripts/test-customer-facebook-avatar.cjs scripts/test-profile-bridge-contract.cjs scripts/test-extension-passive-tabs.cjs lib/facebook/customer-profile-url.test.mjs lib/facebook/profile-lookup-error.test.mjs lib/extension/companion-response.test.mjs tests/tenh-seven/server.test.cjs tests/tenh-seven/extension.test.cjs
```
