# Exact proposed SQL installation and security approval

Production inspection supplied by the parent: project dvieoqprsmzydtepbxwn, role/database postgres, original paging dependency presence complete, initial seven RPCs absent with no overloads, rule-set storage absent, messages/conversations already published. This is read-only evidence, not mutation approval. New notification columns, additional RPCs and four execution tables were not covered by that result; rerun the updated single SELECT docs/sql/tenh-release-preflight-summary.sql before installation. Inspect notification_type enum/check constraints before allowing internal alerts. Stop for any unexpected existing object; do not replace an unreviewed definition.

Order: db/migrations/20261003_inbox_server_paging.sql, 20261004_tenh_bot_durable_rules.sql, 20261005_tenh_bot_execution_ledger.sql. These do not apply the earlier legacy comment-Bot migrations, add a schedule, enable a worker, activate a rule, or delete existing tables/history. A combined transactional installation script may be generated only from the final tested versions, with one BEGIN and one COMMIT; any failed dependency/DDL rolls back the entire installation. Keep the source snapshot and private backup separately. The database backup has not been restored in a test environment.

New tables: public.tenh_bot_rule_sets; public.tenh_bot_execution_controls; public.tenh_bot_recipient_state; public.tenh_bot_events; public.tenh_bot_execution_jobs.
For each: ENABLE ROW LEVEL SECURITY; REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT SELECT, INSERT, UPDATE TO service_role. No client-access RLS policy is added. No DELETE privilege is granted. Rule configuration defaults disabled and has a constraint preventing activation; execution controls default paused. No grants on existing customer/staff/notification tables are added.

Every following function is SECURITY INVOKER with fixed search_path public,pg_temp. REVOKE ALL function privileges FROM PUBLIC,anon,authenticated; GRANT EXECUTE TO service_role only:
- public.tenh_inbox_filter_matches(jsonb,jsonb,uuid)
- public.tenh_inbox_page(uuid,uuid[],jsonb,jsonb,boolean)
- public.tenh_bot_save_rule_set(uuid,uuid,bigint,jsonb)
- public.tenh_bot_record_event(uuid,bigint,jsonb)
- public.tenh_bot_claim_jobs(integer)
- public.tenh_bot_reserve_job(uuid,uuid)
- public.tenh_bot_finish_job(uuid,uuid,text,text,text)
- public.tenh_bot_set_human_hold(uuid,uuid,boolean)
- public.tenh_bot_recover_jobs(integer)
- public.tenh_bot_execute_internal(uuid,uuid)
- public.tenh_bot_pending_event_ids(integer)

Only paging functions use CREATE OR REPLACE; the expected signature/overload absence has been reported. Bot objects use CREATE, deliberately failing if any conflicting existing object appears. New indexes: tenh_bot_rule_sets primary key (business_id,social_account_id); tenh_bot_recipient_state composite primary key; message event primary key; job primary/action-key uniqueness; tenh_bot_jobs_due partial(due_at,id) WHERE status=queued; tenh_bot_jobs_recipient(business_id,social_account_id,recipient_id,status). No proposed Inbox optional indexes are installed here. No existing publication, tenant policy, Meta permission, customer data, legacy Bot control, or database history changes. Schema cache notification pgrst reload schema is emitted only on successful commit.

Action-time user approval must explicitly cover this full table/RLS/grant/function/index set. Diagnostic "ok done" was not approval. No remote mutation or SQL application has occurred. User-authorized source publication is separate from SQL permission changes and activation.

The final one-transaction handoff is docs/sql/tenh-release-install-disabled.sql. It contains source-file SHA256 identifiers and has been executed successfully in disposable PostgreSQL along with claim/hold/uncertainty tests. Final metadata query includes eleven RPCs, block-store and notification dependencies/type/check constraints, encrypted-token column presence only, and all four ledger table existence checks. The original seven-function result does not cover these additions. No source archive was uploaded; dot-preview transfer was cancelled. The exact five-table/eleven-RPC security set is stable for this packet; do not approve only the earlier subset.

Final refreshed preflight supplied 2026-10-01: missing_dependencies=[], overloads=[], all eleven RPCs and all five new tables absent; notification_type=text, notification_constraints=[]; messages/conversations publication present. This completes the diagnostic scope. No repeat query needed unless source dependencies change. Exact security approval remains pending. Installer SHA256: 92CE108A463C5B52B596E3605945410DBFD76C2B8310CE3BD04E4CC69D3FE689.
