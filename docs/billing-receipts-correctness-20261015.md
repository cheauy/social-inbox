# TENH CHAT Billing History and Receipts — 2026-10-15

All four audited issues are fixed locally against HEAD b89c828. Newer and unrelated uncommitted work was preserved. These changes have not been deployed or verified in production. TENH POS and TENH LIVE were not modified.

## Root causes and fixes

| Issue | Status | Root cause and resulting behavior |
| --- | --- | --- |
| 1. Receipts across owned workspaces | Fixed locally | History used all active owner memberships while receipt authorization used the selected workspace. Both now share authenticated, active-owner eligibility. Receipt lookup is constrained to the invoice's actual workspace among those memberships, independent of selected-workspace cookies or client workspace IDs. Agent-only, unrelated, removed-owner and missing-invoice requests receive non-disclosing 404 responses; unauthenticated requests receive 401. Workspace names appear in history, details and receipt snapshots. |
| 2. Provenance and sandbox handling | Fixed locally | Provider, environment and verification were conflated. Shared display normalization reads saved source evidence and invoice snapshots only. PayWay sandbox, PayWay production, manual transfer and unknown/conflicting evidence remain separate. Test labels appear in history, details, receipt and print; sandbox/unknown approvals are excluded from confirmed-paid USD totals and have separately labeled totals. Manual approval never claims PayWay verification. Documents are labeled TENH Receipt; ABA PayWay appears only for supported source records. Saved amount, currency, reference, date and historical coverage are retained. Missing values remain unavailable. Provider payloads, secrets and private proof URLs are excluded from responses. Uploaded proof is not substituted for the issued receipt. |
| 3. Incorrect paid/verified details | Fixed locally | The detail panel used unconditional approved copy. Labels, colors and actions now follow persisted status and saved evidence, including pending/submitted, failed, declined, rejected, cancelled/canceled, recovery_required, draft and unknown. Only approved payments can expose an existing issued-invoice action. Approved payments without invoices explicitly show receipt unavailable; no invoice is generated or payment changed. |
| 4. Misleading PDF action | Fixed locally | The old PDF action opened HTML. Actions consistently say Print / Save PDF and use the existing receipt print flow in the same tab, avoiding popup dependence. Automatic printing waits for authorized matching data, fonts and images, runs once per request, and never prints loading/error screens. Ordinary viewing does not auto-print; manual printing remains available. Unsupported/throwing print calls show a browser-menu fallback. Print CSS hides navigation/actions, preserves saved workspace/payment details and the sandbox banner, and keeps sections together across page breaks. |

Browser verification also found and corrected mobile wrapping for long workspace names. Review found and corrected a crash on historical receipts with a missing saved plan name; absent names display a placeholder.

No prices, subscription periods, entitlements, approvals, payment verification, webhook processing or settlement logic changed. No live PayWay transaction lookup was added.

## Changed files

Application changes:

- lib/billing/owner-access.ts — shared active-owner authorization.
- lib/billing/payment-display.ts — evidence validation, provenance, status and localized formatting.
- app/api/subscription/billing-history/route.ts — authorized history, saved snapshots and separated totals.
- app/api/subscription/invoices/[invoiceId]/route.ts — invoice-workspace authorization and safe issued-receipt response.
- components/subscription/billing-history-view.tsx — truthful status, totals, receipt actions, EN/KM and responsive wrapping.
- components/subscription/invoice-receipt-view.tsx — saved receipt data, categorized errors, print readiness/fallback and print-only styling.

Regression tests:

- tests/billing-payment-display.test.cjs
- tests/billing-receipts-server.test.cjs
- tests/billing-receipts-browser.cjs
- tests/fixtures/billing-receipts-browser.entry.cjs

Documentation/evidence: this report, docs/evidence/billing-receipts-20261015/ and the dated migration update in docs/workspace-storage-correctness-20261015.md. Existing Storage migration/source changes were preserved; the named migration file was applied without editing it. Other worktree changes are not attributed to this task.

## Verification and actual results

| Check | Result | Evidence |
| --- | --- | --- |
| Isolated original API probes at b89c828 | Seven expected regression failures, confirming baseline authorization, provenance, status and snapshot defects. Baseline source was loaded in a child process without replacing worktree files. | baseline-server-probes.json and baseline-server-probes.log |
| Focused billing helper/API tests | 18/18 passed; included in broader run below. Covers A/B ownership with A selected, owner B with agent A selected, rejected agent/unrelated/removed-owner access, 401, safe temporary errors, provenance/totals, unsuccessful statuses, missing invoices and saved invoice snapshots. | billing-tests.log |
| Broader PayWay, native billing and SQL-fixture suite | 276/276 passed; zero failures or skips. Embedded PostgreSQL used a temporary PGlite installation; no repository dependency changes. | billing-tests.log |
| Real-component browser fixtures | Six cases passed: English/Khmer at 1280, 768 and 390px. 144 cumulative assertions per case, 864 total. Additional print-media checks passed for receipt-only content, sandbox/header visibility, blank error output, and null/absent plan names. Zero browser runtime errors. | browser/browser-results.json and screenshots |
| Browser-generated PDF | English and Khmer PDFs generated; MarkItDown inspection confirmed saved workspace/reference/amount/coverage and prominent sandbox wording, without fixture app navigation. Khmer text extraction has glyph/segmentation artifacts; screenshots were also visually reviewed. | browser/en-sandbox-receipt.pdf, browser/km-sandbox-receipt.pdf |
| TypeScript | Passed after final application edits. | typescript.log |
| ESLint on all ten billing application/test files | Passed, no issues. | changed-files-lint.log |
| Full-repository ESLint | Failed: 1,156 errors and 188 warnings. No billing-owned paths occur in the problem list. These broader worktree failures were left outside scope. | repository-lint.log |
| Production build | Passed compilation, TypeScript and static generation after final application edits. | build.log |
| Whitespace check | Passed across tracked worktree changes. | diff-check.log |
| Storage migration embedded SQL regression | 1/1 passed, no skips: actual SQL atomicity, replay, grants and deleted-file safety. Local fixtures only. | storage-migration-local-sql-test.log |

All evidence paths in this section are relative to docs/evidence/billing-receipts-20261015/. The RTK hook warning in some logs is diagnostic; exit status and final tool results establish the check outcomes.

Browser fixtures render the actual components and CSS in local Chrome, with mocked API responses, language/Next wrappers and print-dialog calls. Browser PDF generation is real. The fixtures exercised print readiness, ordinary viewing, stale/mismatched responses, duplicate-auto-print prevention, retry and unsupported/throwing printing. Page requests remained localhost-only. Real authenticated end-to-end navigation, OS print/Save dialogs, Safari and physical devices were not exercised. No production payment or private proof was loaded.

## Authorized Storage migration

The user separately authorized applying db/migrations/20261015065143_workspace_storage_upload_lifecycle.sql. It was applied successfully to TENH CHAT only: social-inbox, project dvieoqprsmzydtepbxwn. Supabase recorded version 20261015080957 with name workspace_storage_upload_lifecycle.

Read-only catalog assertions passed for prerequisite schema, table RLS, denied anon/authenticated table and RPC access, required service-role grants, security-invoker finalization RPC, cursor/pending indexes and migration history. The exact additive local SQL was used. See storage-migration-result.json.

No hosted uploads, object deletions, orphan cleanup, historical-row changes, bucket-policy changes or application deployment were performed. TENH LIVE and TENH POS were not targeted. Storage application rollout still requires fencing/draining the old destructive finalization writers, then releasing the safe server API before the updated web client. Keep the additive schema and safe API during rollback; do not restore the audited unsafe writer.

## Release prerequisites and remaining limitations

No Billing migration or backfill is needed. Records lacking consistent saved provenance remain unknown/unverified and do not silently become production payments. A separate read-only historical-data review may identify evidence gaps; this task did not recount or reclassify production records.

The official PayWay transaction-details reference describes transaction lookup, not a demonstrated provider-issued receipt/PDF/download mechanism. A literal ABA-issued document would require separately verified provider support; the implemented document is a TENH receipt. No provider receipt URL was invented.

Before release, resolve or explicitly account for repository-wide lint failures, review the combined uncommitted changes, and run an authorized staging/live-session check for owner receipt navigation and actual browser printing. Deployment needs separate approval. Local fixes and successful schema application are not evidence that the deployed Billing or Storage code has been updated.
