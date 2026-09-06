"use client";

import {
  AnalyticsHelp,
  type HelpSection,
} from "@/components/analytics/analytics-help";

/*
 * The Agent performance wording.
 *
 * Two things on this page are routinely misread. Tracking coverage looks like
 * a score when it is really a caveat -- a low number says how much of the
 * period can be measured, not how the team did. And the speed label is not a
 * judgement of a person: it is a rule with a stated threshold and a minimum
 * sample, and saying so plainly is the difference between a useful page and an
 * argument.
 */
const SECTIONS: HelpSection[] = [
  {
    title: "Before you read the table",
    entries: [
      {
        term: "Tracking coverage",
        body: "Only replies that recorded which team member sent them can be attributed to an agent. The banner at the top says how many of the period's replies those are.",
        note: "This is a caveat, not a score. If coverage is low, the whole page describes that smaller set of replies -- an agent is not slow because coverage is low, and the rest of the replies are left out rather than guessed at.",
      },
      {
        term: "SLA target",
        body: "The speed labels and the SLA columns are all measured against the target set in the toolbar, so changing it re-judges every agent on the page.",
      },
    ],
  },
  {
    title: "How speed is judged",
    entries: [
      {
        term: "Fast",
        body: "Average first response is at or under half the SLA target, and SLA met is 90% or higher.",
      },
      {
        term: "Normal",
        body: "Between Fast and Slow -- within an acceptable range on both measures.",
      },
      {
        term: "Slow",
        body: "Average first response is slower than the SLA target, or SLA met falls below 70%.",
      },
      {
        term: "Need data",
        body: "Fewer than 3 verified first responses in the period, so no label is shown.",
        note: "One lucky or unlucky reply would otherwise decide how someone is described for the whole period.",
      },
    ],
  },
  {
    title: "The columns",
    entries: [
      {
        term: "First responses",
        body: "How many conversations this agent was the first to reply to. This is the number the speed and SLA columns are calculated from.",
      },
      {
        term: "Avg first response",
        body: "Average time between a customer's message arriving and this agent's first reply to it.",
      },
      {
        term: "SLA met",
        body: "How many of those first responses landed within the target, shown as a percentage with the raw counts beside it.",
      },
      {
        term: "Outgoing",
        body: "Every reply the agent sent, not only first responses. A high outgoing count with few first responses usually means someone who joins conversations after they have started.",
      },
      {
        term: "Conversations",
        body: "How many separate conversations the agent replied in.",
      },
      {
        term: "Status actions",
        body: "How many times the agent resolved or closed a conversation.",
      },
    ],
  },
];

export function AgentPerformanceHelp() {
  return (
    <AnalyticsHelp
      title="How agents are measured"
      intro="Everything on this page covers the period and SLA target selected above."
      sections={SECTIONS}
    />
  );
}
