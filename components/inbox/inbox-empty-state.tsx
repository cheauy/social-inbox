"use client";

import { useId } from "react";
import { Inbox, UserRound, Zap } from "lucide-react";

function ConversationIllustration() {
  const prefix = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return <svg viewBox="0 0 320 260" className="h-[190px] w-[240px] sm:h-[230px] sm:w-[300px]" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`${prefix}-blue`} x1="70" y1="108" x2="210" y2="230" gradientUnits="userSpaceOnUse"><stop stopColor="#8cb9ff" /><stop offset="0.45" stopColor="#5688f5" /><stop offset="1" stopColor="#3970e6" /></linearGradient>
      <linearGradient id={`${prefix}-lavender`} x1="166" y1="50" x2="283" y2="170" gradientUnits="userSpaceOnUse"><stop stopColor="#e7e7ff" /><stop offset="0.55" stopColor="#b9b9f5" /><stop offset="1" stopColor="#9ca5eb" /></linearGradient>
      <linearGradient id={`${prefix}-gloss`} x1="100" y1="105" x2="110" y2="157" gradientUnits="userSpaceOnUse"><stop stopColor="white" stopOpacity="0.5" /><stop offset="1" stopColor="white" stopOpacity="0" /></linearGradient>
      <filter id={`${prefix}-shadow`} x="-35%" y="-35%" width="170%" height="180%"><feDropShadow dx="0" dy="10" stdDeviation="9" floodColor="#6c82bf" floodOpacity="0.18" /></filter>
      <filter id={`${prefix}-blur`}><feGaussianBlur stdDeviation="7" /></filter>
    </defs>
    <ellipse cx="161" cy="234" rx="91" ry="10" fill="#cbdafa" opacity="0.5" filter={`url(#${prefix}-blur)`} />
    <path d="M195 47h47c28 0 45 18 45 43v22c0 22-15 39-37 43l7 23-32-20h-30c-25 0-43-18-43-43V90c0-25 18-43 43-43Z" fill={`url(#${prefix}-lavender)`} filter={`url(#${prefix}-shadow)`} />
    <path d="M192 59h48c20 0 31 10 34 26-22-13-44-17-71-10-15 4-27 11-38 20 0-21 9-36 27-36Z" fill="white" opacity="0.28" />
    <path d="M81 104h108c26 0 44 18 44 43v16c0 24-18 43-44 43h-47l-37 23 10-23H81c-26 0-43-19-43-43v-16c0-25 17-43 43-43Z" fill={`url(#${prefix}-blue)`} filter={`url(#${prefix}-shadow)`} />
    <path d="M82 112h106c19 0 32 10 35 24-26-10-54-12-86-7-32 5-61 13-91 24v-6c0-21 14-35 36-35Z" fill={`url(#${prefix}-gloss)`} />
    {[91,135,179].map(cx => <circle key={cx} cx={cx} cy="158" r="9" fill="white" fillOpacity="0.93" />)}
  </svg>;
}

const features = [
  { label: "All channels in one place", Icon: Inbox, color: "bg-blue-50 text-blue-600" },
  { label: "Smart replies", Icon: Zap, color: "bg-violet-50 text-violet-600" },
  { label: "Clear customer context", Icon: UserRound, color: "bg-teal-50 text-teal-600" },
];

export function InboxEmptyState() {
  return <section aria-labelledby="inbox-empty-heading" className="h-full min-h-0 min-w-0 overflow-y-auto" style={{ background: "radial-gradient(ellipse at 50% 30%, #f0f6ff 0%, #ffffff 66%)" }}>
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-10 text-center sm:px-10">
      <ConversationIllustration />
      <h2 id="inbox-empty-heading" className="mt-5 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Start a conversation</h2>
      <p className="mt-3 max-w-md text-sm leading-6 text-slate-500">Choose a customer from the inbox to see messages, reply faster, and keep every conversation organized.</p>
      <div className="mt-10 grid w-full max-w-xl grid-cols-1 gap-7 sm:grid-cols-3 sm:gap-6">
        {features.map(({ label, Icon, color }) => <div key={label} className="flex flex-col items-center gap-3">
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${color}`}><Icon className="h-5 w-5" aria-hidden="true" /></span>
          <p className="max-w-[150px] text-[13px] font-medium leading-5 text-slate-600">{label}</p>
        </div>)}
      </div>
    </div>
  </section>;
}
