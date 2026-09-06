"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * The "what does this number mean" panel, shared by the analytics views.
 *
 * Each view owns its wording; this owns the button, the popover, and the
 * dismissal behaviour, so a second view does not arrive with its own slightly
 * different version of all three.
 *
 * A panel rather than per-card tooltips: someone opening it is usually learning
 * the whole screen at once, and tooltips would make them hunt for eight
 * separate hovers to do it.
 */

export type HelpEntry = {
  term: string;
  body: string;
  note?: string;
};

export type HelpSection = {
  title: string;
  entries: HelpEntry[];
};

function Section({
  section,
}: {
  section: HelpSection;
}) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
        {section.title}
      </p>

      <dl className="mt-2 space-y-3">
        {section.entries.map((entry) => (
          <div key={entry.term}>
            <dt className="text-xs font-bold text-slate-900">
              {entry.term}
            </dt>
            <dd className="mt-0.5 text-xs leading-5 text-slate-600">
              {entry.body}
              {entry.note ? (
                <span className="mt-1 block text-[11px] leading-5 text-slate-500">
                  {entry.note}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function AnalyticsHelp({
  title,
  intro,
  sections,
}: {
  title: string;
  intro: string;
  sections: HelpSection[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef =
    useRef<HTMLDivElement | null>(null);

  /*
   * Escape and an outside click both close it. The panel covers the cards it
   * describes, so leaving it open while trying to look at them would be worse
   * than not opening it at all.
   */
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    function handleClick(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(
          event.target as Node,
        )
      ) {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", handleKey);
    document.addEventListener(
      "mousedown",
      handleClick,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKey,
      );
      document.removeEventListener(
        "mousedown",
        handleClick,
      );
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`flex h-[42px] w-[42px] items-center justify-center rounded-xl border shadow-sm transition ${
          open
            ? "border-blue-200 bg-blue-50 text-blue-600"
            : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900"
        }`}
        title={title}
      >
        <span className="sr-only">{title}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path
            d="M9.4 9.2a2.7 2.7 0 1 1 3.4 2.6c-.6.2-.8.6-.8 1.2v.5"
            strokeLinecap="round"
          />
          <path
            d="M12 16.8v.2"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={title}
          className="absolute right-0 z-30 mt-2 max-h-[70vh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-slate-950">
                {title}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {intro}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="-mr-1 -mt-1 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              <span className="sr-only">Close</span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path
                  d="M6 6l12 12M18 6L6 18"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          <div className="mt-4 space-y-5">
            {sections.map((section) => (
              <Section
                key={section.title}
                section={section}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
