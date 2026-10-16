-- Correct only Bakong's missing required billing timestamp. No payment or authorization writes.
-- Preserve the installed base/pilot composition, OID, grants, locks and financial guards.
-- Rollback: retain this compatible repair, or restore the reviewed prior function with checkout stopped.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';

do $repair$
declare
  target oid := 'public.tenh_prepare_bakong_payment(jsonb,uuid,uuid,uuid,jsonb,text,text,text,text,text,text,timestamptz,integer)'::regprocedure;
  original text := replace(pg_get_functiondef(target),E'\r\n',E'\n');
  corrected text;
  prior_acl aclitem[]; prior_owner oid; prior_definer boolean; prior_config text[];
  old_columns constant text := 'target_member_limit,target_channel_limit,pricing_version,renew_same,pricing_snapshot,metadata)';
  new_columns constant text := 'target_member_limit,target_channel_limit,pricing_version,renew_same,pricing_snapshot,request_time,metadata)';
  old_values constant text := $v$(p_record->>'renew_same')::boolean,p_record->'pricing_snapshot',jsonb_build_object($v$;
  new_values constant text := $v$(p_record->>'renew_same')::boolean,p_record->'pricing_snapshot',to_char(clock_timestamp() at time zone 'UTC','YYYYMMDDHH24MISS'),jsonb_build_object($v$;
  known text[] := array['971fe8477e5ce4c8a25a2cf587947e00','df21bc37acebaa799427e8409e8fa273'];
begin
  if current_user not in ('postgres','supabase_admin') then raise exception 'Trusted database owner required'; end if;
  if not exists(select 1 from pg_attribute a where a.attrelid='public.billing_transactions'::regclass
    and a.attname='request_time' and not a.attisdropped and a.atttypid='text'::regtype and a.attnotnull
    and not exists(select 1 from pg_attrdef d where d.adrelid=a.attrelid and d.adnum=a.attnum)) then
    raise exception 'Review the installed required request_time contract';
  end if;
  select proacl,proowner,prosecdef,proconfig into prior_acl,prior_owner,prior_definer,prior_config from pg_proc where oid=target;
  if pg_get_userbyid(prior_owner)<>'postgres' or not prior_definer
    or has_function_privilege('anon',target,'EXECUTE') or has_function_privilege('authenticated',target,'EXECUTE')
    or not has_function_privilege('service_role',target,'EXECUTE') then raise exception 'Review preparation ownership and grants'; end if;

  if not (md5(original)=any(known)) then
    -- An identical reapply is safe; any other installed body needs separate review.
    if md5(replace(replace(original,new_columns,old_columns),new_values,old_values))=any(known) then return; end if;
    raise exception 'Review the installed Bakong preparation contract before request_time repair';
  end if;
  if strpos(original,old_columns)=0 or strpos(original,old_values)=0 then raise exception 'Required billing insert was not found'; end if;
  corrected:=replace(replace(original,old_columns,new_columns),old_values,new_values);
  execute corrected;
  if 'public.tenh_prepare_bakong_payment(jsonb,uuid,uuid,uuid,jsonb,text,text,text,text,text,text,timestamptz,integer)'::regprocedure::oid<>target
    or replace(pg_get_functiondef(target),E'\r\n',E'\n') is distinct from corrected
    or not exists(select 1 from pg_proc where oid=target and proacl is not distinct from prior_acl
      and proowner=prior_owner and prosecdef=prior_definer and proconfig is not distinct from prior_config) then
    raise exception 'Preparation identity, permissions or surrounding behavior changed';
  end if;
end
$repair$;
commit;
