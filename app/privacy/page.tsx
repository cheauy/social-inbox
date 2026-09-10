export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-bold">Privacy Policy</h1>

      <div className="mt-8 space-y-5 text-slate-700">
        <p>
          Social Inbox connects authorized Facebook Pages so
          businesses can receive and reply to customer messages.
        </p>

        <h2 className="text-xl font-semibold text-slate-900">
          Information we collect
        </h2>

        <p>
          We may store Facebook Page identifiers, customer messaging
          identifiers, message content, timestamps, and account
          connection information required to provide the service.
        </p>

        <h2 className="text-xl font-semibold text-slate-900">
          How information is used
        </h2>

        <p>
          Information is used to display customer conversations,
          support replies, maintain conversation history, and secure
          connected accounts.
        </p>

        <h2 className="text-xl font-semibold text-slate-900">
          Data sharing
        </h2>

        <p>
          We do not sell personal information. Information is shared
          only with service providers required to operate the
          application, such as hosting and database providers.
        </p>

        <h2 className="text-xl font-semibold text-slate-900">
          Data deletion
        </h2>

        <p>
          Users may request deletion of their connected account and
          associated data by contacting support.
        </p>

        <h2 className="text-xl font-semibold text-slate-900">
          TENH v1 browser extension
        </h2>

        <p>
          TENH v1 is an optional Chrome extension. TENH works fully without
          it, and installing it does not change how messages are received or
          sent. This section describes it because the Chrome Web Store listing
          links here.
        </p>

        <h3 className="text-base font-semibold text-slate-900">
          What the extension sends to TENH
        </h3>

        <p>
          <strong>Connection details.</strong>{" "}
          A connection token issued by
          TENH, a random identifier generated in the browser to recognise that
          same browser again, a device label such as
          &ldquo;Chrome on Windows&rdquo;, and the extension version. The token
          is stored only as a hash on our servers.
        </p>

        <p>
          <strong>Facebook page status.</strong>{" "}
          Roughly every thirty seconds,
          whether a Facebook tab appears signed in, which Facebook Page that
          tab is acting as, the address of the page with its query string
          removed, and whether Facebook is showing a reply box. This describes
          the state of a browser tab, not its contents.
        </p>

        <p>
          <strong>Replies your team types in Facebook.</strong>{" "}
          When a member
          of your own team sends a reply from Facebook itself, the extension
          sends that reply&apos;s text, shortened, together with the Page and
          conversation identifiers and a timestamp. Its only purpose is to
          check whether the reply also reached TENH through Meta&apos;s
          official webhook, so missing messages can be identified. Your
          customers&apos; messages are never read or sent.
        </p>

        <h3 className="text-base font-semibold text-slate-900">
          What the extension reads from TENH
        </h3>

        <p>
          Your own workspace records, to display beside a Facebook
          conversation: the customer&apos;s tags, notes, assigned agent, your
          saved quick replies, and your unread count. Adding or removing a tag
          in the extension writes to the same records the website uses, under
          the permissions that member already has. The extension keeps no
          separate copy of any of it.
        </p>

        <h3 className="text-base font-semibold text-slate-900">
          What the extension never does
        </h3>

        <p>
          It never reads, stores or transmits Facebook passwords, cookies,
          session identifiers such as <code>c_user</code> or <code>xs</code>,
          or any other Facebook credential. It never signs in to Facebook on
          your behalf; where Facebook asks for a sign-in it shows a button and
          you sign in yourself. It never reads the contents of a customer
          conversation. It never creates a message in TENH — Meta&apos;s
          official webhook remains the only source of messages. It runs no
          remote code, and it requests access to only three web addresses:
          TENH&apos;s own application, and Facebook.
        </p>

        <h3 className="text-base font-semibold text-slate-900">
          Storage, access and deletion
        </h3>

        <p>
          The connection token and the last observed Facebook status are kept
          in the browser&apos;s own extension storage. On our servers, this
          information is stored with your workspace and readable only by
          active members of that workspace. Removing a browser under
          Settings &rarr; Integrations revokes its access at its next request.
          Uninstalling the extension stops all of it. Records already sent are
          kept with your workspace&apos;s other data and are deleted on
          request, or when the workspace is deleted.
        </p>

        <h2 className="text-xl font-semibold text-slate-900">
          Contact
        </h2>

        <p>Email: support@tenhchat.com</p>
      </div>
    </main>
  );
}