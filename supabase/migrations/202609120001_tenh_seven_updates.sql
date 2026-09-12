-- Apply once before deploying TENH seven-updates. No existing messages are deleted.
BEGIN;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS facebook_profile_id text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS facebook_profile_url text;
CREATE TABLE IF NOT EXISTS public.facebook_customer_blocks (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  social_account_id uuid NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  page_id text NOT NULL,
  recipient_id text NOT NULL,
  is_blocked boolean NOT NULL DEFAULT false,
  updated_by_member_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
  updated_by_name text,
  provider_confirmed_at timestamptz,
  operation_id uuid,
  operation_started_at timestamptz,
  requested_blocked boolean,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, social_account_id, contact_id)
);
ALTER TABLE public.facebook_customer_blocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facebook_customer_blocks FROM anon, authenticated;
GRANT SELECT ON public.facebook_customer_blocks TO authenticated;
GRANT ALL ON public.facebook_customer_blocks TO service_role;
DROP POLICY IF EXISTS tenh_block_member_read ON public.facebook_customer_blocks;
CREATE POLICY tenh_block_member_read ON public.facebook_customer_blocks FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.business_id = facebook_customer_blocks.business_id AND tm.user_id = auth.uid() AND tm.is_active = true));
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') AND NOT EXISTS
    (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='facebook_customer_blocks')
  THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.facebook_customer_blocks; END IF;
END $$;
COMMIT;
