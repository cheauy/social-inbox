-- SLA analytics for the Analytics page.
--
-- Change from the previous version: Facebook comment threads are excluded
-- from the cohort. Every figure here counts conversations — received,
-- responded, waiting, slaMet, slaMissed, slaWaiting, slaRate, resolved, the
-- daily series and the attention list — and a comment thread is not a
-- conversation.
--
-- This matters beyond the counts. Without it the Analytics page showed an
-- SLA rate computed over one population and a conversation total computed
-- over another, with nothing on screen explaining the difference. The same
-- exclusion is applied in get_tenh_conversation_reports and
-- get_tenh_agent_performance so all three agree.
--
-- Expect the SLA rate itself to move, not only the counts: comments are
-- often answered more slowly than Messenger DMs, so removing them usually
-- raises the rate. That is a real change, not a regression.

CREATE OR REPLACE FUNCTION public.get_tenh_sla_analytics(
  p_business_id uuid,
  p_start timestamp with time zone,
  p_end timestamp with time zone,
  p_sla_seconds integer DEFAULT 600,
  p_tz_offset_minutes integer DEFAULT 0
)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with
params as (
  select
    greatest(p_sla_seconds, 60)::numeric as sla_seconds,
    greatest(-840, least(840, p_tz_offset_minutes))::integer as tz_offset_minutes
),

/*
 * One cohort row per conversation that received at least one
 * incoming customer message inside the selected analytics period.
 */
received as (
  select
    m.conversation_id,
    min(coalesce(m.platform_created_at, m.created_at)) as first_incoming_at
  from public.messages m
  where
    m.business_id = p_business_id
    and m.direction = 'incoming'
    and coalesce(m.platform_created_at, m.created_at) >= p_start
    and coalesce(m.platform_created_at, m.created_at) < p_end
  group by m.conversation_id
),

/*
 * First outgoing message after the first incoming message in this
 * selected-period cohort. This measures first-response time without
 * requiring any changes to the current send APIs.
 */
cohort as (
  select
    r.conversation_id,
    r.first_incoming_at,
    response.first_response_at,
    case
      when response.first_response_at is null then null
      else extract(
        epoch from (
          response.first_response_at - r.first_incoming_at
        )
      )::numeric
    end as first_response_seconds,
    c.status,
    c.status_updated_at,
    c.updated_at,
    c.created_at,
    c.contact_id,
    c.assigned_to,
    contact.full_name as customer_name,
    assigned.full_name as assigned_name
  from received r
  join public.conversations c
    on c.id = r.conversation_id
   and c.business_id = p_business_id
  left join public.contacts contact
    on contact.id = c.contact_id
   and contact.business_id = p_business_id
  left join public.team_members assigned
    on assigned.id = c.assigned_to
   and assigned.business_id = p_business_id
  left join lateral (
    select
      min(coalesce(m2.platform_created_at, m2.created_at)) as first_response_at
    from public.messages m2
    where
      m2.business_id = p_business_id
      and m2.conversation_id = r.conversation_id
      and m2.direction = 'outgoing'
      and coalesce(m2.platform_created_at, m2.created_at) >= r.first_incoming_at
      and coalesce(m2.platform_created_at, m2.created_at) <= p_end
  ) response on true
  where c.status <> 'spam'
    -- Comment threads are not conversations. This is the only filter point:
    -- evaluated, summary, daily_rows and attention all read from here.
    and coalesce(c.source_type, 'messenger') <> 'comment'
),

evaluated as (
  select
    c.*,
    case
      when c.first_response_at is not null
        and c.first_response_seconds <= p.sla_seconds
        then 'met'
      when c.first_response_at is not null
        and c.first_response_seconds > p.sla_seconds
        then 'missed'
      when c.first_response_at is null
        and extract(epoch from (p_end - c.first_incoming_at)) > p.sla_seconds
        then 'missed'
      else 'waiting'
    end as sla_state,
    case
      when c.status in ('resolved', 'closed')
       and coalesce(c.status_updated_at, c.updated_at, c.created_at) >= c.first_incoming_at
      then extract(
        epoch from (
          coalesce(c.status_updated_at, c.updated_at, c.created_at)
          - c.first_incoming_at
        )
      )::numeric
      else null
    end as resolution_seconds,
    (
      c.first_incoming_at
      - make_interval(mins => p.tz_offset_minutes)
    )::date as local_received_date
  from cohort c
  cross join params p
),

summary as (
  select
    count(*)::integer as received,
    count(*) filter (
      where first_response_at is not null
    )::integer as responded,
    count(*) filter (
      where first_response_at is null
    )::integer as waiting,
    coalesce(
      round(avg(first_response_seconds) filter (
        where first_response_seconds is not null
      ))::integer,
      0
    ) as avg_first_response_seconds,
    coalesce(
      round(percentile_cont(0.5) within group (
        order by first_response_seconds
      ) filter (
        where first_response_seconds is not null
      ))::integer,
      0
    ) as median_first_response_seconds,
    count(*) filter (
      where sla_state = 'met'
    )::integer as sla_met,
    count(*) filter (
      where sla_state = 'missed'
    )::integer as sla_missed,
    count(*) filter (
      where sla_state = 'waiting'
    )::integer as sla_waiting,
    count(*) filter (
      where resolution_seconds is not null
    )::integer as resolved,
    coalesce(
      round(avg(resolution_seconds) filter (
        where resolution_seconds is not null
      ))::integer,
      0
    ) as avg_resolution_seconds
  from evaluated
),

daily_rows as (
  select
    local_received_date as day,
    count(*)::integer as received,
    count(*) filter (
      where first_response_at is not null
    )::integer as responded,
    coalesce(
      round(avg(first_response_seconds) filter (
        where first_response_seconds is not null
      ))::integer,
      0
    ) as avg_first_response_seconds,
    count(*) filter (
      where sla_state = 'met'
    )::integer as sla_met,
    count(*) filter (
      where sla_state = 'missed'
    )::integer as sla_missed
  from evaluated
  group by local_received_date
),

daily as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', to_char(day, 'YYYY-MM-DD'),
        'received', received,
        'responded', responded,
        'avgFirstResponseSeconds', avg_first_response_seconds,
        'slaMet', sla_met,
        'slaMissed', sla_missed
      )
      order by day asc
    ),
    '[]'::jsonb
  ) as value
  from daily_rows
),

attention as (
  select coalesce(
    jsonb_agg(item order by sort_rank asc, elapsed_seconds desc),
    '[]'::jsonb
  ) as value
  from (
    select
      case
        when e.sla_state = 'missed' and e.first_response_at is null then 0
        when e.sla_state = 'waiting' then 1
        when e.sla_state = 'missed' then 2
        else 3
      end as sort_rank,
      case
        when e.first_response_at is null
          then greatest(0, extract(epoch from (p_end - e.first_incoming_at)))::integer
        else greatest(0, e.first_response_seconds)::integer
      end as elapsed_seconds,
      jsonb_build_object(
        'conversationId', e.conversation_id,
        'customerName', coalesce(nullif(trim(e.customer_name), ''), 'Facebook customer'),
        'assignedName', e.assigned_name,
        'status', e.status,
        'firstIncomingAt', e.first_incoming_at,
        'firstResponseAt', e.first_response_at,
        'firstResponseSeconds',
          case
            when e.first_response_seconds is null then null
            else round(e.first_response_seconds)::integer
          end,
        'elapsedSeconds',
          case
            when e.first_response_at is null
              then greatest(0, extract(epoch from (p_end - e.first_incoming_at)))::integer
            else greatest(0, e.first_response_seconds)::integer
          end,
        'slaState', e.sla_state
      ) as item
    from evaluated e
    where e.sla_state in ('missed', 'waiting')
    order by sort_rank asc, elapsed_seconds desc
    limit 12
  ) ranked
),

final_summary as (
  select
    s.*,
    case
      when (s.sla_met + s.sla_missed) = 0 then 100
      else round(
        (s.sla_met::numeric * 100.0)
        / nullif((s.sla_met + s.sla_missed)::numeric, 0)
      )::integer
    end as sla_rate
  from summary s
)
select jsonb_build_object(
  'summary', jsonb_build_object(
    'received', s.received,
    'responded', s.responded,
    'waiting', s.waiting,
    'avgFirstResponseSeconds', s.avg_first_response_seconds,
    'medianFirstResponseSeconds', s.median_first_response_seconds,
    'slaMet', s.sla_met,
    'slaMissed', s.sla_missed,
    'slaWaiting', s.sla_waiting,
    'slaRate', s.sla_rate,
    'resolved', s.resolved,
    'avgResolutionSeconds', s.avg_resolution_seconds
  ),
  'daily', d.value,
  'attention', a.value
)
from final_summary s
cross join daily d
cross join attention a;
$function$;
