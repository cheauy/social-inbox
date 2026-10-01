# Quick tag and reply loading — local review

Cold loads use accessible chip/row shimmer placeholders with reduced-motion support. Valid cached content, including empty results, stays visible during background refresh. A bounded tab-local cache shares overlapping requests for the same workspace, refreshes stale catalogs on opening after 60 seconds, and retains at most eight workspace catalogs. No new polling or preload was added. Tag results have a stable 240-pixel region to avoid a loading-to-content height jump.

Workspace changes immediately scope displayed data; late responses cannot replace the current workspace. Permission failures clear stale data. Saved-reply category reads now accept the authorized requested workspace, matching the reply request rather than always using the default workspace.

Changed runtime files: `lib/inbox/quick-picker-cache.ts`, `components/inbox/quick-picker-loading.tsx`, `components/inbox/customer-tag-selector.tsx`, `components/inbox/saved-reply-selector.tsx`, `app/api/saved-reply-categories/route.ts`, `app/globals.css`.

Validation: six cache/API tests passed. Native Chrome fixtures using the actual selectors passed 19 assertions in normal motion and 19 in reduced motion: cold/slow/error/empty states, overlapping reads, warm reopening without extra requests, stale content during refresh, workspace switching, late responses and selection. Final combined regression suite: 84 passed; TypeScript and production build passed. No added lint findings against HEAD; existing selector/inbox lint errors remain.

Limits: fixture checks use synthetic reads, not an authenticated production session. There is no measured production CPU or latency improvement. Catalog edits in other tabs/settings are refreshed after TTL on a subsequent opening, not immediately broadcast; the cache is not persistent, and the existing logout document navigation clears it. No migration or deployment was performed.
