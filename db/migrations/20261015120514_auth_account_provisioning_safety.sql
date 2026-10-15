-- FORWARD REVIEW DRAFT ONLY. No hosted application or Auth changes authorized.
-- Inventory the legacy four-argument function and ownership/grants before rollout.
-- Route every signup/login writer through this wrapper; inspect existing Auth
-- triggers and verify concurrent staging logins before releasing new callers.
-- Fence/co-deploy old API writers: direct legacy service calls fail closed.
-- Install before application callers; retain additive wrappers on rollback.
begin;

do $prerequisite$
declare v_owner name;
begin
  if to_regprocedure('public.tenh_ensure_user_workspace(uuid,text,text,text)') is null then
    raise exception 'Review/install the existing workspace provisioner before this migration.';
  end if;
  select r.rolname into v_owner from pg_proc p join pg_roles r on r.oid=p.proowner
    where p.oid='public.tenh_ensure_user_workspace(uuid,text,text,text)'::regprocedure;
  if v_owner not in ('postgres','supabase_admin') or current_user not in ('postgres','supabase_admin') then
    raise exception 'Provisioner and wrapper owners require trusted database-administrator review; client/service ownership is forbidden.';
  end if;
end
$prerequisite$;

create function public.tenh_account_has_password_for_user(p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $function$
  select coalesce(length(u.encrypted_password),0)>0 from auth.users u where u.id=p_user_id;
$function$;
revoke all on function public.tenh_account_has_password_for_user(uuid) from public,anon,authenticated;
grant execute on function public.tenh_account_has_password_for_user(uuid) to service_role;

create function public.tenh_ensure_user_workspace_safe(
  p_user_id uuid,p_full_name text,p_email text,p_business_name text)
returns setof public.team_members language plpgsql security definer set search_path='' as $function$
declare account auth.users%rowtype; member public.team_members%rowtype; result_ids uuid[]; v_email text;
begin
  -- Concurrent login/signup callbacks for one account serialize before inspection.
  select * into account from auth.users where id=p_user_id for update;
  if not found or account.email_confirmed_at is null or nullif(trim(account.email),'') is null then
    raise exception 'A verified account email is required' using errcode='42501';
  end if;
  v_email:=lower(trim(account.email));
  if lower(trim(p_email)) is distinct from v_email then raise exception 'Account identity mismatch' using errcode='42501'; end if;
  select * into member from public.team_members where user_id=p_user_id and is_active
    order by created_at desc,id limit 1;
  if found then return next member; return; end if;
  if exists(select 1 from public.team_members m where m.user_id=p_user_id or lower(trim(m.email))=v_email) then
    raise exception 'Inactive memberships and invitations require explicit Owner action' using errcode='42501',detail='TENH_MEMBERSHIP_ACTION_REQUIRED';
  end if;
  select array_agg(created.id) into result_ids from public.tenh_ensure_user_workspace(
    p_user_id=>p_user_id,p_full_name=>left(p_full_name,120),p_email=>v_email,p_business_name=>left(p_business_name,120)) created;
  if coalesce(cardinality(result_ids),0)<>1 then raise exception 'Provisioning did not return exactly one membership'; end if;
  select * into member from public.team_members where id=result_ids[1] and user_id=p_user_id and is_active;
  if not found then raise exception 'Provisioning returned another or inactive account membership' using errcode='42501'; end if;
  return next member;
end
$function$;
revoke all on function public.tenh_ensure_user_workspace_safe(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.tenh_ensure_user_workspace_safe(uuid,text,text,text) to service_role;
-- Prevent direct legacy calls from bypassing the verified, non-restoring wrapper.
revoke all on function public.tenh_ensure_user_workspace(uuid,text,text,text) from public,anon,authenticated,service_role;
commit;
