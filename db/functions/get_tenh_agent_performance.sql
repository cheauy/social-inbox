-- Agent performance for the Analytics page.
--
-- Two changes from the previous version:
--
-- 1. Facebook comment threads no longer count as conversations. The response
--    cohort (`received`) and `conversationsReplied` both exclude them, so
--    firstResponses, slaMet, slaMissed and the conversation count all measure
--    the same population as the conversation report and the SLA page. Without
--    that, one Analytics page showed two different SLA figures for the same
--    period and no way to tell why.
--
--    `outgoingMessages` still counts every reply, comments included. It is a
--    message metric, not a conversation metric, and an agent who answers a
--    comment did send that message.
--
-- 2. Removed the `member_metrics` CTE. It joined first_responses and
--    outgoing_period with `on true`, producing a cross product; its own
--    comment said so, and it was replaced by first_by_member and
--    outgoing_by_member. Nothing referenced it — it built a cross product
--    for results that were then discarded.

CREATE OR REPLACE FUNCTION public.get_tenh_agent_performance(
  p_business_id uuid,
  p_start timestamp with time zone,
  p_end timestamp with time zone,
  p_sla_seconds integer DEFAULT 600
)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with
params as (
  select greatest(p_sla_seconds, 60)::numeric as sla_seconds
),

/*
 * Conversations that received at least one customer message in the
 * selected period. This is the same cohort idea used by V2.14.
 */
received as (
  select
    m.conversation_id,
    min(coalesce(m.platform_created_at, m.created_at)) as first_incoming_at
  from public.messages m
  join public.conversations c
    on c.id = m.conversation_id
   and c.business_id = p_business_id
  where
    m.business_id = p_business_id
    and m.direction = 'incoming'
    and c.status <> 'spam'
    -- Comment threads are not conversations. Excluding them here keeps
    -- firstResponses, slaMet and slaMissed measuring the same population the
    -- conversation report and the SLA page count, so the Analytics page does
    -- not show two different SLA figures for one period.
    and coalesce(c.source_type, 'messenger') <> 'comment'
    and coalesce(m.platform_created_at, m.created_at) >= p_start
    and coalesce(m.platform_created_at, m.created_at) < p_end
  group by m.conversation_id
),

/* First outgoing reply after each cohort's first incoming message. */
first_responses as (
  select
    r.conversation_id,
    r.first_incoming_at,
    response.message_id,
    response.first_response_at,
    response.sent_by_member_id,
    case
      when response.first_response_at is null then null
      else extract(
        epoch from (
          response.first_response_at - r.first_incoming_at
        )
      )::numeric
    end as first_response_seconds
  from received r
  left join lateral (
    select
      m2.id as message_id,
      coalesce(m2.platform_created_at, m2.created_at) as first_response_at,
      m2.sent_by_member_id
    from public.messages m2
    where
      m2.business_id = p_business_id
      and m2.conversation_id = r.conversation_id
      and m2.direction = 'outgoing'
      and coalesce(m2.platform_created_at, m2.created_at) >= r.first_incoming_at
      and coalesce(m2.platform_created_at, m2.created_at) <= p_end
    order by
      coalesce(m2.platform_created_at, m2.created_at) asc,
      m2.id asc
    limit 1
  ) response on true
),

/*
 * All outgoing replies in the selected period. source_type is carried so
 * conversation counts can exclude comment threads while message counts
 * keep including them.
 */
outgoing_period as (
  select
    m.id,
    m.conversation_id,
    m.sent_by_member_id,
    c.source_type,
    coalesce(m.platform_created_at, m.created_at) as sent_at
  from public.messages m
  join public.conversations c
    on c.id = m.conversation_id
   and c.business_id = p_business_id
  where
    m.business_id = p_business_id
    and m.direction = 'outgoing'
    and c.status <> 'spam'
    and coalesce(m.platform_created_at, m.created_at) >= p_start
    and coalesce(m.platform_created_at, m.created_at) < p_end
),

resolution_actions as (
  select
    ca.actor_member_id,
    count(*)::integer as resolved_actions
  from public.conversation_activity ca
  where
    ca.business_id = p_business_id
    and ca.actor_member_id is not null
    and ca.activity_type = 'status_changed'
    and ca.created_at >= p_start
    and ca.created_at < p_end
    and coalesce(ca.metadata ->> 'newStatus', '') in ('resolved', 'closed')
  group by ca.actor_member_id
),

members as (
  select
    tm.id,
    tm.full_name,
    tm.email,
    tm.role,
    tm.profile_picture_url
  from public.team_members tm
  where
    tm.business_id = p_business_id
    and tm.is_active = true
),

first_by_member as (
  select
    m.id as member_id,
    count(fr.message_id)::integer as first_responses,
    coalesce(round(avg(fr.first_response_seconds))::integer, 0) as avg_first_response_seconds,
    coalesce(
      round(percentile_cont(0.5) within group (
        order by fr.first_response_seconds
      ))::integer,
      0
    ) as median_first_response_seconds,
    count(fr.message_id) filter (
      where fr.first_response_seconds <= p.sla_seconds
    )::integer as sla_met,
    count(fr.message_id) filter (
      where fr.first_response_seconds > p.sla_seconds
    )::integer as sla_missed
  from members m
  cross join params p
  left join first_responses fr
    on fr.sent_by_member_id = m.id
  group by m.id
),

outgoing_by_member as (
  select
    m.id as member_id,
    count(op.id)::integer as outgoing_messages,
    -- Conversation count only: comment threads are excluded here, while
    -- outgoing_messages above still counts replies sent to them.
    count(distinct op.conversation_id) filter (
      where coalesce(op.source_type, 'messenger') <> 'comment'
    )::integer as conversations_replied
  from members m
  left join outgoing_period op
    on op.sent_by_member_id = m.id
  group by m.id
),

agent_rows as (
  select
    m.id,
    m.full_name,
    m.email,
    m.role,
    m.profile_picture_url,
    coalesce(f.first_responses, 0) as first_responses,
    coalesce(f.avg_first_response_seconds, 0) as avg_first_response_seconds,
    coalesce(f.median_first_response_seconds, 0) as median_first_response_seconds,
    coalesce(f.sla_met, 0) as sla_met,
    coalesce(f.sla_missed, 0) as sla_missed,
    case
      when coalesce(f.first_responses, 0) = 0 then null
      else round(
        coalesce(f.sla_met, 0)::numeric * 100.0
        / nullif(coalesce(f.first_responses, 0)::numeric, 0)
      )::integer
    end as sla_rate,
    coalesce(o.outgoing_messages, 0) as outgoing_messages,
    coalesce(o.conversations_replied, 0) as conversations_replied,
    coalesce(r.resolved_actions, 0) as resolved_actions
  from members m
  left join first_by_member f on f.member_id = m.id
  left join outgoing_by_member o on o.member_id = m.id
  left join resolution_actions r on r.actor_member_id = m.id
),

summary as (
  select
    (select count(*)::integer from outgoing_period) as total_outgoing,
    (select count(*)::integer from outgoing_period where sent_by_member_id is not null) as attributed_outgoing,
    (select count(*)::integer from outgoing_period where sent_by_member_id is null) as unattributed_outgoing,
    (select count(message_id)::integer from first_responses) as total_first_responses,
    (select count(message_id)::integer from first_responses where sent_by_member_id is not null) as attributed_first_responses,
    (select count(message_id)::integer from first_responses where sent_by_member_id is null) as unattributed_first_responses,
    coalesce(
      round(avg(first_response_seconds) filter (
        where sent_by_member_id is not null
          and first_response_seconds is not null
      ))::integer,
      0
    ) as avg_attributed_first_response_seconds,
    count(message_id) filter (
      where sent_by_member_id is not null
        and first_response_seconds <= p.sla_seconds
    )::integer as sla_met,
    count(message_id) filter (
      where sent_by_member_id is not null
        and first_response_seconds > p.sla_seconds
    )::integer as sla_missed
  from first_responses
  cross join params p
),

agents_json as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'memberId', a.id,
        'fullName', a.full_name,
        'email', a.email,
        'role', a.role,
        'profilePictureUrl', a.profile_picture_url,
        'firstResponses', a.first_responses,
        'avgFirstResponseSeconds', a.avg_first_response_seconds,
        'medianFirstResponseSeconds', a.median_first_response_seconds,
        'slaMet', a.sla_met,
        'slaMissed', a.sla_missed,
        'slaRate', a.sla_rate,
        'outgoingMessages', a.outgoing_messages,
        'conversationsReplied', a.conversations_replied,
        'resolvedActions', a.resolved_actions
      )
      order by
        a.first_responses desc,
        a.outgoing_messages desc,
        a.full_name asc
    ),
    '[]'::jsonb
  ) as value
  from agent_rows a
)

select jsonb_build_object(
  'summary', jsonb_build_object(
    'totalOutgoing', s.total_outgoing,
    'attributedOutgoing', s.attributed_outgoing,
    'unattributedOutgoing', s.unattributed_outgoing,
    'attributionRate',
      case
        when s.total_outgoing = 0 then 100
        else round(s.attributed_outgoing::numeric * 100.0 / s.total_outgoing::numeric)::integer
      end,
    'totalFirstResponses', s.total_first_responses,
    'attributedFirstResponses', s.attributed_first_responses,
    'unattributedFirstResponses', s.unattributed_first_responses,
    'avgFirstResponseSeconds', s.avg_attributed_first_response_seconds,
    'slaMet', s.sla_met,
    'slaMissed', s.sla_missed,
    'slaRate',
      case
        when (s.sla_met + s.sla_missed) = 0 then null
        else round(s.sla_met::numeric * 100.0 / (s.sla_met + s.sla_missed)::numeric)::integer
      end
  ),
  'agents', aj.value
)
from summary s
cross join agents_json aj;
$function$;
