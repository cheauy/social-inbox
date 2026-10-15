// Use the existing capacity API with its workspace/subscription safeguards.
export async function setIntegrationEnabled(id: string, active: boolean, businessId: string) {
  const contextResponse = await fetch("/api/subscription/usage-management", { cache: "no-store" });
  const context = await contextResponse.json();
  if (!contextResponse.ok || !context.success || context.businessId !== businessId || !context.subscription?.id) {
    throw new Error("The workspace or subscription changed. Refresh Integrations before trying again.");
  }
  const response = await fetch("/api/subscription/usage-management", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "connection", id, active, businessId, subscriptionId: context.subscription.id }),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error ?? "Unable to change Inbox access.");
  return result;
}
