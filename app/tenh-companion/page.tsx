import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TENH v1",
  description:
    "How to install the optional TENH v1 browser extension for TENH Chat.",
};

/*
 * The page the Integrations card links to.
 *
 * It exists because that link was pointing at nothing, and because an
 * extension somebody has to install needs its steps written down somewhere a
 * person can reach without a terminal. Everything here is also in
 * tenh-extension/README.md, which is where a developer will look.
 */

const steps = [
  {
    title: "Install it",
    body: [
      "From the Chrome Web Store: search for TENH v1 and choose Add to Chrome.",
      "Not on the store yet? Open chrome://extensions, turn on Developer mode, choose Load unpacked, and select the tenh-extension folder.",
      "Pin TENH v1 to the toolbar so you can see it.",
    ],
  },
  {
    title: "It connects itself",
    body: [
      "Open TENH in the same browser, signed in as usual.",
      "That is the whole step. The extension connects to your TENH account on its own, and stays connected — there is nothing to do again tomorrow.",
      "Your browser then appears under Connected browsers in Settings → Integrations.",
      "On a computer where you are not signed in to TENH, use Pair another browser with a code instead.",
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
            Connecting uses your TENH sign-in on this browser and nothing else.
            Remove the browser from Settings → Integrations at any time, and it
            stops.
          </li>
        </ul>
      </section>
    </main>
  );
}
