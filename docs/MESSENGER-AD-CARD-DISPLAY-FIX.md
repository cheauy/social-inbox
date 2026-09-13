# TENH CHAT — Ad card display fix

The previous source-card patch calculated the correct cards but rendered them only in the Facebook-comment branch and the standalone tail of the chat. The normal Messenger branch omitted the cards. Consequently, an ad referral associated with a normal customer message was invisible, and a standalone card could disappear when a message arrived after it.

This update renders the calculated source cards immediately before the normal Messenger message bubble, after its date separator. It applies to text, photos, videos, stickers and files. It uses the existing saved conversation sources and message referral payloads.

Install over the current TENH CHAT project with the earlier Messenger source-card update applied:

1. Replace `components/inbox/message-panel.tsx` with the copy in this ZIP. The other two files are the regression test and these notes.
2. Deploy the updated project to Vercel.
3. Refresh TENH with Ctrl+Shift+R and reopen the customer conversation. Source context already saved in the conversation or message can now render; another ad click is not required for that saved context.

No new SQL migration or subscription repair is needed for this UI fix. The previously installed source-column migration and repaired Facebook subscription remain prerequisites. This update does not recover context that exists only in an unprocessed webhook log.

Verification:

- Added tests that render the real MessagePanel, source timeline/parser and SourceCard together, with only surrounding controls and network hooks mocked.
- Before the fix, eight of the ten new full-panel tests failed because the source card was absent. All ten now pass, covering normal text/media, saved standalone context, deduplication, reopening, photo albums and Seen receipts.
- All 34 Messenger source tests passed. Strict TypeScript checking passed across 533 TS/TSX files with zero diagnostics.
- Local render tests do not replace verification of the deployed chat. No production deployment was performed from this workspace.

Test command, with the project's existing test dependencies and `jsdom` available:

```sh
node --test --test-reporter=tap tests/messenger-sources/*.test.cjs
```
