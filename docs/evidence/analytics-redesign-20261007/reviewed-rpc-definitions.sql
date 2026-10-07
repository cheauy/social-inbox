-- Read-only pg_proc / pg_get_functiondef snapshot, 2026-10-07.
-- No SQL executed from this file. This is audit evidence, not a migration.

CREATE OR REPLACE FUNCTION public.get_tenh_agent_performance(p_business_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_sla_seconds integer DEFAULT 600)
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


CREATE OR REPLACE FUNCTION public.get_tenh_conversation_reports(p_business_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_sla_seconds integer DEFAULT 600, p_tz_offset_minutes integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with
params as (
  select
    p_start as start_at,
    p_end as end_at,
    greatest(p_sla_seconds, 60)::numeric as sla_seconds,
    greatest(
      least(p_tz_offset_minutes, 840),
      -840
    )::integer as tz_offset_minutes
),

period_messages as (
  select
    m.id,
    m.conversation_id,
    m.direction,
    coalesce(
      m.platform_created_at,
      m.created_at
    ) as message_at
  from public.messages m
  join public.conversations c
    on c.id = m.conversation_id
   and c.business_id = p_business_id
  cross join params p
  where
    m.business_id = p_business_id
    and coalesce(
      m.platform_created_at,
      m.created_at
    ) >= p.start_at
    and coalesce(
      m.platform_created_at,
      m.created_at
    ) < p.end_at
),

received as (
  select
    pm.conversation_id,
    min(pm.message_at) filter (
      where pm.direction = 'incoming'
    ) as first_incoming_at,
    max(pm.message_at) filter (
      where pm.direction = 'incoming'
    ) as latest_incoming_at,
    count(*) filter (
      where pm.direction = 'incoming'
    )::integer as incoming_messages
  from period_messages pm
  group by pm.conversation_id
  having count(*) filter (
    where pm.direction = 'incoming'
  ) > 0
),

received_details as (
  select
    r.conversation_id,
    r.first_incoming_at,
    r.latest_incoming_at,
    r.incoming_messages,
    c.status,
    c.unread_count,
    c.assigned_to,
    c.source_type,
    c.contact_id,
    c.last_message_at,
    coalesce(
      nullif(btrim(ct.full_name), ''),
      'Facebook customer'
    ) as customer_name,
    ct.profile_picture_url,
    tm.full_name as assigned_member_name
  from received r
  join public.conversations c
    on c.id = r.conversation_id
   and c.business_id = p_business_id
  left join public.contacts ct
    on ct.id = c.contact_id
   and ct.business_id = p_business_id
  left join public.team_members tm
    on tm.id = c.assigned_to
   and tm.business_id = p_business_id
),

resolution_events as (
  select
    ca.conversation_id,
    min(ca.created_at) as resolved_at
  from public.conversation_activity ca
  join received r
    on r.conversation_id = ca.conversation_id
  cross join params p
  where
    ca.business_id = p_business_id
    and ca.activity_type = 'status_changed'
    and ca.created_at >= r.first_incoming_at
    and ca.created_at < p.end_at
    and lower(
      coalesce(
        ca.metadata ->> 'newStatus',
        ca.metadata ->> 'new_status',
        ''
      )
    ) in ('resolved', 'closed')
  group by ca.conversation_id
),

resolved_received as (
  select
    r.conversation_id,
    re.resolved_at
  from received r
  join resolution_events re
    on re.conversation_id = r.conversation_id
),

latest_outgoing_after_incoming as (
  select
    r.conversation_id,
    min(pm.message_at) as reply_at
  from received r
  join period_messages pm
    on pm.conversation_id = r.conversation_id
   and pm.direction = 'outgoing'
   and pm.message_at >= r.latest_incoming_at
  group by r.conversation_id
),

waiting_candidates as (
  select
    rd.conversation_id,
    rd.customer_name,
    rd.profile_picture_url,
    rd.assigned_member_name,
    rd.latest_incoming_at,
    rd.status,
    rd.unread_count,
    extract(
      epoch from (
        p.end_at -
        rd.latest_incoming_at
      )
    )::numeric as waiting_seconds
  from received_details rd
  cross join params p
  left join latest_outgoing_after_incoming lo
    on lo.conversation_id = rd.conversation_id
  where
    rd.latest_incoming_at is not null
    and lo.reply_at is null
    and rd.status in ('open', 'pending')
    and extract(
      epoch from (
        p.end_at -
        rd.latest_incoming_at
      )
    ) > p.sla_seconds
),

waiting_json as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'conversationId', w.conversation_id,
        'customerName', w.customer_name,
        'profilePictureUrl', w.profile_picture_url,
        'assignedMemberName', w.assigned_member_name,
        'latestIncomingAt', w.latest_incoming_at,
        'status', w.status,
        'unreadCount', coalesce(w.unread_count, 0),
        'waitingSeconds', round(w.waiting_seconds)::integer
      )
      order by
        w.waiting_seconds desc,
        w.latest_incoming_at asc
    ),
    '[]'::jsonb
  ) as value
  from (
    select *
    from waiting_candidates
    order by waiting_seconds desc
    limit 8
  ) w
),

status_counts as (
  select
    rd.status,
    count(*)::integer as conversation_count
  from received_details rd
  group by rd.status
),

status_json as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'status', s.status,
        'conversations', s.conversation_count
      )
      order by
        case s.status
          when 'open' then 1
          when 'pending' then 2
          when 'resolved' then 3
          when 'closed' then 4
          when 'spam' then 5
          else 99
        end,
        s.status
    ),
    '[]'::jsonb
  ) as value
  from status_counts s
),

channel_counts as (
  select
    case
      when rd.source_type = 'comment'
        then 'comment'
      else 'messenger'
    end as channel,
    count(*)::integer as conversations,
    sum(rd.incoming_messages)::integer as incoming_messages
  from received_details rd
  group by 1
),

channel_json as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'channel', c.channel,
        'conversations', c.conversations,
        'incomingMessages', c.incoming_messages
      )
      order by c.conversations desc
    ),
    '[]'::jsonb
  ) as value
  from channel_counts c
),

busy_hour_counts as (
  select
    extract(
      hour from (
        r.first_incoming_at
        - make_interval(
            mins => p.tz_offset_minutes
          )
      )
    )::integer as local_hour,
    count(*)::integer as conversations
  from received r
  cross join params p
  group by 1
),

busy_hours_json as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'hour', b.local_hour,
        'conversations', b.conversations
      )
      order by
        b.conversations desc,
        b.local_hour asc
    ),
    '[]'::jsonb
  ) as value
  from (
    select *
    from busy_hour_counts
    order by conversations desc, local_hour asc
    limit 6
  ) b
),

daily_received as (
  select
    (
      r.first_incoming_at
      - make_interval(
          mins => p.tz_offset_minutes
        )
    )::date as local_day,
    count(*)::integer as conversations
  from received r
  cross join params p
  group by 1
),

daily_resolved as (
  select
    (
      rr.resolved_at
      - make_interval(
          mins => p.tz_offset_minutes
        )
    )::date as local_day,
    count(*)::integer as conversations
  from resolved_received rr
  cross join params p
  group by 1
),

daily_combined as (
  select
    coalesce(
      dr.local_day,
      ds.local_day
    ) as local_day,
    coalesce(
      dr.conversations,
      0
    )::integer as received,
    coalesce(
      ds.conversations,
      0
    )::integer as resolved
  from daily_received dr
  full join daily_resolved ds
    on ds.local_day = dr.local_day
),

daily_json as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date',
        to_char(
          d.local_day,
          'YYYY-MM-DD'
        ),
        'received',
        d.received,
        'resolved',
        d.resolved
      )
      order by d.local_day
    ),
    '[]'::jsonb
  ) as value
  from daily_combined d
),

summary as (
  select
    (select count(*)::integer from received)
      as received_conversations,

    (select count(*)::integer from resolved_received)
      as resolved_conversations,

    (
      select count(*)::integer
      from received_details
      where status = 'open'
    ) as current_open,

    (
      select count(*)::integer
      from received_details
      where status = 'pending'
    ) as current_pending,

    (
      select count(*)::integer
      from received_details
      where status = 'resolved'
    ) as current_resolved,

    (
      select count(*)::integer
      from received_details
      where status = 'closed'
    ) as current_closed,

    (
      select count(*)::integer
      from received_details
      where status = 'spam'
    ) as current_spam,

    (
      select count(*)::integer
      from received_details
      where coalesce(unread_count, 0) > 0
    ) as current_unread,

    (
      select count(*)::integer
      from received_details
      where assigned_to is null
    ) as current_unassigned,

    (
      select count(*)::integer
      from waiting_candidates
    ) as waiting_over_sla,

    (
      select count(*)::integer
      from period_messages
      where direction = 'incoming'
    ) as incoming_messages,

    (
      select count(*)::integer
      from period_messages
      where direction = 'outgoing'
    ) as outgoing_messages,

    (
      select count(*)::integer
      from period_messages
    ) as total_messages
)

select jsonb_build_object(
  'summary',
  jsonb_build_object(
    'receivedConversations',
      s.received_conversations,
    'resolvedConversations',
      s.resolved_conversations,
    'resolutionRate',
      case
        when s.received_conversations = 0
          then null
        else round(
          least(
            s.resolved_conversations,
            s.received_conversations
          )::numeric
          * 100.0
          / s.received_conversations::numeric
        )::integer
      end,
    'currentOpen',
      s.current_open,
    'currentPending',
      s.current_pending,
    'currentResolved',
      s.current_resolved,
    'currentClosed',
      s.current_closed,
    'currentSpam',
      s.current_spam,
    'currentUnread',
      s.current_unread,
    'currentUnassigned',
      s.current_unassigned,
    'waitingOverSla',
      s.waiting_over_sla,
    'incomingMessages',
      s.incoming_messages,
    'outgoingMessages',
      s.outgoing_messages,
    'totalMessages',
      s.total_messages
  ),
  'statuses',
    sj.value,
  'channels',
    cj.value,
  'busyHours',
    bh.value,
  'daily',
    dj.value,
  'waitingConversations',
    wj.value
)
from summary s
cross join status_json sj
cross join channel_json cj
cross join busy_hours_json bh
cross join daily_json dj
cross join waiting_json wj;
$function$;


CREATE OR REPLACE FUNCTION public.get_tenh_customer_insights(p_business_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_tz_offset_minutes integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with
params as (
  select
    p_start as start_at,
    p_end as end_at,
    p_end - interval '30 days' as inactive_30_cutoff,
    greatest(least(p_tz_offset_minutes, 840), -840) as tz_offset_minutes
),

contacts_base as (
  select
    c.id,
    c.full_name,
    c.profile_picture_url,
    c.platform,
    c.platform_user_id,
    c.created_at,
    c.last_contact_at
  from public.contacts c
  where c.business_id = p_business_id
),

period_messages as (
  select
    m.id,
    m.conversation_id,
    c.contact_id,
    c.source_type,
    m.direction,
    coalesce(m.platform_created_at, m.created_at) as message_at
  from public.messages m
  join public.conversations c
    on c.id = m.conversation_id
   and c.business_id = p_business_id
  cross join params p
  where
    m.business_id = p_business_id
    and c.contact_id is not null
    and coalesce(m.platform_created_at, m.created_at) >= p.start_at
    and coalesce(m.platform_created_at, m.created_at) < p.end_at
),

activity_by_contact as (
  select
    pm.contact_id,
    count(*)::integer as message_count,
    count(*) filter (where pm.direction = 'incoming')::integer as incoming_messages,
    count(*) filter (where pm.direction = 'outgoing')::integer as outgoing_messages,
    -- Conversation count only: comment threads excluded. The message counts
    -- above still include them, so a customer who only comments still shows
    -- their real message volume.
    count(distinct pm.conversation_id) filter (
      where coalesce(pm.source_type, 'messenger') <> 'comment'
    )::integer as conversation_count,
    max(pm.message_at) as last_activity_at
  from period_messages pm
  group by pm.contact_id
),

active_contacts as (
  select distinct contact_id
  from period_messages
),

new_contacts as (
  select cb.id
  from contacts_base cb
  cross join params p
  where
    cb.created_at >= p.start_at
    and cb.created_at < p.end_at
),

returning_contacts as (
  select ac.contact_id
  from active_contacts ac
  join contacts_base cb
    on cb.id = ac.contact_id
  cross join params p
  where cb.created_at < p.start_at
    and exists (
      select 1
      from period_messages pm
      where pm.contact_id = ac.contact_id
        and pm.direction = 'incoming'
    )
),

open_customer_conversations as (
  select distinct c.contact_id
  from public.conversations c
  where
    c.business_id = p_business_id
    and c.contact_id is not null
    and c.status in ('open', 'pending')
),

daily_growth as (
  select
    (
      cb.created_at
      - make_interval(mins => p.tz_offset_minutes)
    )::date as local_day,
    count(*)::integer as new_customers
  from contacts_base cb
  cross join params p
  where
    cb.created_at >= p.start_at
    and cb.created_at < p.end_at
  group by 1
),

daily_json as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', to_char(d.local_day, 'YYYY-MM-DD'),
        'newCustomers', d.new_customers
      )
      order by d.local_day
    ),
    '[]'::jsonb
  ) as value
  from daily_growth d
),

top_customers as (
  select
    cb.id as contact_id,
    coalesce(nullif(btrim(cb.full_name), ''), 'Facebook customer') as full_name,
    cb.profile_picture_url,
    a.message_count,
    a.incoming_messages,
    a.outgoing_messages,
    a.conversation_count,
    a.last_activity_at
  from activity_by_contact a
  join contacts_base cb
    on cb.id = a.contact_id
  order by
    a.message_count desc,
    a.last_activity_at desc nulls last
  limit 10
),

top_customers_json as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'contactId', t.contact_id,
        'fullName', t.full_name,
        'profilePictureUrl', t.profile_picture_url,
        'messages', t.message_count,
        'incomingMessages', t.incoming_messages,
        'outgoingMessages', t.outgoing_messages,
        'conversations', t.conversation_count,
        'lastActivityAt', t.last_activity_at
      )
      order by
        t.message_count desc,
        t.last_activity_at desc nulls last
    ),
    '[]'::jsonb
  ) as value
  from top_customers t
),

tag_counts as (
  select
    t.id as tag_id,
    t.name,
    t.color,
    count(distinct ct.contact_id)::integer as customer_count
  from public.tags t
  left join public.contact_tags ct
    on ct.tag_id = t.id
  where
    t.business_id = p_business_id
    and t.is_active = true
  group by t.id, t.name, t.color
  having count(distinct ct.contact_id) > 0
  order by customer_count desc, t.name asc
  limit 12
),

tags_json as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'tagId', tc.tag_id,
        'name', tc.name,
        'color', tc.color,
        'customers', tc.customer_count
      )
      order by tc.customer_count desc, tc.name asc
    ),
    '[]'::jsonb
  ) as value
  from tag_counts tc
),

-- Reads the unfiltered set on purpose: this is where comment volume is
-- reported beside Messenger.
channel_counts as (
  select
    case
      when pm.source_type = 'comment' then 'comment'
      else 'messenger'
    end as channel,
    count(*)::integer as messages,
    count(distinct pm.contact_id)::integer as customers,
    count(distinct pm.conversation_id)::integer as conversations
  from period_messages pm
  group by 1
),

channels_json as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'channel', cc.channel,
        'messages', cc.messages,
        'customers', cc.customers,
        'conversations', cc.conversations
      )
      order by cc.messages desc
    ),
    '[]'::jsonb
  ) as value
  from channel_counts cc
),

summary as (
  select
    (select count(*)::integer from contacts_base) as total_customers,
    (select count(*)::integer from new_contacts) as new_customers,
    (select count(*)::integer from active_contacts) as active_customers,
    (select count(*)::integer from returning_contacts) as returning_customers,
    (
      select count(*)::integer
      from contacts_base cb
      cross join params p
      where
        coalesce(cb.last_contact_at, cb.created_at)
          < p.inactive_30_cutoff
    ) as inactive_30_days,
    (select count(*)::integer from open_customer_conversations) as open_customers,
    (select count(*)::integer from period_messages) as messages_in_period,
    (
      select count(*)::integer
      from period_messages
      where direction = 'incoming'
    ) as incoming_messages,
    (
      select count(*)::integer
      from period_messages
      where direction = 'outgoing'
    ) as outgoing_messages
)

select jsonb_build_object(
  'summary',
  jsonb_build_object(
    'totalCustomers', s.total_customers,
    'newCustomers', s.new_customers,
    'activeCustomers', s.active_customers,
    'returningCustomers', s.returning_customers,
    'inactive30Days', s.inactive_30_days,
    'openCustomers', s.open_customers,
    'messagesInPeriod', s.messages_in_period,
    'incomingMessages', s.incoming_messages,
    'outgoingMessages', s.outgoing_messages
  ),
  'dailyGrowth', dj.value,
  'topCustomers', tj.value,
  'tags', tags.value,
  'channels', ch.value
)
from summary s
cross join daily_json dj
cross join top_customers_json tj
cross join tags_json tags
cross join channels_json ch;
$function$;


CREATE OR REPLACE FUNCTION public.get_tenh_sla_analytics(p_business_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_sla_seconds integer DEFAULT 600, p_tz_offset_minutes integer DEFAULT 0)
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
