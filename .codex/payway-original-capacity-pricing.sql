CREATE OR REPLACE FUNCTION public.tenh_custom_monthly_cents(p_channel_limit integer, p_member_limit integer)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  v_standard integer;
  v_team integer;
  v_pro integer;
begin
  if p_channel_limit is null or p_member_limit is null
     or p_channel_limit < 3 or p_channel_limit > 30
     or p_member_limit < 1 or p_member_limit > 100 then
    return null;
  end if;

  -- Standard anchor: $13 includes 3 connections + 1 user.
  v_standard := 1300
    + greatest(0, p_channel_limit - 3) * 400
    + greatest(0, p_member_limit - 1) * 300;

  -- Team anchor is eligible only when the requested capacity includes at least
  -- the Team package capacity. This makes Custom 5/3 exactly $25/month.
  v_team := null;
  if p_channel_limit >= 5 and p_member_limit >= 3 then
    v_team := 2500
      + (p_channel_limit - 5) * 400
      + (p_member_limit - 3) * 300;
  end if;

  -- Pro anchor is eligible only when the requested capacity includes at least
  -- the Pro package capacity. This makes Custom 12/8 exactly $59/month.
  v_pro := null;
  if p_channel_limit >= 12 and p_member_limit >= 8 then
    v_pro := 5900
      + (p_channel_limit - 12) * 400
      + (p_member_limit - 8) * 300;
  end if;

  return least(
    v_standard,
    coalesce(v_team, v_standard),
    coalesce(v_pro, v_standard)
  );
end;
$function$

