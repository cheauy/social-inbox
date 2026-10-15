# TENH CHAT combined release — 2026-10-15

User authorization: commit and deploy all current TENH CHAT changes. Repository: C:/Users/TUF/social-inbox, main, base b89c8284e3f98a0b98b8fe11b264f2f87157dfe4. Origin: cheauy/social-inbox. TENH POS and TENH LIVE are excluded.

Scope: all current tracked/untracked repository changes, including Storage correctness, Billing History/receipts, responsive compact navigation, integrations controls, expired-subscription access/layout, regression fixtures and evidence. Ignored credentials, dependencies, build output and local metadata are excluded.

Verified deployment target: Vercel social-inbox, prj_vYYpzTgJTgQ7BCKTPlfTPwiyJhqn, account team_bAqTMA1nAJy4VrJznd49TF6z (chea-uy). Existing production is dpl_CSyuYFTJkzsVJGQiAadyGPNc4uYM at base b89c828, with app.tenhchat.com and existing TENH CHAT aliases. Existing Git integration deploys main.

Checks: 276 Billing/PayWay/native regressions passed, plus 127 combined nonbilling tests (zero skips, including embedded PostgreSQL Storage lifecycle). Billing browser matrix passed 864 cumulative assertions in EN/KM at desktop/tablet/mobile widths. Existing matching navigation/subscription/integrations/Storage browser evidence was reviewed. Latest TypeScript, production build and Billing/Storage focused lint passed. Navigation baseline comparison has five old errors, five current, zero introduced. Full-repository lint remains failing (1,156 errors,188 warnings); no unrelated lint cleanup was included. Read-only combined source review found no additional release-blocking defect.

The authorized Storage migration was already applied and catalog-verified on TENH CHAT only, hosted version 20261015080957_workspace_storage_upload_lifecycle. No Billing migration/backfill or historical record rewrite is needed.

Cutover: temporary project route 0e279d2d-3992-4dd8-853f-a68f3f9f8b04 blocks only POST /api/workspace-storage/files with503/no-store/Retry-After30. Promoted route version702bd016-a55a-40ff-9a40-489360dd9d4a at approximately2026-10-15T08:45:02Z. External unauthenticated probes confirmed503 plus cutover header, including old deployment query/header pins. GET remains401. This temporarily pauses Storage mutations while existing legacy finalization requests drain. No object/file mutations were used for verification.

Explicit team-scoped platform requests returned403, while unscoped requests to the exact verified project work. The optional skew-boundary update returned404 Skew Protection not found and did not apply. Custom Storage fetch code supplies no deployment pin; read-only probes with nonexistent deployment query/header pins returned the same401 as ordinary requests. Before removing the fence, verify the released Billing authorization response through old query/header/cookie pins, so a stale build is not being selected.

Plan: commit the full reviewed tree; push main through its existing Git deployment; confirm the exact commit is READY/Production and all production aliases reference it; retain the POST fence for a conservative900-second drain window; verify old pins resolve to the new safe build; then disable only the temporary fence and recheck unauthorized Storage requests, receipt endpoints, public pages and runtime error counts. Do not roll back to the unsafe Storage writer. No billing mutations, real uploads/deletions, cleanup, bucket policies, Bot activation or payment settlement changes are authorized by this release.

Final deployment status and IDs will be reported after actual platform verification. This document is a preflight record, not a claim of deployment completion.
