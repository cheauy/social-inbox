"use client";

import {
  AnalyticsHelp,
  type HelpSection,
} from "@/components/analytics/analytics-help";

/*
 * What every number on the Team performance page means, and how it is worked
 * out.
 *
 * The page is dense, and several numbers are easy to read wrongly in ways that
 * matter. "SLA met" depends on a target the reader themselves set in the
 * toolbar. "First response time" is a median, not the average sitting right
 * under it. A gap in the response line means nobody replied that day, which is
 * the opposite of the fast day it looks like. None of that is guessable from
 * the label, so it is written down rather than left to be discovered.
 */
const SECTIONS: HelpSection[] = [
  {
    title: "The four cards",
    entries: [
      {
        term: "First response time",
        body: "How long a customer waits before anyone on your team replies for the first time. The big number is the median: half your replies were faster than it, half were slower.",
        note: "The average is shown underneath, and is usually the larger of the two. One reply left overnight drags an average badly, while the median keeps describing a normal customer's wait.",
      },
      {
        term: "SLA met",
        body: "The share of conversations answered within your target time. Change the target with the Target control at the top of the page -- 10 minutes to start with.",
        note: "A conversation counts as missed if the first reply was slower than the target, and also if nobody has replied at all yet.",
      },
      {
        term: "Conversations",
        body: "How many new customer conversations arrived in the period. Responded means someone on your team replied; waiting means nobody has yet.",
        note: "The response rate is simply responded divided by received.",
      },
      {
        term: "Resolution time",
        body: "Average time from a conversation arriving to it being marked resolved or closed.",
        note: "Only conversations that actually reached resolved or closed are counted, so a busy period with a lot still open can show a fast resolution time.",
      },
    ],
  },
  {
    title: "The chart",
    entries: [
      {
        term: "Response trend",
        body: "Two plots that share one row of dates. The top one is how many conversations arrived each day. The bottom one is the average time to first reply on that day.",
        note: "They are drawn separately on purpose. Conversations are counted in ones and tens, response time in minutes and hours -- putting both on a single plot would make the line cross the bars at a point decided by the scaling rather than by anything real.",
      },
      {
        term: "Hovering a day",
        body: "Point at any day to highlight it in both plots at once and read both numbers together.",
      },
      {
        term: "A gap in the line",
        body: "Where the line breaks, nobody replied to anyone that day.",
        note: "This is the opposite of what a low point would mean. A day with no replies has no response time at all, so it is left out rather than drawn at zero, which would read as instant service.",
      },
      {
        term: "Best, busiest and slowest day",
        body: "Best is the day with the fastest average first reply. Busiest is the day with the most conversations. Slowest is the day with the slowest average first reply.",
        note: "Best and slowest ignore days where nobody replied, since those have no time to compare.",
      },
    ],
  },
  {
    title: "The queue",
    entries: [
      {
        term: "Needs attention",
        body: "Conversations that missed your target time, or that are still waiting for a first reply. This is the working list -- the four cards tell you how the period went, this tells you what to do now.",
      },
      {
        term: "7d / 30d / 90d",
        body: "Everything on the page, including this list, is limited to the period you choose here.",
      },
    ],
  },
];

export function TeamPerformanceHelp() {
  return (
    <AnalyticsHelp
      title="What these numbers mean"
      intro="Everything on this page covers the period selected above."
      sections={SECTIONS}
    />
  );
}
