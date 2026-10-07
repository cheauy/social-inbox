# Dashboard period selector and unavailable-data follow-up — October 7, 2026

The overview timezone selector has been replaced with **3 months, 6 months and 1 year**. Existing Today/Yesterday/7-day/30-day buttons remain. The dropdown says “Longer period” until a longer range is selected; it does not falsely imply a three-month selection while Today is active. The chosen timezone remains in the query and the hourly chart label. The removed “Metric definitions & report differences” disclosure stays removed.

Long periods start at midnight in the defined timezone on the corresponding calendar date 3/6/12 months earlier and end at the server snapshot. Month ends clamp to the last day of the target month: August31 minus6 months becomes February28; February29 minus1 year becomes February28. These are calendar ranges, not aliases for90/180/365 fixed days. `[start,end)` event boundaries and independently evaluated current queue snapshots are unchanged.

The shared range parser now accepts these values for detailed report drilldowns, retaining exact UTC bounds. Response period identity, range label and day-span metadata reflect the selected range. Original detailed report formulas remain unchanged. The SQL proposal's maximum window is367 days and the aggregate validator allows up to368 daily date buckets; queries remain date-bounded and return one aggregate, with no added polling or subscriptions. Representative production query cost for the larger window remains unverified.

## Unavailable-data diagnosis

Read-only database metadata checks confirmed that the locally configured Supabase hostname matches the connected project (`dvieoqprsmzydtepbxwn`) and **public.get_tenh_analytics_overview has zero installed definitions**. No customer rows were queried and no credentials were displayed. The API calls this function; absence produces503/unavailable instead of a legacy fallback or fabricated metrics. The generic user message “Dashboard data is unavailable.” remains accurate. This is not evidence of an empty workspace.

The installation candidate is `db/proposals/20261007_analytics_overview.sql`. It creates one read-only aggregate function, validates active membership/tenant identity, filters allowed channels before aggregation, and restricts execution to service_role. It has no table writes, storage/retention changes or provider operations. It is still a local proposal; installation and PostgREST validation require explicit approval to lift the user's earlier no-production-SQL restriction. No Vercel access restriction was bypassed; there was no push or deployment.

## Validation

- `tests/analytics-long-periods.test.cjs`: month-end/leap-year/IANA-timezone ranges; invalid timezone/oversized range rejection; exact drilldown bounds and labels; one RPC call per longer overview period; all four existing RPC report period identities.
- `tests/analytics-rpc-audit.test.cjs`: actual isolated PostgreSQL proposal accepts a yearly window and rejects oversized windows. Independent yearly fixture:12 messaging conversations,1 comment thread,6 human first responses,mean250seconds,SLA67%,incoming17,outgoing16,human12/bot2/unknown2,active14/new17/returning0. Fourteen active customers comprise13 incoming-thread contacts plus one outgoing-only contact. Customer creation and activity populations remain distinct.
- Browser fixture: the actual selector contains3/6-month/year options; selecting each updates the URL and triggers exactly one aggregate request; mobile year layout has no page overflow. Existing navigation/error/zero/accessibility checks continue. SQL fixture data supplies the mock response; no real messages or provider operations.
- Scoped lint, TypeScript, the complete focused suite and an isolated production build are rerun for this follow-up. Detailed results are recorded in `docs/evidence/analytics-redesign-20261007/periods-followup-results.json` and the associated logs. Screenshots include `dashboard-year-mobile.png`.

Changed behavior is local. Analytics still cannot retrieve production overview metrics until the missing function is separately installed and validated. Neither TikTok integration was enabled or modified.
