-- Conversation reports for the Analytics page.
--
-- Change from the previous version: Facebook comment threads no longer count
-- as conversations. Every conversation-level figure (received, resolved,
-- resolution rate, status counts, busy hours, daily series, waiting-over-SLA)
-- now reads `messenger_details` instead of `received_details`.
--
-- Two things are deliberately NOT filtered:
--   * `channel_counts` still reads the full set, so the Channels breakdown
--     keeps showing comment volume beside Messenger. That split already
--     existed and is the only place comment traffic is now visible.
--   * The message totals (incoming/outgoing/total) still count every message,
--     comments included. They are message metrics, not conversation metrics.
--
-- "Received" means a conversation with at least one incoming message inside
-- the window, not a conversation created in it.

CREATE OR REPLACE FUNCTION public.get_tenh_conversation_reports(
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

-- Conversations only. A Facebook comment thread is customer contact but it is
-- not a conversation for reporting purposes, so everything below counts from
-- here. source_type is null on older rows, which are Messenger.
messenger_details as (
  select *
  from received_details
  where coalesce(source_type, 'messenger') <> 'comment'
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
  from messenger_details r
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
  from messenger_details rd
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
  from messenger_details rd
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

-- Reads the unfiltered set on purpose: this is the one place comment volume
-- is still reported, beside Messenger.
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
  from messenger_details r
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
  from messenger_details r
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
    (select count(*)::integer from messenger_details)
      as received_conversations,

    (select count(*)::integer from resolved_received)
      as resolved_conversations,

    (
      select count(*)::integer
      from messenger_details
      where status = 'open'
    ) as current_open,

    (
      select count(*)::integer
      from messenger_details
      where status = 'pending'
    ) as current_pending,

    (
      select count(*)::integer
      from messenger_details
      where status = 'resolved'
    ) as current_resolved,

    (
      select count(*)::integer
      from messenger_details
      where status = 'closed'
    ) as current_closed,

    (
      select count(*)::integer
      from messenger_details
      where status = 'spam'
    ) as current_spam,

    (
      select count(*)::integer
      from messenger_details
      where coalesce(unread_count, 0) > 0
    ) as current_unread,

    (
      select count(*)::integer
      from messenger_details
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
