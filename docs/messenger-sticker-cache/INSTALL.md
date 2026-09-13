# TENH CHAT — Faster cached Messenger stickers

Apply these seven changed/new files to your latest TENH project with **TENH-CHAT-Messenger-Stickers-Replies-2026-09-13.zip** already applied. Copy the included folders into the project root, replace matching files, and redeploy. This is a focused cache update, not a complete project archive.

## Behavior

- The first visit downloads the catalog and the pack you open. Previously loaded pack lists, pack contents and single-sticker tab previews are reused for **six hours**, with no repeat catalog request or loading spinner while the cache is fresh.
- Catalog metadata survives closing the picker, switching Facebook conversations within the workspace, and reloading the page. Existing Recents behavior is retained.
- After six hours, cached stickers stay visible while the data refreshes in the background. If that refresh fails, the cached data stays usable. Metadata older than seven days is discarded.
- Closing the picker allows a pending catalog download to finish warming the cache. Reopening during that request shares the same download. Old responses cannot replace the currently selected conversation or search results.
- Search results are reused for five minutes within the browser session. Search text is not written to persistent storage.
- Tab previews remain lazy: only visible tabs request missing previews. Loading a pack also caches its first individual sticker for its tab.
- The server reuses its App-token catalog responses for one hour (search responses for five minutes), reducing repeated upstream requests from different clients handled by the same server instance.

The persistent cache contains catalog metadata and Meta image URLs. Images keep those URLs so the browser can reuse its normal image cache; image delivery still follows Meta's CDN headers. This is not an offline image download feature. The cache does not store access tokens or conversation messages, and sending still uses the existing authenticated API.

Browser metadata is capped at 256 entries and one million serialized characters per workspace; old entries are evicted. Browsers that disable storage still get an in-memory cache. Clearing browser data makes the next opening load the catalog again.

No database migration, environment-variable change or runtime dependency is needed.

## Verification

- Strict TypeScript check: 530 source files, zero diagnostics, using the temporary Next-compatible configuration and supplied dependencies. This is not a production Next build result.
- 10 cache/React behavior checks passed, covering reload persistence, fresh-cache request counts, workspace separation, shared pending downloads, expired-cache refresh failures, search caching, malformed/blocked storage, manual retry and Recents.
- 71 existing Messenger API/reaction/sticker checks passed.

With the project's development dependencies installed:

```sh
node --test tests/meta-stickers/cache.test.cjs
node --test tests/messenger-replies/api.test.cjs tests/messenger-reactions/api.test.cjs tests/meta-stickers/meta-sticker-patch.test.cjs
```

The React UI tests additionally require `jsdom@26` in the development test environment:

```sh
node --test tests/messenger-replies/sticker-ui.test.cjs
```
