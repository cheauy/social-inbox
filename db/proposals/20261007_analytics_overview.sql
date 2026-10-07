-- APPROVED LOCAL PROPOSAL ONLY. Do not apply automatically or to production.
-- Additive: existing report RPC signatures and native mobile remain unchanged.
-- Human response is a verified same-business member attribution, excluding
-- known automation. Unknown outgoing messages make earlier human timing unknown.
-- Required existing indexes are recorded in the read-only audit catalog.
CREATE OR REPLACE FUNCTION public.get_tenh_analytics_overview(
  p_business_id uuid, p_member_id uuid, p_user_id uuid,
  p_start timestamptz, p_end timestamptz, p_snapshot_at timestamptz,
  p_sla_seconds integer DEFAULT 600, p_timezone text DEFAULT 'UTC'
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.team_members WHERE id=p_member_id
    AND business_id=p_business_id AND user_id=p_user_id AND is_active=true) THEN
    RAISE EXCEPTION 'analytics_scope_denied' USING ERRCODE='42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_snapshot_at IS NULL
    OR p_end < p_start OR p_end-p_start > interval '367 days'
    OR p_end > p_snapshot_at OR p_sla_seconds IS NULL OR p_sla_seconds NOT BETWEEN 60 AND 86400
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_timezone) THEN
    RAISE EXCEPTION 'analytics_range_invalid' USING ERRCODE='22023';
  END IF;
  RETURN (
    WITH scope AS MATERIALIZED (
      SELECT c.id,c.contact_id,c.status,c.assigned_to,c.unread_count,
        CASE WHEN c.platform='facebook' AND c.source_type='comment' THEN 'comment'
        WHEN c.platform='facebook' AND coalesce(c.source_type,'messenger')<>'comment' THEN 'messenger'
        WHEN c.platform='telegram' THEN 'telegram' END channel
      FROM public.conversations c
      JOIN public.social_accounts sa ON sa.id=c.social_account_id AND sa.business_id=p_business_id
      WHERE c.business_id=p_business_id AND c.status<>'spam'
        AND c.platform IN ('facebook','telegram') AND sa.platform=c.platform
      -- Telegram Personal and all other channels are excluded BEFORE aggregation.
      -- Shared Facebook/Telegram channels have no per-channel restriction in the
      -- current permission model. Do not broaden this allowlist for Personal.
    ),
    period_messages AS MATERIALIZED (
      SELECT m.id,m.conversation_id,m.direction,coalesce(m.platform_created_at,m.created_at) at,
        m.sent_by_member_id,
        CASE WHEN m.direction<>'outgoing' THEN NULL
          WHEN m.raw_payload ? 'auto_reply_job_id' OR m.raw_payload ? 'tenh_bot_job_id'
            OR m.raw_payload->>'source' IN ('tenh_bot','facebook_auto_private_reply') THEN 'bot'
          WHEN EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.id=m.sent_by_member_id
            AND tm.business_id=p_business_id) THEN 'human' ELSE 'unknown' END author,
        s.channel,s.contact_id
      FROM public.messages m JOIN scope s ON s.id=m.conversation_id
      WHERE m.business_id=p_business_id
        AND coalesce(m.platform_created_at,m.created_at)>=p_start
        AND coalesce(m.platform_created_at,m.created_at)<p_end
    ),
    received AS MATERIALIZED (
      SELECT conversation_id,channel,min(at) first_incoming_at
      FROM period_messages WHERE direction='incoming' GROUP BY conversation_id,channel
    ),
    response_times AS (
      SELECT r.*,min(pm.at) FILTER (WHERE pm.author='human' AND pm.at>=r.first_incoming_at) human_at,
        min(pm.at) FILTER (WHERE pm.author='unknown' AND pm.at>=r.first_incoming_at) unknown_at
      FROM received r LEFT JOIN period_messages pm USING(conversation_id)
      WHERE r.channel<>'comment' GROUP BY r.conversation_id,r.channel,r.first_incoming_at
    ),
    responses AS MATERIALIZED (
      SELECT *,unknown_at IS NULL OR (human_at IS NOT NULL AND unknown_at>human_at) evaluable,
        extract(epoch FROM human_at-first_incoming_at) response_seconds
      FROM response_times
    ),
    resolution_events AS MATERIALIZED (
      SELECT r.conversation_id,min(ca.created_at) resolved_at
      FROM received r JOIN public.conversation_activity ca USING(conversation_id)
      WHERE r.channel<>'comment' AND ca.business_id=p_business_id AND ca.activity_type='status_changed'
        AND ca.created_at>=r.first_incoming_at AND ca.created_at<p_end
        AND lower(coalesce(ca.metadata->>'newStatus',ca.metadata->>'new_status','')) IN ('resolved','closed')
      GROUP BY r.conversation_id
    ),
    current_threads AS MATERIALIZED (
      SELECT * FROM scope WHERE status IN ('open','pending')
    ),
    current_cycles AS MATERIALIZED (
      SELECT c.id,c.channel,ask.at first_waiting_at,
        EXISTS (SELECT 1 FROM public.messages m WHERE m.business_id=p_business_id AND m.conversation_id=c.id
          AND m.direction='outgoing' AND coalesce(m.platform_created_at,m.created_at)>=ask.at
          AND coalesce(m.platform_created_at,m.created_at)<p_snapshot_at
          AND NOT (coalesce(m.raw_payload,'{}'::jsonb) ? 'auto_reply_job_id')
          AND NOT (coalesce(m.raw_payload,'{}'::jsonb) ? 'tenh_bot_job_id')
          AND coalesce(m.raw_payload->>'source','') NOT IN ('tenh_bot','facebook_auto_private_reply')
          AND NOT EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.id=m.sent_by_member_id
            AND tm.business_id=p_business_id)) unknown_reply
      FROM current_threads c
      LEFT JOIN LATERAL (
        SELECT max(coalesce(m.platform_created_at,m.created_at)) at
        FROM public.messages m WHERE m.business_id=p_business_id AND m.conversation_id=c.id
          AND m.direction='outgoing' AND coalesce(m.platform_created_at,m.created_at)<p_snapshot_at
          AND NOT (coalesce(m.raw_payload,'{}'::jsonb) ? 'auto_reply_job_id')
          AND NOT (coalesce(m.raw_payload,'{}'::jsonb) ? 'tenh_bot_job_id')
          AND coalesce(m.raw_payload->>'source','') NOT IN ('tenh_bot','facebook_auto_private_reply')
          AND EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.id=m.sent_by_member_id
            AND tm.business_id=p_business_id)
      ) last_human ON true
      LEFT JOIN LATERAL (
        SELECT max(ca.created_at) at FROM public.conversation_activity ca
        WHERE ca.business_id=p_business_id AND ca.conversation_id=c.id AND ca.activity_type='status_changed'
          AND ca.created_at<p_snapshot_at
          AND coalesce(ca.metadata->>'oldStatus',ca.metadata->>'old_status','') IN ('resolved','closed')
          AND coalesce(ca.metadata->>'newStatus',ca.metadata->>'new_status','') IN ('open','pending')
      ) reopened ON true
      LEFT JOIN LATERAL (
        SELECT min(coalesce(m.platform_created_at,m.created_at)) at FROM public.messages m
        WHERE m.business_id=p_business_id AND m.conversation_id=c.id AND m.direction='incoming'
          AND coalesce(m.platform_created_at,m.created_at)<p_snapshot_at
          AND coalesce(m.platform_created_at,m.created_at)>coalesce(last_human.at,'-infinity'::timestamptz)
          AND coalesce(m.platform_created_at,m.created_at)>=coalesce(reopened.at,'-infinity'::timestamptz)
      ) ask ON true
    ),
    current_summary AS (
      SELECT jsonb_build_object(
        'unassigned',(SELECT count(*) FROM current_threads WHERE assigned_to IS NULL),
        'unread',(SELECT count(*) FROM current_threads WHERE coalesce(unread_count,0)>0),
        'waitingOverSla',(SELECT count(*) FROM current_cycles WHERE first_waiting_at IS NOT NULL
          AND NOT unknown_reply AND extract(epoch FROM p_snapshot_at-first_waiting_at)>p_sla_seconds),
        'unknownWaiting',(SELECT count(*) FROM current_cycles WHERE first_waiting_at IS NOT NULL AND unknown_reply),
        'overdue',(SELECT count(*) FROM public.conversation_reminders cr JOIN scope s ON s.id=cr.conversation_id
          WHERE cr.business_id=p_business_id AND cr.status='open' AND cr.remind_at<p_snapshot_at)
      ) value
    ),
    response_summary AS (
      SELECT count(*) received,count(*) FILTER (WHERE evaluable AND human_at IS NOT NULL) first_responses,
        count(*) FILTER (WHERE evaluable) evaluable_count,
        count(*) FILTER (WHERE NOT evaluable) unknown_count,
        count(*) FILTER (WHERE evaluable AND human_at IS NOT NULL AND response_seconds<=p_sla_seconds) met,
        count(*) FILTER (WHERE evaluable AND ((human_at IS NOT NULL AND response_seconds>p_sla_seconds)
          OR (human_at IS NULL AND extract(epoch FROM p_end-first_incoming_at)>p_sla_seconds))) missed,
        round(avg(response_seconds) FILTER (WHERE evaluable AND human_at IS NOT NULL)) avg_seconds
      FROM responses
    ),
    daily_activity AS (
      SELECT timezone(p_timezone,first_incoming_at)::date AS local_day,count(*) received,0::bigint resolved
        FROM received WHERE channel<>'comment' GROUP BY 1
      UNION ALL
      SELECT timezone(p_timezone,resolved_at)::date AS local_day,0::bigint received,count(*) resolved
        FROM resolution_events GROUP BY 1
    ),
    daily AS (
      SELECT local_day,sum(received) received,sum(resolved) resolved FROM daily_activity GROUP BY local_day
    ),
    contact_scope AS (
      SELECT ct.id,ct.created_at FROM public.contacts ct
        WHERE ct.business_id=p_business_id AND ct.platform IN ('facebook','telegram')
    ),
    active_contacts AS (
      SELECT cs.id,cs.created_at,bool_or(pm.direction='incoming') has_incoming
      FROM contact_scope cs JOIN period_messages pm ON pm.contact_id=cs.id GROUP BY cs.id,cs.created_at
    ),
    channels AS (
      SELECT kinds.channel,count(r.conversation_id) value FROM (VALUES ('messenger'),('comment'),('telegram')) kinds(channel)
        LEFT JOIN received r USING(channel) GROUP BY kinds.channel
    ),
    hours AS (
      SELECT h.hour,count(pm.id) value FROM generate_series(0,23) h(hour)
      LEFT JOIN period_messages pm ON pm.direction='incoming'
        AND extract(hour FROM timezone(p_timezone,pm.at))=h.hour GROUP BY h.hour
    )
    SELECT jsonb_build_object(
      'definitionVersion','human-overview-v1','scope',jsonb_build_array('messenger','comment','telegram'),
      'current',(SELECT value FROM current_summary),
      'period',jsonb_build_object('conversations',rs.received,
        'commentThreads',(SELECT count(*) FROM received WHERE channel='comment'),
        'resolved',(SELECT count(*) FROM resolution_events),'firstResponses',rs.first_responses,
        'avgFirstResponseSeconds',rs.avg_seconds,'slaMet',rs.met,'slaMissed',rs.missed,
        'slaDenominator',rs.met+rs.missed,
        'slaRate',CASE WHEN rs.met+rs.missed=0 THEN NULL ELSE round(100.0*rs.met/(rs.met+rs.missed)) END,
        'humanEvaluableConversations',rs.evaluable_count,'unknownHumanConversations',rs.unknown_count),
      'messages',jsonb_build_object(
        'incoming',(SELECT count(*) FROM period_messages WHERE direction='incoming'),
        'outgoing',(SELECT count(*) FROM period_messages WHERE direction='outgoing'),
        'humanOutgoing',(SELECT count(*) FROM period_messages WHERE author='human'),
        'botOutgoing',(SELECT count(*) FROM period_messages WHERE author='bot'),
        'unknownOutgoing',(SELECT count(*) FROM period_messages WHERE author='unknown')),
      'customers',jsonb_build_object('active',(SELECT count(*) FROM active_contacts),
        'new',(SELECT count(*) FROM contact_scope WHERE created_at>=p_start AND created_at<p_end),
        'returning',(SELECT count(*) FROM active_contacts WHERE created_at<p_start AND has_incoming)),
      'daily',coalesce((SELECT jsonb_agg(jsonb_build_object('date',local_day,'received',received,'resolved',resolved) ORDER BY local_day) FROM daily),'[]'::jsonb),
      'channels',(SELECT jsonb_agg(jsonb_build_object('channel',channel,'value',value) ORDER BY channel) FROM channels),
      'hours',(SELECT jsonb_agg(jsonb_build_object('hour',hour,'value',value) ORDER BY hour) FROM hours)
    ) FROM response_summary rs
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_tenh_analytics_overview(uuid,uuid,uuid,timestamptz,timestamptz,timestamptz,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenh_analytics_overview(uuid,uuid,uuid,timestamptz,timestamptz,timestamptz,integer,text) TO service_role;
