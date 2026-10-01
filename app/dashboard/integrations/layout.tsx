import type { ReactNode } from "react";
import { DashboardPanelFrame, dashboardPanelSurfaceClassName } from "@/components/dashboard/dashboard-panel-frame";
export default function IntegrationsLayout({children}:{children:ReactNode}){
 return <DashboardPanelFrame><div data-integrations-panel className={`${dashboardPanelSurfaceClassName} overflow-y-auto`}>{children}</div></DashboardPanelFrame>;
}
