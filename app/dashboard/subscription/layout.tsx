import type { ReactNode } from "react";
import { DashboardPanelFrame, dashboardPanelSurfaceClassName } from "@/components/dashboard/dashboard-panel-frame";
export default function SubscriptionLayout({children}:{children:ReactNode}){
 return <DashboardPanelFrame><div data-subscription-panel className={`${dashboardPanelSurfaceClassName} overflow-y-auto`}>{children}</div></DashboardPanelFrame>;
}
