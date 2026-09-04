-- Customer insights for the Analytics page.
--
-- Change from the previous version: the per-customer conversation count in
-- `topCustomers` no longer counts Facebook comment threads, matching the
-- conversation report, agent performance and SLA analytics.
--
-- Almost everything else here is deliberately left alone, because this
-- function counts customers and messages rather than conversations:
--
--   * totalCustomers, newCustomers, activeCustomers, returningCustomers,
--     inactive30Days, dailyGrowth, tags — contact counts. Someone who only
--     ever left a comment is still a real customer, and dropping them would
--     understate the customer base.
--   * openCustomers — customers with an open or pending thread. A customer
--     waiting on an unanswered comment genuinely needs attention, so they
--     stay counted.
--   * messagesInPeriod, incomingMessages, outgoingMessages — message counts.
--   * channels — already split by source_type, and the only place comment
--     volume is reported here.

CREATE OR REPLACE FUNCTION public.get_tenh_customer_insights(
  p_business_id uuid,
  p_start timestamp with time zone,
  p_end timestamp with time zone,
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
