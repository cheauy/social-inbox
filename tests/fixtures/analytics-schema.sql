-- Isolated tables only. No production configuration, data, or credentials.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.team_members(id uuid PRIMARY KEY,business_id uuid,user_id uuid,role text,is_active boolean,
  full_name text,email text,profile_picture_url text);
CREATE TABLE public.social_accounts(id uuid PRIMARY KEY,business_id uuid,platform text,account_name text);
CREATE TABLE public.contacts(id uuid PRIMARY KEY,business_id uuid,full_name text,profile_picture_url text,
  platform text,platform_user_id text,created_at timestamptz,last_contact_at timestamptz,
  UNIQUE(business_id,platform,platform_user_id));
CREATE TABLE public.conversations(id uuid PRIMARY KEY,business_id uuid,social_account_id uuid,platform text,
  source_type text,status text,assigned_to uuid,unread_count integer,contact_id uuid,created_at timestamptz,
  last_message_at timestamptz,status_updated_at timestamptz,updated_at timestamptz);
CREATE TABLE public.messages(id uuid PRIMARY KEY,business_id uuid,conversation_id uuid,direction text,
  created_at timestamptz,platform_created_at timestamptz,platform_message_id text,sent_by_member_id uuid,raw_payload jsonb,
  UNIQUE(business_id,platform_message_id));
CREATE TABLE public.conversation_activity(id uuid PRIMARY KEY,business_id uuid,conversation_id uuid,
  activity_type text,actor_member_id uuid,created_at timestamptz,metadata jsonb);
CREATE TABLE public.conversation_reminders(id uuid PRIMARY KEY,business_id uuid,conversation_id uuid,
  assigned_to uuid,remind_at timestamptz,status text);
CREATE TABLE public.tags(id uuid PRIMARY KEY,business_id uuid,name text,color text,is_active boolean);
CREATE TABLE public.contact_tags(tag_id uuid,contact_id uuid);
