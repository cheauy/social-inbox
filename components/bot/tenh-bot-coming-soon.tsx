import { Bot } from "lucide-react";
import { DashboardPanelFrame, dashboardPanelSurfaceClassName } from "@/components/dashboard/dashboard-panel-frame";
export function TenhBotComingSoon(){
 return <DashboardPanelFrame><main data-tenh-bot-coming-soon className={`${dashboardPanelSurfaceClassName} flex items-center justify-center p-6`}>
  <div className="max-w-md text-center"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600"><Bot aria-hidden="true" className="h-7 w-7"/></span>
   <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-blue-600">Tenh Bot</p><h1 className="mt-2 text-2xl font-semibold text-slate-900">Coming soon</h1>
   <p className="mt-3 text-sm leading-6 text-slate-500">Bot configuration and automation are paused while we prepare the next release.</p>
  </div>
 </main></DashboardPanelFrame>;
}
