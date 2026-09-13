# Duplicate header controls fix — 2026-09-13

The previous web patch gave the status menu and Business Suite shortcut the same
React key (`conversation.id`). Switching chats then left duplicate status menus
in the header. This patch gives each component a distinct key while preserving
its reset when the selected conversation changes.

Apply the ZIP over the latest TENH web files, preserving folder paths. Restart
the development server or redeploy the web app, then use **Ctrl+Shift+R** to fully
reload TENH. A full reload clears controls already left behind by the old code;
do not rely only on development Fast Refresh.

No SQL migration, dependency change or extension update is required for this
error. The existing packaged TENH Companion 1.2.27 already handles the Business
Suite action and reports whether an exact chat or only the Page inbox opened.
The header key collision occurs in the website before that navigation is used.

Validation reproduced the bug before the fix: 40 switches produced 40 status
controls. After the fix, the same client-rendered test retains exactly one status
menu and one shortcut without React warnings. Additional tests verify that the
status dropdown closes on a chat switch, remains interactive, and Companion
notices reset while navigation targets the selected customer.

The 80-test source-card/live-message/presence suite passes. Strict TypeScript
checking reports zero diagnostics for 535 supplied TS/TSX files. This patch
contains one changed application file, its regression test and these notes.
