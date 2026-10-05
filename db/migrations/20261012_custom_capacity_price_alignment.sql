-- REVIEW DRAFT ONLY. Align database pricing with the published app formula.
-- Existing recorded prices/payments are not rewritten.
begin;
create or replace function public.tenh_custom_monthly_cents(p_channel_limit integer, p_member_limit integer)
returns integer
language sql
immutable
set search_path to 'public'
as $function$
  select case when p_channel_limit between 3 and 30 and p_member_limit between 1 and 100
    then least(
      1300 + greatest(0,p_channel_limit-3)*400 + greatest(0,p_member_limit-1)*300,
      2500 + greatest(0,p_channel_limit-5)*400 + greatest(0,p_member_limit-3)*300,
      5900 + greatest(0,p_channel_limit-12)*400 + greatest(0,p_member_limit-8)*300
    ) else null end;
$function$;
-- Existing SECURITY INVOKER ownership and grants are preserved by replacement.
commit;
