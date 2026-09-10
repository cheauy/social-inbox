import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File as FileSystemFile } from "expo-file-system";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { SettingsGroup, SettingsScreen } from "../../components/settings-screen";
import { ErrorNotice, IconButton, colors, styles } from "../../components/ui";
import { api } from "../../lib/api/client";
import { useInbox } from "../../lib/inbox-provider";
import { supabase } from "../../lib/supabase/client";

type PlanCode = "mini" | "standard" | "pro";
type BillingCycle = "monthly" | "3-months" | "6-months" | "12-months";
type PaymentMethod = "payway" | "manual";
type PaymentState = "idle" | "waiting" | "approved" | "pending" | "declined" | "cancelled" | "failed";

type Plan = {
  id: PlanCode;
  name: string;
  description: string;
  channels: number;
  users: number;
  monthlyCents: number;
};

type Cycle = {
  id: BillingCycle;
  label: string;
  months: number;
  discount: number;
};

type ManualConfig = {
  enabled: boolean;
  bankName: string;
  accountName: string;
  accountNumber: string;
  qrImageUrl: string | null;
  supportText: string | null;
};

type Catalog = {
  plans: Plan[];
  cycles: Cycle[];
  manualPayment: ManualConfig;
};

type Subscription = {
  id: string;
  business_id: string;
  status: string;
  plan_code: string | null;
  billing_cycle: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  member_limit: number | null;
  channel_limit: number | null;
};

type CurrentResponse = {
  subscription: Subscription | null;
  usage: { members: number; channels: number };
};

type PlanChange = {
  mode: "active-paid" | "subscribe" | "suspended" | "unmanaged";
  canManage: boolean;
  isOwner: boolean;
  currentPlan: string | null;
  currentRank: number;
  usage: { members: number; channels: number };
};

type ManualRequest = {
  id: string;
  planCode: string;
  billingCycle: string;
  amount: number;
  currency: string;
  status: "submitted" | "approved" | "rejected" | "cancelled";
  proofFileName: string;
  reviewNote: string | null;
  createdAt: string;
};

type Proof = {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
};

type Checkout = {
  url: string;
  fields: Record<string, string>;
  transactionId: string;
  businessId: string;
};

const RANK: Record<string, number> = { mini: 1, standard: 2, pro: 3 };

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function total(plan: Plan, cycle: Cycle) {
  return Math.round(plan.monthlyCents * cycle.months * (1 - cycle.discount));
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "—";
  return parsed.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function escapeAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function checkoutHtml(checkout: Checkout) {
  const inputs = Object.entries(checkout.fields)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeAttribute(name)}" value="${escapeAttribute(value)}">`,
    )
    .join("");

  return `<!doctype html>
  <html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
  <style>html,body{margin:0;background:#fff;font-family:system-ui}#wait{padding:28px;text-align:center;color:#52637a}</style></head>
  <body><div id="wait">Opening ABA PayWay secure checkout…</div>
  <form method="POST" enctype="multipart/form-data" action="${escapeAttribute(checkout.url)}" target="aba_webservice" id="aba_merchant_request" style="display:none">${inputs}</form>
  <script src="https://checkout.payway.com.kh/plugins/checkout2-0.js"></script>
  <script>(function start(attempt){try{if(window.AbaPayway&&typeof window.AbaPayway.checkout==='function'){window.AbaPayway.checkout();return;}}catch(e){}if(attempt<120){setTimeout(function(){start(attempt+1)},250)}else{document.getElementById('wait').textContent='Unable to load ABA PayWay checkout.'}})(0);</script>
  </body></html>`;
}

function Choice({
  selected,
  title,
  detail,
  onPress,
}: {
  selected: boolean;
  title: string;
  detail?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: selected ? colors.blue : colors.border,
        backgroundColor: selected ? colors.pale : pressed ? "#F8FAFC" : "white",
      })}
    >
      <Text style={{ color: selected ? colors.blue : colors.ink, fontWeight: "800" }}>
        {title}
      </Text>
      {detail ? <Text style={[styles.muted, { marginTop: 2, fontSize: 11.5 }]}>{detail}</Text> : null}
    </Pressable>
  );
}

export default function SubscriptionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    workspace,
    workspaces,
    loadWorkspaces,
    selectWorkspace,
    refreshAlerts,
    settingsRevision,
  } = useInbox();

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [current, setCurrent] = useState<CurrentResponse | null>(null);
  const [security, setSecurity] = useState<PlanChange | null>(null);
  const [manualRequest, setManualRequest] = useState<ManualRequest | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<PlanCode>("mini");
  const [selectedCycle, setSelectedCycle] = useState<BillingCycle>("monthly");
  const [method, setMethod] = useState<PaymentMethod>("payway");
  const [proof, setProof] = useState<Proof | null>(null);
  const [note, setNote] = useState("");
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [purchaseBusinessId, setPurchaseBusinessId] = useState<string | null>(null);
  const [paymentState, setPaymentState] = useState<PaymentState>("idle");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const approved = useRef(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const planCatalog = await api<Catalog>("/api/subscription/catalog", workspace?.businessId);
      setCatalog(planCatalog);

      if (!workspace) {
        setCurrent(null);
        setSecurity(null);
        setManualRequest(null);
        setError("");
        return;
      }

      const [subscription, planState, manual] = await Promise.all([
        api<CurrentResponse>("/api/subscription/current", workspace.businessId),
        api<PlanChange>("/api/subscription/plan-change", workspace.businessId),
        api<{ request: ManualRequest | null }>("/api/manual-payments", workspace.businessId).catch(() => ({ request: null })),
      ]);
      setCurrent(subscription);
      setSecurity(planState);
      setManualRequest(manual.request ?? null);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load subscription.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [workspace?.businessId]);

  useEffect(() => { void load(); }, [load]);

  const seenRevision = useRef(settingsRevision);
  useEffect(() => {
    if (seenRevision.current === settingsRevision) return;
    seenRevision.current = settingsRevision;
    void load(true);
  }, [settingsRevision, load]);

  useEffect(() => {
    if (manualRequest?.status !== "submitted") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const target = purchaseBusinessId ?? workspace?.businessId;
      if (!target) return;
      try {
        const response = await api<{ request: ManualRequest | null }>(
          `/api/manual-payments?purchase_business=${encodeURIComponent(target)}`,
          target,
        );
        if (stopped) return;
        setManualRequest(response.request ?? null);
        if (response.request?.status === "approved") {
          await completePurchase(target);
          return;
        }
      } catch {
        // A later poll or Realtime workspace update can recover.
      }
      if (!stopped) timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 5000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [manualRequest?.status, purchaseBusinessId, workspace?.businessId]);

  async function completePurchase(targetBusinessId: string) {
    if (approved.current) return;
    approved.current = true;
    setPaymentState("approved");
    setCheckout(null);
    await Promise.all([loadWorkspaces(), refreshAlerts()]);
    const rows = await api<{ workspaces: typeof workspaces }>("/api/workspaces", targetBusinessId).catch(() => ({ workspaces: [] }));
    const target = rows.workspaces.find(
      (one) => one.businessId === targetBusinessId && one.subscriptionOperational,
    );
    if (target && target.businessId !== workspace?.businessId) {
      await selectWorkspace(target).catch(() => undefined);
    }
    await load(true);
  }

  useEffect(() => {
    if (!transactionId || !purchaseBusinessId || !["waiting", "pending"].includes(paymentState)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = await api<{ paymentState: PaymentState }>(
          `/api/payway/status?tran_id=${encodeURIComponent(transactionId)}`,
          purchaseBusinessId,
        );
        if (stopped) return;
        setPaymentState(result.paymentState);
        if (result.paymentState === "approved") {
          await completePurchase(purchaseBusinessId);
          return;
        }
        if (["declined", "cancelled", "failed"].includes(result.paymentState)) return;
      } catch {
        // PayWay can need a few seconds before the transaction is queryable.
      }
      if (!stopped) timer = setTimeout(poll, 3000);
    };
    timer = setTimeout(poll, 2500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [transactionId, purchaseBusinessId, paymentState]);

  const plan = catalog?.plans.find((one) => one.id === selectedPlan) ?? null;
  const cycle = catalog?.cycles.find((one) => one.id === selectedCycle) ?? null;
  const amount = plan && cycle ? total(plan, cycle) : 0;
  const subscription = current?.subscription ?? null;
  const currentRank = RANK[security?.currentPlan ?? ""] ?? 0;
  const selectedRank = RANK[selectedPlan] ?? 0;
  const fits = Boolean(
    plan &&
      (security?.usage.members ?? 0) <= plan.users &&
      (security?.usage.channels ?? 0) <= plan.channels,
  );

  const action = useMemo(() => {
    if (!workspace || !security) return "buy-new" as const;
    if (security.mode === "suspended" || security.mode === "unmanaged") return "blocked" as const;
    if (security.mode === "subscribe") {
      return security.isOwner && fits ? ("subscribe" as const) : ("buy-new" as const);
    }
    if (selectedRank === currentRank) return "current" as const;
    if (selectedRank > currentRank && security.canManage && fits) return "upgrade" as const;
    return "buy-new" as const;
  }, [workspace?.businessId, security, fits, selectedRank, currentRank]);

  async function ensureTarget() {
    if (action !== "buy-new" && workspace) return workspace.businessId;
    if (purchaseBusinessId) return purchaseBusinessId;
    const created = await api<{ businessId: string }>(
      "/api/workspaces/create-subscription",
      workspace?.businessId,
      { method: "POST", body: { planCode: selectedPlan, billingCycle: selectedCycle } },
    );
    setPurchaseBusinessId(created.businessId);
    return created.businessId;
  }

  async function startPayWay() {
    if (!plan || !cycle || busy || action === "current" || action === "blocked") return;
    setBusy(true);
    setError("");
    approved.current = false;
    try {
      const target = await ensureTarget();
      const result = await api<{
        checkoutUrl: string;
        fields: Record<string, string>;
        transactionId: string;
      }>("/api/payway/checkout", target, {
        method: "POST",
        body: {
          planCode: selectedPlan,
          billingCycle: selectedCycle,
          paymentMethod: "abapay_khqr",
          purchaseBusinessId: target,
        },
      });
      setPurchaseBusinessId(target);
      setTransactionId(result.transactionId);
      setPaymentState("waiting");
      setCheckout({
        url: result.checkoutUrl,
        fields: result.fields,
        transactionId: result.transactionId,
        businessId: target,
      });
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Unable to start payment.");
    } finally {
      setBusy(false);
    }
  }

  async function pickProof() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    setProof({
      uri: asset.uri,
      name: asset.name || "payment-proof",
      mimeType: asset.mimeType || "application/octet-stream",
      size: asset.size ?? new FileSystemFile(asset.uri).size,
    });
  }

  async function submitManual() {
    if (!plan || !cycle || !proof || busy || action === "current" || action === "blocked") return;
    setBusy(true);
    setError("");
    try {
      const target = await ensureTarget();
      const common = {
        planCode: selectedPlan,
        billingCycle: selectedCycle,
        purchaseBusinessId: target,
        fileName: proof.name,
        mimeType: proof.mimeType,
        sizeBytes: proof.size,
      };
      const prepared = await api<{
        requestId: string;
        upload: { bucket: string; path: string; token: string };
      }>("/api/manual-payments", target, {
        method: "POST",
        body: { action: "prepare-upload", ...common },
      });
      const file = new FileSystemFile(proof.uri);
      const { error: uploadError } = await supabase.storage
        .from(prepared.upload.bucket)
        .uploadToSignedUrl(
          prepared.upload.path,
          prepared.upload.token,
          file as unknown as Blob,
          { contentType: proof.mimeType },
        );
      if (uploadError) throw new Error(uploadError.message);
      const finalized = await api<{ request: ManualRequest }>("/api/manual-payments", target, {
        method: "POST",
        body: {
          action: "finalize-upload",
          ...common,
          requestId: prepared.requestId,
          storagePath: prepared.upload.path,
          customerNote: note.trim(),
        },
      });
      setPurchaseBusinessId(target);
      setManualRequest(finalized.request);
      setProof(null);
      setNote("");
    } catch (manualError) {
      setError(manualError instanceof Error ? manualError.message : "Unable to submit payment proof.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelPayment() {
    if (!transactionId || !purchaseBusinessId || busy) return;
    setBusy(true);
    setCheckout(null);
    try {
      const result = await api<{ paymentState: PaymentState }>(
        "/api/payway/cancel-return",
        purchaseBusinessId,
        { method: "POST", body: { transactionId } },
      );
      setPaymentState(result.paymentState);
      await loadWorkspaces();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Unable to cancel payment.");
    } finally {
      setBusy(false);
    }
  }

  const buttonTitle =
    action === "current"
      ? "Current plan"
      : action === "upgrade"
        ? `Upgrade for ${money(amount)}`
        : action === "subscribe"
          ? `Activate for ${money(amount)}`
          : action === "buy-new"
            ? `Buy new workspace for ${money(amount)}`
            : "Plan unavailable";

  const ends = subscription?.status === "trialing"
    ? subscription.trial_ends_at ?? subscription.current_period_end
    : subscription?.current_period_end ?? null;

  return (
    <SettingsScreen
      title="Subscription"
      detail={workspace?.businessName ?? "Buy a TENH workspace"}
      allowWithoutWorkspace
      loading={loading}
      error={error}
      onRetry={() => void load()}
      skeleton={[3, 3, 4]}
    >
      {subscription ? (
        <SettingsGroup title="Current plan">
          <View style={{ padding: 14, gap: 10 }}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.heading, { fontSize: 18 }]}>
                  {catalog?.plans.find((one) => one.id === subscription.plan_code)?.name ?? subscription.plan_code ?? "TENH plan"}
                </Text>
                <Text style={styles.muted}>{subscription.billing_cycle ?? "No billing period"}</Text>
              </View>
              <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: ["active", "trialing"].includes(subscription.status) ? "#E7F6EE" : "#FFF1EF" }}>
                <Text style={{ fontSize: 11, fontWeight: "800", textTransform: "uppercase", color: ["active", "trialing"].includes(subscription.status) ? "#2FA36B" : colors.red }}>
                  {subscription.status}
                </Text>
              </View>
            </View>
            <Text style={styles.muted}>Ends {formatDate(ends)}</Text>
            <Text style={styles.muted}>
              {current?.usage.channels ?? 0} of {subscription.channel_limit ?? "∞"} channels · {current?.usage.members ?? 0} of {subscription.member_limit ?? "∞"} members
            </Text>
          </View>
        </SettingsGroup>
      ) : null}

      <SettingsGroup title="Billing period">
        <View style={{ padding: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {(catalog?.cycles ?? []).map((one) => (
            <Choice
              key={one.id}
              selected={selectedCycle === one.id}
              title={one.label}
              detail={one.discount > 0 ? `Save ${Math.round(one.discount * 100)}%` : undefined}
              onPress={() => setSelectedCycle(one.id)}
            />
          ))}
        </View>
      </SettingsGroup>

      <View style={{ gap: 10 }}>
        <Text style={{ paddingLeft: 4, fontSize: 11, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase", color: colors.muted }}>
          Choose a plan
        </Text>
        {(catalog?.plans ?? []).map((one) => {
          const selected = selectedPlan === one.id;
          return (
            <Pressable
              key={one.id}
              onPress={() => setSelectedPlan(one.id)}
              style={({ pressed }) => ({
                padding: 15,
                gap: 8,
                borderRadius: 16,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? colors.blue : colors.border,
                backgroundColor: selected ? colors.pale : pressed ? "#F8FAFC" : "white",
              })}
            >
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.heading, { fontSize: 17 }]}>{one.name}</Text>
                  <Text style={[styles.muted, { fontSize: 12.5, lineHeight: 18 }]}>{one.description}</Text>
                </View>
                <Text style={{ color: colors.blue, fontSize: 17, fontWeight: "900" }}>
                  {money(catalog?.cycles.find((item) => item.id === selectedCycle) ? total(one, catalog!.cycles.find((item) => item.id === selectedCycle)!) : one.monthlyCents)}
                </Text>
              </View>
              <Text style={{ color: colors.ink, fontSize: 13, fontWeight: "600" }}>
                {one.channels} channels · {one.users} team {one.users === 1 ? "member" : "members"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {security && !security.canManage && action !== "buy-new" ? (
        <ErrorNotice message="You need Subscription & billing Manage permission to change this workspace plan." />
      ) : null}

      <SettingsGroup title="Payment">
        <View style={{ padding: 12, gap: 10 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Choice selected={method === "payway"} title="ABA PayWay" detail="ABA Pay or KHQR" onPress={() => setMethod("payway")} />
            </View>
            {catalog?.manualPayment.enabled ? (
              <View style={{ flex: 1 }}>
                <Choice selected={method === "manual"} title="Bank transfer" detail="Upload payment proof" onPress={() => setMethod("manual")} />
              </View>
            ) : null}
          </View>

          {method === "manual" && catalog?.manualPayment.enabled ? (
            <View style={{ gap: 10 }}>
              {catalog.manualPayment.qrImageUrl ? (
                <Image source={{ uri: catalog.manualPayment.qrImageUrl }} resizeMode="contain" style={{ width: "100%", height: 210, borderRadius: 12, backgroundColor: "white" }} />
              ) : null}
              <Text style={styles.heading}>{catalog.manualPayment.bankName}</Text>
              <Text style={styles.muted}>{catalog.manualPayment.accountName} · {catalog.manualPayment.accountNumber}</Text>
              {catalog.manualPayment.supportText ? <Text style={styles.muted}>{catalog.manualPayment.supportText}</Text> : null}
              <Pressable onPress={() => void pickProof()} style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 9 }}>
                <Ionicons name="cloud-upload-outline" size={19} color={colors.blue} />
                <Text numberOfLines={1} style={{ flex: 1, color: colors.ink, fontWeight: "700" }}>
                  {proof?.name ?? "Choose receipt image or PDF"}
                </Text>
              </Pressable>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Payment note (optional)"
                placeholderTextColor={colors.muted}
                multiline
                style={{ minHeight: 76, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, color: colors.ink, textAlignVertical: "top" }}
              />
            </View>
          ) : null}

          {manualRequest ? (
            <View style={{ padding: 11, borderRadius: 12, backgroundColor: manualRequest.status === "approved" ? "#E7F6EE" : manualRequest.status === "rejected" ? "#FFF1EF" : "#FFF7E6" }}>
              <Text style={{ color: colors.ink, fontWeight: "800" }}>Payment proof {manualRequest.status}</Text>
              <Text style={[styles.muted, { marginTop: 3 }]}>{manualRequest.proofFileName}</Text>
              {manualRequest.reviewNote ? <Text style={[styles.muted, { marginTop: 3 }]}>{manualRequest.reviewNote}</Text> : null}
            </View>
          ) : null}

          {paymentState !== "idle" ? (
            <View style={{ padding: 11, borderRadius: 12, backgroundColor: paymentState === "approved" ? "#E7F6EE" : paymentState === "waiting" || paymentState === "pending" ? "#FFF7E6" : "#FFF1EF" }}>
              <Text style={{ color: colors.ink, fontWeight: "800" }}>ABA PayWay: {paymentState}</Text>
              {transactionId ? <Text style={[styles.muted, { marginTop: 3 }]}>Transaction {transactionId}</Text> : null}
            </View>
          ) : null}

          <Pressable
            disabled={busy || action === "current" || action === "blocked" || (method === "manual" && !proof)}
            onPress={() => method === "payway" ? void startPayWay() : void submitManual()}
            style={({ pressed }) => ({
              minHeight: 48,
              borderRadius: 13,
              alignItems: "center",
              justifyContent: "center",
              opacity: action === "current" || action === "blocked" || (method === "manual" && !proof) ? 0.45 : 1,
              backgroundColor: pressed ? "#0873AD" : colors.blue,
            })}
          >
            {busy ? <ActivityIndicator color="white" /> : <Text style={{ color: "white", fontSize: 15, fontWeight: "800" }}>{method === "manual" ? `Submit ${money(amount)} proof` : buttonTitle}</Text>}
          </Pressable>

          {transactionId && ["waiting", "pending"].includes(paymentState) ? (
            <Pressable disabled={busy} onPress={() => void cancelPayment()} style={{ alignItems: "center", padding: 9 }}>
              <Text style={{ color: colors.red, fontWeight: "700" }}>Cancel pending payment</Text>
            </Pressable>
          ) : null}
        </View>
      </SettingsGroup>

      <Modal visible={Boolean(checkout)} animationType="slide" onRequestClose={() => setCheckout(null)}>
        <View style={{ flex: 1, backgroundColor: "white", paddingTop: insets.top }}>
          <View style={[styles.header, styles.row]}>
            <IconButton icon="close" label="Close payment" onPress={() => setCheckout(null)} />
            <View style={{ flex: 1 }}>
              <Text style={styles.heading}>ABA PayWay</Text>
              <Text style={[styles.muted, { fontSize: 12 }]}>Secure checkout · {money(amount)}</Text>
            </View>
          </View>
          {checkout ? (
            <WebView
              originWhitelist={["https://*", "http://*", "about:blank"]}
              source={{ html: checkoutHtml(checkout), baseUrl: "https://checkout.payway.com.kh" }}
              javaScriptEnabled
              domStorageEnabled
              thirdPartyCookiesEnabled
              sharedCookiesEnabled
              setSupportMultipleWindows={false}
              onShouldStartLoadWithRequest={(request) => {
                const url = request.url;
                if (url.includes("/api/payway/cancel-return")) {
                  void cancelPayment();
                  return false;
                }
                if (url.includes("/dashboard/subscription")) {
                  setCheckout(null);
                  return false;
                }
                if (!/^https?:|^about:/i.test(url)) {
                  void Linking.openURL(url).catch(() => undefined);
                  return false;
                }
                return true;
              }}
              onError={() => setError("Unable to display ABA PayWay checkout.")}
            />
          ) : null}
        </View>
      </Modal>
    </SettingsScreen>
  );
}
