-- Forward-only review draft. Apply after 20261015120849_auth_session_policy.
-- No provider Auth configuration or live-session changes; no hosted application authorized.
begin;
create function public.tenh_list_effective_user_sessions(p_user_id uuid,p_current_session_id uuid default null)
returns jsonb language sql stable security definer set search_path='' as $function$
  with candidates as materialized (
    -- Skip provider leftovers before the bounded inspector window, so revoked
    -- devices cannot hide older usable ones. The inspector still authorizes rows.
    select s.id,s.created_at,to_jsonb(s) as attributes from auth.sessions s
    cross join tenh_auth_private.session_settings settings
    left join tenh_auth_private.session_policies p on p.session_id=s.id
    where settings.singleton and s.user_id=p_user_id
      and s.created_at is not null and s.created_at<=statement_timestamp()
      and (s.not_after is null or s.not_after>statement_timestamp())
      and ((p.session_id is not null and p.user_id=p_user_id and p.revoked_at is null and p.expires_at>statement_timestamp())
        or (p.session_id is null and (not settings.enforcement_enabled or
          (s.created_at<settings.legacy_created_before and statement_timestamp()<settings.legacy_grace_until))))
    order by (s.id=p_current_session_id) desc,s.created_at desc,s.id limit 100
  ), inspected as materialized (
    select c.*,tenh_auth_private.inspect_session(p_user_id,c.id) as policy from candidates c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'created_at',attributes->'created_at','updated_at',attributes->'updated_at',
    'refreshed_at',attributes->'refreshed_at','not_after',policy->'expires_at',
    'user_agent',attributes->'user_agent','ip',attributes->'ip','aal',attributes->'aal'
  ) order by (id=p_current_session_id) desc,created_at desc,id),'[]'::jsonb)
  from inspected where policy->>'status'='allowed';
$function$;
revoke all on function public.tenh_list_effective_user_sessions(uuid,uuid) from public,anon,authenticated;
grant execute on function public.tenh_list_effective_user_sessions(uuid,uuid) to service_role;
commit;
