import type { Metadata } from "next";

import { TENH_EXTENSION_STORE_URL } from "@/lib/extension/store-listing";

export const metadata: Metadata = {
  title: "TENH v1",
  description:
    "How to install the optional TENH v1 browser extension for TENH Chat.",
};

/*
 * The page a customer is sent to, and nothing more than that.
 *
 * It used to carry the developer's route in -- Developer mode, Load unpacked,
 * pick this folder -- which is the wrong thing to put in front of somebody who
 * bought a product. Chrome warns about unpacked extensions, they vanish on
 * restart in some setups, and nobody should be asked to turn on a developer
 * switch to use a feature. So: the Web Store, or an honest wait for it.
 *
 * The unpacked route still exists for us, in tenh-extension/README.md.
 */

const steps = [
  {
    title: "Add it to Chrome",
    body: [
      "Open the TENH v1 listing on the Chrome Web Store and choose Add to Chrome.",
      "Confirm when Chrome asks. It installs in a few seconds.",
      "Pin TENH v1 to the toolbar so you can see it.",
    ],
  },
  {
    title: "It connects itself",
    body: [
      "Open TENH in the same browser, signed in as usual.",
      "That is the whole step. The extension connects to your TENH account on its own, and stays connected — there is nothing to do again tomorrow.",
      "Your browser then appears under Connected browsers in Settings → Integrations.",
      "If it does not appear, sign in to TENH in that browser and use Test connection in the extension.",
    ],
  },
  {
    title: "Use it",
    body: [
      "Open a Facebook conversation. The side panel shows that customer's TENH tags, notes, assignment and your workspace's quick replies.",
      "A quick reply goes into Facebook's box for you to read. You press Send.",
      "When Meta's messaging window has closed, TENH offers Open in Facebook and reports what Facebook itself is showing.",
    ],
  },
];

export default function TenhCompanionPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-14">
      <h1 className="text-3xl font-bold text-slate-900">TENH v1</h1>

      <p className="mt-3 text-base leading-7 text-slate-600">
        An optional Chrome extension. It reads what a Facebook tab is already
        showing and puts your TENH records beside it.{" "}
        <strong className="font-semibold text-slate-900">
          TENH works exactly the same without it
        </strong>{" "}
        — messages still arrive through Meta&apos;s webhook and still send
        through the official API.
      </p>

      {TENH_EXTENSION_STORE_URL ? (
        <a
          href={TENH_EXTENSION_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          Add to Chrome
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M14 4h6v6M20 4l-9 9" strokeLinecap="round" />
            <path
              d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"
              strokeLinecap="round"
            />
          </svg>
        </a>
      ) : (
        /* No pretend button. A dead link to a listing that does not exist is
           worse than a sentence saying so. */
        <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-900">
          <strong className="font-semibold">Not on the Chrome Web Store yet.</strong>{" "}
          It is with Google for review. The install button appears here the day
          it is approved — nothing else on this page changes.
        </p>
      )}

      <div className="mt-10 space-y-8">
        {steps.map((step, index) => (
          <section key={step.title}>
            <h2 className="text-lg font-bold text-slate-900">
              <span className="mr-2 text-slate-400">{index + 1}.</span>
              {step.title}
            </h2>

            <ul className="mt-3 space-y-2">
              {step.body.map((line) => (
                <li
                  key={line}
                  className="flex gap-3 text-sm leading-6 text-slate-600"
                >
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                  {line}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="mt-12 rounded-2xl border border-slate-200 bg-slate-50 p-6">
        <h2 className="text-lg font-bold text-slate-900">What it will not do</h2>

        <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
          <li>
            It never reads or uploads Facebook passwords, cookies, or session
            identifiers.
          </li>
          <li>
            It never presses Send, and never works around a reply box Facebook
            has disabled. Meta&apos;s messaging rules stand.
          </li>
          <li>
            It never reads your customers&apos; messages. It reads the reply
            your own team typed, so TENH can tell you whether that reply
            arrived.
          </li>
          <li>
            It never creates a message in TENH. Meta&apos;s webhook remains the
            only thing that does.
          </li>
          <li>
            Connecting uses your TENH sign-in on that browser and nothing else
            — there is no code, and no second way in. Remove the browser from
            Settings → Integrations at any time, and it stops.
          </li>
        </ul>
      </section>
    </main>
  );
}
