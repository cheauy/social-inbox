# Narrow Inbox divider and message/composer fit follow-up

Local changes only; all prior album/paging/realtime/Settings/Emoji and Bot work preserved. No deployment, live writes or real customer messages.

The parent supplied actual pixel inspection of libfile_6f8e644b5e048191bd35103fd4b74e53 (two arrows) and libfile_c359ffdf17d0819180ceb417757ef31d (lower message area). This executor used those reviews; it did not independently materialize them.

- Search/filter header: replace only its bottom rule with a faint 0/3px/8px downward shadow at 4% opacity. Existing title/search/filter/menu contents and handlers remain.
- Conversation panel left seam: remove the rail's right border where it meets the list. Outer connected outline, right seam, selected-row background and active blue rail pill remain; no other border removal.
- Messages: nested flex/min-height/overflow sizing fills remaining height and meets the composer without an external blank gap. Existing scroll DOM ref, handler, theme, message padding, source/media/album rendering, anchoring and composer placement are retained. Composer text growth/attachments/popups remain in ReplyBox; no width change or new horizontal layout is introduced. The main message surface scrolls rather than the combined pane. Native textarea internal overflow remains unchanged.

Runtime files: components/inbox/conversation-list.tsx, components/inbox/message-panel.tsx and new components/inbox/inbox-layout-surfaces.tsx. The small presentation wrappers keep the same DOM elements and expose the actual layout for browser fixtures; React 19 div refs pass through to the existing DOM scroll node.

All 66 desktop/390px component-fixture checks pass in the final Stage 2 bundle. Narrow checks measure zero header bottom border plus downward shadow, zero left-rail/list seam, empty/short/long message fill, variable composer height, exact bottom adjacency, bounded main-pane scroll and reduced available height. Existing selection, long-thread anchoring, paging, popup bounds, media and albums also pass. The fixture uses actual layout components with synthetic messages and a placeholder composer of changing height; it is not the complete authenticated MessagePanel/ReplyBox. Native mobile keyboard/attachment extremes and full deployed chat flow remain staging checks. Logs: Temp/tenh-stage2-complete-desktop-result.json and tenh-stage2-complete-mobile-result.json.

Type/build passed; new presentation module is lint-clean, with no introduced findings in existing Inbox files. Stage 2 new-type tests are documented separately in tenh-bot-stage2-drafts.md; this visual work is not substituted as Bot validation.
