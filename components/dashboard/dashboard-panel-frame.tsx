import type { ReactNode } from "react";

// Match the existing Inbox page and data-inbox-shell surfaces without changing them.
export const dashboardPanelSurfaceClassName="relative h-full min-h-0 w-full overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_6px_16px_rgba(15,23,42,0.06)]";
export function DashboardPanelFrame({children}:{children:ReactNode}){
 return <div data-dashboard-panel-frame className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-50 p-1.5 sm:p-2.5"><div className="min-h-0 flex-1 overflow-hidden">{children}</div></div>;
}
