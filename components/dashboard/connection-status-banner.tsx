"use client";

import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import { useOnlineStatus } from "@/lib/inbox/use-online-status";

/*
 * A floating word about the connection.
 *
 * Losing the network is quiet: messages stop arriving, a send fails with
 * whatever the fetch threw, and nothing says why. An agent's next move then
 * depends on whether they blame the app or their wifi -- so say which.
 *
 * It floats over the page rather than pushing the layout, because the inbox is
 * a fixed-height column and a banner that reflows it would move the
 * conversation under the cursor at the worst possible moment.
 */
export function ConnectionStatusBanner() {
  const { online, justReconnected } =
    useOnlineStatus();
  const isKhmer =
    useWorkspaceLanguageId() === "km";

  if (online && !justReconnected) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-[130] flex justify-center px-4"
    >
      <div
        className={`pointer-events-auto flex items-center gap-2.5 rounded-full px-4 py-2 text-sm font-semibold shadow-lg ring-1 ${
          online
            ? "bg-emerald-600 text-white ring-emerald-700/20"
            : "bg-slate-900 text-white ring-black/20"
        }`}
      >
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${
            online
              ? "bg-emerald-200"
              : "animate-pulse bg-amber-400"
          }`}
        />

        {online ? (
          <span>
            {isKhmer
              ? "បានតភ្ជាប់ឡើងវិញ — កំពុងធ្វើបច្ចុប្បន្នភាព"
              : "Back online — catching up"}
          </span>
        ) : (
          <span>
            {isKhmer
              ? "គ្មានអ៊ីនធឺណិត — សារថ្មីនឹងមកដល់ពេលតភ្ជាប់ឡើងវិញ"
              : "No internet — new messages will arrive when you reconnect"}
          </span>
        )}
      </div>
    </div>
  );
}
