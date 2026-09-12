# TENH customer profile discovery — 1.2.26

The supplied Business Suite screenshot shows Ah Mouy Srun's name, photo and View profile action in the right customer card. TENH nevertheless reports that it cannot identify the customer's name. The screenshot confirms that the information is visible, but it does not expose Facebook's HTML or the link destination.

The previous resolver required a matching HTML heading. This update also recognizes a compact customer card containing an exact visible name, photo and explicitly labeled View profile action. The card must be in a customer panel; navigation, conversation rows and message content are excluded. Ordinary text and names split across nested elements are supported. The existing Page, conversation, customer and public-link validation remains in place.

This is a general layout correction. It contains no customer-specific mapping, does not convert a Messenger PSID or inbox selected-item ID into a public-profile ID, and does not require a manual URL field. Automatic discovery still depends on Facebook exposing a readable, verifiable profile link. A View profile button without a readable destination produces a specific failure instead of a guessed URL.

## Install

This is a cumulative patch for the original project: changed/new files with folders, plus a complete extension ZIP. It is not a standalone website project.

1. Back up your project and extract this patch over its root, preserving the folders.
2. Deploy the updated website through your normal workflow. The website update includes the new version requirement and lookup-details controls.
3. Extract `dist/tenh-companion-1.2.26.zip` into your existing unpacked extension folder. Reload TENH Companion at `chrome://extensions` and confirm **1.2.26**. Keep one enabled TENH Companion. For a fresh installation, use **Load unpacked** on the extracted folder.
4. Refresh TENH and Facebook/Business Suite. From a Messenger conversation in TENH, click the customer's avatar. Check Ah Mouy Srun and another previously failing customer.

No new SQL is needed if 1.2.25 is already installed. The earlier profile-column migration remains included for projects that have never applied it.

## If it still fails

Click **Copy lookup details** in the TENH error popup and paste the resulting JSON into the support conversation. If clipboard access is blocked, open **Show lookup details** and copy the text manually.

The report contains the extension version, error reason, customer names as seen by TENH and Meta, and four detection counts. It excludes access tokens, message content and page HTML. Comparing the two names and counts helps distinguish a name mismatch, an unrecognized customer-card layout, and an action with no readable link. It is generated only after a failed lookup and is cleared when switching conversations.

## Validation

**225 focused automated tests passed with zero failures.** The 17 customer-card cases include ordinary-text names, nested name parts, Khmer and accented names, different Pages, conflicting links, hidden names, messages and navigation. Eight cases failed against the previous detector and passed after the correction.

Customer-card fixtures are schematic DOM examples based on the visible layout, not captured Facebook HTML. Their public-profile destination is synthetic. API and Chrome behavior is mocked. These checks do not establish live compatibility with every Facebook layout; the supplied customer's live flow still needs checking after installation.

The changed TypeScript sources and imported dependencies passed a temporary strict type check. Extension JavaScript passed syntax checks. The release archive was compared against the source, and the original messaging sync core and extension permissions were checked for changes.

A full Next.js production build was not run because the supplied archive has no root `tsconfig.json`. No website deployment or database operation was performed. The previously reported missing migration file in an unrelated broader test suite remains outside this correction.

To repeat the focused suite with project dependencies and `jsdom@26` installed (or `TENH_JSDOM_PATH` set to an installed jsdom package):

```sh
node --test scripts/test-facebook-conversation-link.cjs scripts/test-facebook-profile-opening.cjs scripts/test-facebook-profile-resolver.cjs scripts/test-facebook-profile-card.cjs scripts/test-customer-facebook-avatar.cjs scripts/test-profile-bridge-contract.cjs scripts/test-extension-passive-tabs.cjs lib/facebook/customer-profile-url.test.mjs lib/facebook/profile-lookup-error.test.mjs lib/extension/companion-response.test.mjs tests/tenh-seven/server.test.cjs tests/tenh-seven/extension.test.cjs
```
