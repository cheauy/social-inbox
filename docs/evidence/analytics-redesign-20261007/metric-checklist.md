# Metric-by-metric fixture checklist

PASS = reproduced stated definition in isolated fixtures. FAIL = known incorrect interpretation/formula retained and explicitly flagged. UNVERIFIED = evidence incomplete. All production behavior remains UNVERIFIED until separately validated. See `docs/analytics-dashboard-review-20261007.md` for sources, units, identity keys, inclusions/exclusions, time windows, timezone and denominators.

## Overview (proposed RPC, human-overview-v1)

| Metric | Independently expected | Actual | Verdict |
|---|---:|---:|---|
| current.unassigned | 6 | 6 | PASS |
| current.unread | 8 | 8 | PASS |
| current.waitingOverSla | 4 | 4 | PASS |
| current.unknownWaiting | 1 | 1 | PASS |
| current.overdue | 3 | 3 | PASS |
| period.conversations | 8 | 8 | PASS |
| period.commentThreads | 1 | 1 | PASS |
| period.resolved | 2 | 2 | PASS |
| period.firstResponses | 4 | 4 | PASS |
| period.avgFirstResponseSeconds | 270 | 270 | PASS |
| period.slaMet | 4 | 4 | PASS |
| period.slaMissed | 2 | 2 | PASS |
| period.slaDenominator | 6 | 6 | PASS |
| period.slaRate | 67 | 67 | PASS |
| period.humanEvaluableConversations | 7 | 7 | PASS |
| period.unknownHumanConversations | 1 | 1 | PASS |
| messages.incoming | 12 | 12 | PASS |
| messages.outgoing | 12 | 12 | PASS |
| messages.humanOutgoing | 9 | 9 | PASS |
| messages.botOutgoing | 2 | 2 | PASS |
| messages.unknownOutgoing | 1 | 1 | PASS |
| customers.active | 10 | 10 | PASS |
| customers.new | 4 | 4 | PASS |
| customers.returning | 7 | 7 | PASS |
| channels.comment.value | 1 | 1 | PASS |
| channels.messenger.value | 7 | 7 | PASS |
| channels.telegram.value | 1 | 1 | PASS |
| daily.2026-10-05.received | 8 | 8 | PASS |
| daily.2026-10-05.resolved | 2 | 2 | PASS |
| hours.0.value | 2 | 2 | PASS |
| hours.1.value | 2 | 2 | PASS |
| hours.2.value | 1 | 1 | PASS |
| hours.3.value | 1 | 1 | PASS |
| hours.4.value | 2 | 2 | PASS |
| hours.5.value | 2 | 2 | PASS |
| hours.6.value | 0 | 0 | PASS |
| hours.7.value | 0 | 0 | PASS |
| hours.8.value | 0 | 0 | PASS |
| hours.9.value | 0 | 0 | PASS |
| hours.10.value | 0 | 0 | PASS |
| hours.11.value | 0 | 0 | PASS |
| hours.12.value | 0 | 0 | PASS |
| hours.13.value | 0 | 0 | PASS |
| hours.14.value | 0 | 0 | PASS |
| hours.15.value | 0 | 0 | PASS |
| hours.16.value | 0 | 0 | PASS |
| hours.17.value | 0 | 0 | PASS |
| hours.18.value | 0 | 0 | PASS |
| hours.19.value | 0 | 0 | PASS |
| hours.20.value | 1 | 1 | PASS |
| hours.21.value | 0 | 0 | PASS |
| hours.22.value | 0 | 0 | PASS |
| hours.23.value | 1 | 1 | PASS |

## Original detailed report summary definitions

Rows below use each report's original source population, not the new overview population. For flagged snapshots/attribution/history interpretations, see the last column.

| Report.metric | Independently expected | Actual | Verdict |
|---|---:|---:|---|
| conversations.currentOpen | 9 | 9 | FAIL as whole current queue; received cohort only |
| conversations.currentSpam | 1 | 1 | FAIL as whole current queue; received cohort only |
| conversations.currentClosed | 1 | 1 | FAIL as whole current queue; received cohort only |
| conversations.currentUnread | 6 | 6 | FAIL as whole current queue; received cohort only |
| conversations.totalMessages | 28 | 28 | PASS (original definition) |
| conversations.currentPending | 0 | 0 | FAIL as whole current queue; received cohort only |
| conversations.resolutionRate | 18 | 18 | PASS (original definition) |
| conversations.waitingOverSla | 2 | 2 | FAIL as whole current queue; received cohort only |
| conversations.currentResolved | 0 | 0 | FAIL as whole current queue; received cohort only |
| conversations.incomingMessages | 14 | 14 | PASS (original definition) |
| conversations.outgoingMessages | 13 | 13 | PASS (original definition) |
| conversations.currentUnassigned | 3 | 3 | FAIL as whole current queue; received cohort only |
| conversations.receivedConversations | 11 | 11 | PASS (original definition) |
| conversations.resolvedConversations | 2 | 2 | PASS (original definition) |
| customers.newCustomers | 4 | 4 | PASS (original definition) |
| customers.openCustomers | 14 | 14 | PASS (original definition) |
| customers.inactive30Days | 14 | 14 | PASS (original definition) |
| customers.totalCustomers | 18 | 18 | PASS (original definition) |
| customers.activeCustomers | 12 | 12 | PASS (original definition) |
| customers.incomingMessages | 14 | 14 | PASS (original definition) |
| customers.messagesInPeriod | 28 | 28 | PASS (original definition) |
| customers.outgoingMessages | 13 | 13 | PASS (original definition) |
| customers.returningCustomers | 9 | 9 | PASS (original definition) |
| sla.slaMet | 7 | 7 | PASS (original definition) |
| sla.slaRate | 78 | 78 | PASS (original definition) |
| sla.waiting | 1 | 1 | PASS (original definition) |
| sla.received | 9 | 9 | PASS (original definition) |
| sla.resolved | 1 | 1 | FAIL as recorded resolution history; current-state inference |
| sla.responded | 8 | 8 | PASS (original definition) |
| sla.slaMissed | 2 | 2 | PASS (original definition) |
| sla.slaWaiting | 0 | 0 | PASS (original definition) |
| sla.avgResolutionSeconds | 300 | 300 | FAIL as recorded resolution history; current-state inference |
| sla.avgFirstResponseSeconds | 525 | 525 | PASS (original definition) |
| sla.medianFirstResponseSeconds | 120 | 120 | PASS (original definition) |
| agents.slaMet | 4 | 4 | PASS for attributed samples; FAIL as overall/human-only |
| agents.slaRate | 80 | 80 | PASS for attributed samples; FAIL as overall/human-only |
| agents.slaMissed | 1 | 1 | PASS for attributed samples; FAIL as overall/human-only |
| agents.totalOutgoing | 13 | 13 | PASS (original definition) |
| agents.attributionRate | 77 | 77 | PASS (original definition) |
| agents.attributedOutgoing | 10 | 10 | PASS (original definition) |
| agents.totalFirstResponses | 8 | 8 | PASS (original definition) |
| agents.unattributedOutgoing | 3 | 3 | PASS (original definition) |
| agents.avgFirstResponseSeconds | 804 | 804 | PASS for attributed samples; FAIL as overall/human-only |
| agents.attributedFirstResponses | 5 | 5 | PASS for attributed samples; FAIL as overall/human-only |
| agents.unattributedFirstResponses | 3 | 3 | PASS (original definition) |

## Rows, charts and supplemental populations

| Metric | Expected | Actual | Verdict |
|---|---|---|---|
| Agent 1.firstResponses | 3 | 3 | PASS as member sample/action; not additive unique overall counts |
| Agent 1.avgFirstResponseSeconds | 1240 | 1240 | PASS as member sample/action; not additive unique overall counts |
| Agent 1.medianFirstResponseSeconds | 300 | 300 | PASS as member sample/action; not additive unique overall counts |
| Agent 1.slaMet | 2 | 2 | PASS as member sample/action; not additive unique overall counts |
| Agent 1.slaMissed | 1 | 1 | PASS as member sample/action; not additive unique overall counts |
| Agent 1.slaRate | 67 | 67 | PASS as member sample/action; not additive unique overall counts |
| Agent 1.outgoingMessages | 6 | 6 | PASS as member sample/action; not additive unique overall counts |
| Agent 1.conversationsReplied | 5 | 5 | PASS as member sample/action; not additive unique overall counts |
| Agent 1.resolvedActions | 3 | 3 | PASS as member sample/action; not additive unique overall counts |
| Agent 2.firstResponses | 2 | 2 | PASS as member sample/action; not additive unique overall counts |
| Agent 2.avgFirstResponseSeconds | 150 | 150 | PASS as member sample/action; not additive unique overall counts |
| Agent 2.medianFirstResponseSeconds | 150 | 150 | PASS as member sample/action; not additive unique overall counts |
| Agent 2.slaMet | 2 | 2 | PASS as member sample/action; not additive unique overall counts |
| Agent 2.slaMissed | 0 | 0 | PASS as member sample/action; not additive unique overall counts |
| Agent 2.slaRate | 100 | 100 | PASS as member sample/action; not additive unique overall counts |
| Agent 2.outgoingMessages | 4 | 4 | PASS as member sample/action; not additive unique overall counts |
| Agent 2.conversationsReplied | 4 | 4 | PASS as member sample/action; not additive unique overall counts |
| Agent 2.resolvedActions | 0 | 0 | PASS as member sample/action; not additive unique overall counts |
| Agent replied threads: sum vs unique union | {"sum":9,"union":7} | {"sum":9,"union":7} | FAIL if member counts summed to overall; independent identity union7 |
| Conversation daily UTC | [{"date":"2026-10-05","received":11,"resolved":2}] | [{"date":"2026-10-05","received":9,"resolved":2},{"date":"2026-10-06","received":2,"resolved":0}] | FAIL: database session timezone affects selected UTC buckets |
| Conversation daily after isolated session UTC | [{"date":"2026-10-05","received":11,"resolved":2}] | [{"date":"2026-10-05","received":11,"resolved":2}] | PASS isolated only; PostgREST session UNVERIFIED |
| Team daily totals | {"received":9,"responded":8,"met":7,"missed":2} | {"received":9,"responded":8,"met":7,"missed":2} | PASS sums; per-date timezone/DST UNVERIFIED |
| Conversation status rows | {"open":9,"closed":1,"spam":1} | {"open":9,"closed":1,"spam":1} | PASS cohort only |
| Conversation channel messenger | UNVERIFIED | {"channel":"messenger","conversations":10,"incomingMessages":12} | FAIL: Telegram/Personal combined with Messenger |
| Conversation channel comment | UNVERIFIED | {"channel":"comment","conversations":1,"incomingMessages":2} | FAIL: Telegram/Personal combined with Messenger |
| Conversation busy hour 8 | UNVERIFIED | 3 | FAIL as complete message activity; top six first-incoming IDs |
| Conversation busy hour 3 | UNVERIFIED | 1 | FAIL as complete message activity; top six first-incoming IDs |
| Conversation busy hour 6 | UNVERIFIED | 1 | FAIL as complete message activity; top six first-incoming IDs |
| Conversation busy hour 7 | UNVERIFIED | 1 | FAIL as complete message activity; top six first-incoming IDs |
| Conversation busy hour 9 | UNVERIFIED | 1 | FAIL as complete message activity; top six first-incoming IDs |
| Conversation busy hour 10 | UNVERIFIED | 1 | FAIL as complete message activity; top six first-incoming IDs |
| Customer channel messenger | UNVERIFIED | {"channel":"messenger","messages":25,"customers":11,"conversations":11} | FAIL as separate Messenger/Comments/Telegram |
| Customer channel comment | UNVERIFIED | {"channel":"comment","messages":3,"customers":1,"conversations":1} | FAIL as separate Messenger/Comments/Telegram |
| Customer daily new totals | 4 | 4 | PASS sum; timezone boundary coverage UNVERIFIED |
| Top customer1 message/conversation/direction counts | {"messages":4,"conversations":1,"incomingMessages":2,"outgoingMessages":2} | {"messages":4,"conversations":1,"incomingMessages":2,"outgoingMessages":2} | PASS contact sample; capped list not whole population |
| Nonempty tag/contact counts | UNVERIFIED | [] | UNVERIFIED; fixture contains no tags |
| Team attention first waiting seconds / unanswered sample | {"elapsedSeconds":75600,"firstResponseSeconds":null} | {"elapsedSeconds":75600,"firstResponseSeconds":null} | PASS sample only; capped subset |
| Conversation waiting first sample | {"waitingSeconds":75600,"unreadCount":5} | {"waitingSeconds":75600,"unreadCount":5} | PASS cohort sample; unread unit messages |
| Channel strictPeriodIncoming | 6 | 7 | FAIL reproduced; explicitly flagged, formula retained |
| Channel incomingFirstReply | 3 | 2 | FAIL reproduced; explicitly flagged, formula retained |
| Workload active / unread messages / authorized overdue reminders | {"active":1001,"unread":5,"overdue":1} | {"active":1001,"unread":5,"overdue":1} | PASS assertions in analytics-workload-scope.test.cjs |
| Optional live workload first-response/SLA/waiting metrics | UNVERIFIED | null | UNVERIFIED: deployed RPC absent |
| Empty Team SLA SQL | null | 100 | FAIL raw deployed100%; web API test verifies corrected null |
| Overview empty/instant/no eligible response SLA and mean | null | null | PASS independent SQL assertions |

## Remaining evidence boundaries

All displayed new overview fields have positive/empty and reconciliation evidence. Additional per-row Customer tags, additional-platform/channel variants, all capped-list members and nonempty optional live workload lack exhaustive independently counted fixtures and remain UNVERIFIED. Numeric original-report checks do not certify misleading broad interpretations, provider provenance completeness, real PostgREST permissions/session settings, historical event completeness, production-scale performance or hosted costs. No production SQL was applied.
