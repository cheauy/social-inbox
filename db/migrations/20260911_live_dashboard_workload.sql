-- Current workload is independent of historical analytics ranges.
create or replace function public.get_tenh_live_workload(p_business_id uuid, p_sla_seconds integer default 600)
returns jsonb language sql stable security definer set search_path = '' as $$
with active as (
  select c.id, c.unread_count from public.conversations c
  where c.business_id = p_business_id and c.status in ('open', 'pending')
), activity as (
  select a.id, a.unread_count,
    max(coalesce(m.platform_created_at,m.created_at)) filter(where m.direction='incoming') as incoming_at,
    max(coalesce(m.platform_created_at,m.created_at)) filter(where m.direction='outgoing') as outgoing_at
  from active a left join public.messages m on m.conversation_id=a.id and m.business_id=p_business_id
    and coalesce(m.platform_created_at,m.created_at)<=now()
  group by a.id,a.unread_count
)
select jsonb_build_object(
  'unreadConversations', (select count(*) from active where coalesce(unread_count,0)>0),
  'waitingOverSla', (select count(*) from activity where incoming_at < now()-make_interval(secs=>greatest(60,p_sla_seconds)) and (outgoing_at is null or outgoing_at<incoming_at)),
  'overdueReminders', (select count(*) from public.conversation_reminders where business_id=p_business_id and status='open' and remind_at<now())
);
$$;
revoke all on function public.get_tenh_live_workload(uuid,integer) from public, anon, authenticated;
grant execute on function public.get_tenh_live_workload(uuid,integer) to service_role;
