-- Copy of the LIVE tenh_inbox_filter_matches and tenh_inbox_page definitions as
-- reported by the owner on 2026-10-05 (read-only query). Used only to test the
-- Telegram Personal patch on a scratch database.
CREATE OR REPLACE FUNCTION public.tenh_inbox_filter_matches(row_data jsonb, filters jsonb, workspace_context uuid)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(
    (COALESCE(filters->>'workspaceScope','all') = 'all'
      OR (filters->>'workspaceScope' = 'current' AND row_data->>'business_id' = workspace_context::text)
      OR (filters->>'workspaceScope' = 'selected' AND COALESCE(filters->'workspaceIds','[]'::jsonb) ? (row_data->>'business_id')))
    AND (COALESCE(filters->>'status','any') = 'any' OR filters->>'status' = row_data->>'status')
    AND (NOT COALESCE((filters->>'unreadOnly')::boolean,false) OR (row_data->>'unread_count')::integer > 0)
    AND (NOT COALESCE((filters->>'pinnedOnly')::boolean,false) OR COALESCE((row_data->>'is_pinned')::boolean,false))
    AND (COALESCE(filters->>'channel','any') = 'any' OR filters->>'channel' = row_data->>'channel')
    AND (COALESCE(filters->>'assignment','any') = 'any'
      OR (filters->>'assignment' = 'me' AND row_data->>'assigned_to' = row_data->>'member_id')
      OR (filters->>'assignment' = 'assigned' AND row_data->>'assigned_to' IS NOT NULL)
      OR (filters->>'assignment' = 'unassigned' AND row_data->>'assigned_to' IS NULL))
    AND (jsonb_array_length(COALESCE(filters->'tagIds','[]'::jsonb)) = 0 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(COALESCE(filters->'tagIds','[]'::jsonb)) ref,
        jsonb_array_elements(COALESCE(row_data->'tags','[]'::jsonb)) tag
      WHERE ref = tag->>'id'
        OR ref = (row_data->>'business_id') || '::' || (tag->>'id')
        OR ((filters->>'workspaceScope' = 'current'
              OR (filters->>'workspaceScope' = 'selected' AND jsonb_array_length(filters->'workspaceIds') = 1))
          AND strpos(ref,'::') = 0 AND lower(btrim(ref)) = lower(btrim(tag->>'name')))
    )), false);
$function$;

CREATE OR REPLACE FUNCTION public.tenh_inbox_page(p_user_id uuid, p_business_ids uuid[], p_request jsonb, p_views jsonb DEFAULT '[]'::jsonb, p_snapshot boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH membership AS MATERIALIZED (
  SELECT DISTINCT ON (business_id) id, business_id
  FROM team_members WHERE user_id = p_user_id AND is_active = true AND business_id = ANY(p_business_ids)
  ORDER BY business_id, created_at ASC, id ASC
), subscriptions AS (
  SELECT DISTINCT ON (business_id) business_id, status, current_period_end, trial_ends_at
  FROM business_subscriptions WHERE business_id = ANY(p_business_ids)
  ORDER BY business_id, created_at DESC NULLS LAST
), scope AS MATERIALIZED (
  SELECT m.* FROM membership m LEFT JOIN subscriptions s USING(business_id)
  WHERE s.business_id IS NULL OR (s.status::text IN ('active','trialing') AND
    (CASE WHEN s.status::text = 'trialing' THEN COALESCE(s.trial_ends_at,s.current_period_end)
          ELSE s.current_period_end END IS NULL OR
     CASE WHEN s.status::text = 'trialing' THEN COALESCE(s.trial_ends_at,s.current_period_end)
          ELSE s.current_period_end END > now()))
), settings AS (
  SELECT COALESCE(p_request->>'status','all') status, COALESCE(p_request->>'view','all') view,
    lower(regexp_replace(btrim(COALESCE(p_request->>'search','')),'^@','')) needle,
    NULLIF(p_request->>'workspaceContextId','')::uuid context_id,
    LEAST(30,GREATEST(1,COALESCE((p_request->>'size')::integer,30))) size
), base AS MATERIALIZED (
  SELECT c.id,c.business_id,c.status::text status,c.unread_count,c.is_pinned,c.last_message_at,c.updated_at,
    c.assigned_to,COALESCE(NULLIF(p_request->'memberIds'->>c.business_id::text,'')::uuid,m.id) member_id,
    CASE WHEN lower(btrim(COALESCE(c.source_type,''))) = 'comment' THEN 'comment'
         WHEN lower(btrim(COALESCE(c.source_type,''))) = 'telegram' OR a.platform = 'telegram' THEN 'telegram'
         ELSE 'messenger' END channel,
    COALESCE(tags.value,'[]'::jsonb) tags,
    (COALESCE(lower(btrim(ct.full_name)),'') || ' ' || COALESCE(lower(btrim(ct.phone)),'') || ' ' ||
      CASE WHEN a.platform = 'telegram' THEN regexp_replace(lower(btrim(COALESCE(
        to_jsonb(ct)->>'telegram_username',to_jsonb(ct)->>'platform_username',to_jsonb(ct)->>'username',ct.platform_user_id,''))),'^@','') ELSE '' END || ' ' || lower(btrim(COALESCE(c.last_message_text,'')))) search_text
  FROM conversations c JOIN scope m ON m.business_id = c.business_id
  JOIN social_accounts a ON a.id = c.social_account_id AND a.business_id = c.business_id
  LEFT JOIN contacts ct ON ct.id = c.contact_id AND ct.business_id = c.business_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.name)) value
    FROM contact_tags x JOIN tags t ON t.id = x.tag_id
    WHERE x.contact_id = c.contact_id AND t.business_id IN (SELECT business_id FROM scope)
  ) tags ON true
  WHERE a.is_active = true AND
    (CASE WHEN a.platform = 'telegram' THEN a.telegram_token_status = 'verified'
          WHEN a.platform = 'facebook' THEN a.facebook_token_status IS DISTINCT FROM 'disconnected' ELSE true END)
    AND (NULLIF(p_request->>'workspaceId','') IS NULL OR c.business_id = (p_request->>'workspaceId')::uuid)
    AND (NULLIF(p_request->>'channelId','') IS NULL OR c.social_account_id = (p_request->>'channelId')::uuid)
), status_base AS MATERIALIZED (
  SELECT b.* FROM base b,settings s WHERE s.status = 'all' OR b.status = s.status
), view_rows AS MATERIALIZED (
  SELECT b.* FROM status_base b,settings s
  WHERE CASE s.view
    WHEN 'all' THEN true WHEN 'unread' THEN b.unread_count > 0
    WHEN 'my' THEN b.assigned_to = b.member_id WHEN 'unassigned' THEN b.assigned_to IS NULL
    WHEN 'comment' THEN b.channel = 'comment' WHEN 'open' THEN b.status = 'open'
    WHEN 'pinned' THEN COALESCE(b.is_pinned,false)
    ELSE COALESCE((SELECT tenh_inbox_filter_matches(to_jsonb(b),v->'filters',s.context_id)
      FROM jsonb_array_elements(p_views) v WHERE 'saved:' || (v->>'id') = s.view LIMIT 1),true)
  END
), matched AS MATERIALIZED (
  SELECT b.* FROM view_rows b,settings s WHERE s.needle = '' OR strpos(b.search_text,s.needle) > 0
    OR (length(s.needle) >= 3 AND EXISTS (
      SELECT 1 FROM messages msg WHERE msg.conversation_id = b.id AND msg.business_id = b.business_id
      AND strpos(lower(COALESCE(msg.message_text,'')),s.needle) > 0
    ))
), after_cursor AS (
  SELECT b.* FROM matched b WHERE p_request->'cursor' IS NULL OR p_request->'cursor' = 'null'::jsonb OR
    (CASE WHEN COALESCE(b.is_pinned,false) THEN 1 ELSE 0 END,
     COALESCE(b.last_message_at,'-infinity'::timestamptz),b.id) <
    (CASE WHEN (p_request->'cursor'->>'pinned')::boolean THEN 1 ELSE 0 END,
     COALESCE(NULLIF(p_request->'cursor'->>'lastMessageAt','')::timestamptz,'-infinity'::timestamptz),
     (p_request->'cursor'->>'id')::uuid)
), page_plus AS MATERIALIZED (
  SELECT * FROM after_cursor ORDER BY COALESCE(is_pinned,false) DESC,last_message_at DESC NULLS LAST,id DESC
  LIMIT (SELECT size + 1 FROM settings)
), page AS MATERIALIZED (
  SELECT * FROM page_plus ORDER BY COALESCE(is_pinned,false) DESC,last_message_at DESC NULLS LAST,id DESC
  LIMIT (SELECT size FROM settings)
), counts AS (
 SELECT jsonb_build_object(
   'all',count(*),'unread',count(*) FILTER(WHERE unread_count > 0),
   'my',count(*) FILTER(WHERE assigned_to = member_id),'unassigned',count(*) FILTER(WHERE assigned_to IS NULL),
   'comment',count(*) FILTER(WHERE channel = 'comment'),'open',count(*) FILTER(WHERE status = 'open'),
   'pinned',count(*) FILTER(WHERE COALESCE(is_pinned,false))) value,
   COALESCE(sum(GREATEST(unread_count,0)),0) unread_messages FROM status_base
), saved_counts AS (
 SELECT COALESCE(jsonb_object_agg('saved:' || (v->>'id'),(
   SELECT count(*) FROM status_base b,settings s WHERE tenh_inbox_filter_matches(to_jsonb(b),v->'filters',s.context_id)
 )),'{}'::jsonb) value FROM jsonb_array_elements(p_views) v
), status_counts AS (
 SELECT jsonb_build_object('all',count(*),'open',count(*) FILTER(WHERE status = 'open'),
 'pending',count(*) FILTER(WHERE status = 'pending'),'resolved',count(*) FILTER(WHERE status = 'resolved'),
 'closed',count(*) FILTER(WHERE status = 'closed'),'spam',count(*) FILTER(WHERE status = 'spam')) value FROM base
)
SELECT jsonb_build_object(
 'ids',CASE WHEN p_snapshot THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(id ORDER BY COALESCE(is_pinned,false) DESC,last_message_at DESC NULLS LAST,id DESC) FROM page),'[]'::jsonb) END,
 'total',(SELECT count(*) FROM matched),
 'matchedKnownIds',COALESCE((SELECT jsonb_agg(id) FROM matched WHERE COALESCE(p_request->'knownIds','[]'::jsonb) ? id::text),'[]'::jsonb),
 'hasMore',(SELECT count(*) FROM page_plus) > (SELECT size FROM settings),
 'cursor',(SELECT jsonb_build_object('id',id,'pinned',COALESCE(is_pinned,false),'lastMessageAt',last_message_at)
   FROM page ORDER BY COALESCE(is_pinned,false) ASC,last_message_at ASC NULLS FIRST,id ASC LIMIT 1),
 'counts',jsonb_build_object('views',counts.value || saved_counts.value,'statusCounts',status_counts.value,
   'totalUnreadCount',counts.unread_messages,'unreadConversationCount',counts.value->'unread'),
 'readTargets',CASE WHEN p_snapshot THEN COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'id',id,'lastMessageAt',last_message_at,'updatedAt',updated_at,'unreadCount',unread_count))
   FROM matched WHERE unread_count > 0),'[]'::jsonb) ELSE '[]'::jsonb END
) FROM counts,saved_counts,status_counts;
$function$;
