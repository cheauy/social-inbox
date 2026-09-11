import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { File as FileSystemFile } from "expo-file-system";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePreventRemove } from "expo-router/react-navigation";
import { WebView } from "react-native-webview";
import { SettingsGroup, SettingsScreen } from "../settings-screen";
import { ErrorNotice, IconButton, colors, styles } from "../ui";
import { api } from "../../lib/api/client";
import { useInbox } from "../../lib/inbox-provider";
import { supabase } from "../../lib/supabase/client";
import { matchesUpgradeQuote, renewalSelection, type UpgradeQuote } from "../../lib/billing-selection";
type FixedPlanCode = "mini" | "standard" | "pro";
type PlanCode = FixedPlanCode | "custom";
type BillingCycle = "monthly" | "3-months" | "6-months" | "12-months";
type PaymentMethod = "payway" | "manual";
type PaymentState = "idle" | "waiting" | "approved" | "pending" | "declined" | "cancelled" | "failed";
type Plan = {
  id: FixedPlanCode;
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
  custom: {
    extraConnectionCents: number;
    extraUserCents: number;
    minConnections: number;
    maxConnections: number;
    minUsers: number;
    maxUsers: number;
  };
  manualPayment: ManualConfig;
};
type Subscription = {
  id: string;
  business_id: string;
  status: string;
  plan_code: string | null;
  billing_cycle: string | null;
  current_period_end: string | null;
  current_period_start: string | null;
  trial_started_at: string | null;
  last_paid_amount: number | null;
  pricing_snapshot: { renewal_total_cents?: number } | null;
  payment_provider: string | null;
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
function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
function total(plan: Plan, cycle: Cycle) {
  return Math.round(plan.monthlyCents * cycle.months * (1 - cycle.discount));
}
function customMonthly(connections: number, users: number, catalog: Catalog) {
  return Math.min(
    ...catalog.plans.map(
      (plan) =>
        plan.monthlyCents +
        Math.max(0, connections - plan.channels) * catalog.custom.extraConnectionCents +
        Math.max(0, users - plan.users) * catalog.custom.extraUserCents,
    ),
  );
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
function CapacityChoice({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <View style={[styles.row, { paddingVertical: 6 }]}>
      <Text style={{ flex: 1, color: colors.ink, fontWeight: "700" }}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove one ${label.toLowerCase()}`}
        disabled={value <= min}
        onPress={() => onChange(Math.max(min, value - 1))}
        style={{ width: 36, height: 36, borderRadius: 11, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", opacity: value <= min ? 0.4 : 1 }}
      >
        <Ionicons name="remove" size={18} color={colors.blue} />
      </Pressable>
      <Text style={{ width: 38, textAlign: "center", color: colors.ink, fontSize: 16, fontWeight: "900" }}>{value}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add one ${label.toLowerCase()}`}
        disabled={value >= max}
        onPress={() => onChange(Math.min(max, value + 1))}
        style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: colors.pale, alignItems: "center", justifyContent: "center", opacity: value >= max ? 0.4 : 1 }}
      >
        <Ionicons name="add" size={18} color={colors.blue} />
      </Pressable>
    </View>
  );
}
export function SubscriptionFlow({ page }: { page: "overview" | "plans" | "payment" }) {
  const params = useLocalSearchParams<{ intent?: string; businessId?: string; plan?: string; cycle?: string; connections?: string; users?: string }>();
  const intent = params.intent === "upgrade" || params.intent === "reactivate" || params.intent === "subscribe" ? params.intent : "buy-new";
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    workspace,
    workspaces,
    loadWorkspaces,
    refreshAlerts,
    settingsRevision,
  } = useInbox();
  // Capture the billing target at entry; do not follow the global inbox selection.
  const [billingId, setBillingId] = useState<string | null>(params.businessId || workspace?.businessId || null);
  const billingWorkspace = workspaces.find((one) => one.businessId === billingId);
  const [quote, setQuote] = useState<UpgradeQuote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const operation = useRef(false);
  const paymentPending = useRef(false);
  const loadVersion = useRef(0);
  const loadedOnce = useRef(false);
  const [loadError, setLoadError] = useState("");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [current, setCurrent] = useState<CurrentResponse | null>(null);
  const [security, setSecurity] = useState<PlanChange | null>(null);
  const [manualRequest, setManualRequest] = useState<ManualRequest | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<PlanCode>(intent === "upgrade" ? "custom" : ["mini", "standard", "pro", "custom"].includes(params.plan || "") ? params.plan as PlanCode : "mini");
  const [selectedCycle, setSelectedCycle] = useState<BillingCycle>(["monthly", "3-months", "6-months", "12-months"].includes(params.cycle || "") ? params.cycle as BillingCycle : "monthly");
  const [customConnections, setCustomConnections] = useState(Math.max(3, Math.min(30, Number(params.connections) || 3)));
  const [customUsers, setCustomUsers] = useState(Math.max(1, Math.min(100, Number(params.users) || 1)));
  const [method, setMethod] = useState<PaymentMethod>("payway");
  const [proof, setProof] = useState<Proof | null>(null);
  const [note, setNote] = useState("");
  const [checkoutVisible, setCheckoutVisible] = useState(false);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [purchaseBusinessId, setPurchaseBusinessId] = useState<string | null>(null);
  const [paymentState, setPaymentState] = useState<PaymentState>("idle");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const approved = useRef(false);
  const submittedManualId = useRef<string | null>(null);
  const initializedSelection = useRef(page === "payment");
  const load = useCallback(async (quiet = false) => {
    if (page === "payment" && (approved.current || paymentPending.current || operation.current)) return;
    const version = ++loadVersion.current;
    if (!quiet) setLoading(true);
    try {
      const planCatalog = await api<Catalog>("/api/subscription/catalog", billingId);
      if (version !== loadVersion.current) return;
      setCatalog(planCatalog);
      if (!billingId || (intent === "buy-new" && page !== "overview")) {
        setCurrent(null);
        setSecurity(null);
        setLoadError("");
        return;
      }
      const [subscription, planState, manual] = await Promise.all([
        api<CurrentResponse>("/api/subscription/current", billingId),
        api<PlanChange>("/api/subscription/plan-change", billingId),
        api<{ request: ManualRequest | null }>("/api/manual-payments", billingId).catch(() => ({ request: null })),
      ]);
      if (version !== loadVersion.current) return;
      setCurrent(subscription);
      setSecurity(planState);
      setManualRequest(manual.request ?? null);
      if (!initializedSelection.current && intent !== "buy-new") {
        const savedPlan = subscription.subscription?.plan_code;
        const savedCycle = subscription.subscription?.billing_cycle;
        if (savedPlan === "mini" || savedPlan === "standard" || savedPlan === "pro" || savedPlan === "custom") {
          if (intent !== "upgrade") setSelectedPlan(savedPlan);
        }
        if (savedCycle === "monthly" || savedCycle === "3-months" || savedCycle === "6-months" || savedCycle === "12-months") {
          setSelectedCycle(savedCycle);
        }
        setCustomConnections(subscription.subscription?.channel_limit ?? 3);
        setCustomUsers(subscription.subscription?.member_limit ?? 1);
        initializedSelection.current = true;
      }
      setLoadError("");
    } catch (reason) {
      if (version === loadVersion.current) setLoadError(reason instanceof Error ? reason.message : "Unable to load subscription.");
    } finally {
      if (version === loadVersion.current) { loadedOnce.current = true; setLoading(false); }
    }
  }, [billingId, intent, page]);
  useFocusEffect(useCallback(() => { void load(loadedOnce.current); }, [load]));
  const seenRevision = useRef(settingsRevision);
  useEffect(() => {
    if (seenRevision.current === settingsRevision) return;
    seenRevision.current = settingsRevision;
    void load(true);
  }, [settingsRevision, load]);
  useEffect(() => {
    if (manualRequest?.status === "submitted") submittedManualId.current = manualRequest.id;
    if (manualRequest?.status === "approved" && submittedManualId.current === manualRequest.id) {
      const target = purchaseBusinessId ?? billingId;
      if (target) void completePurchase(target);
    }
  }, [manualRequest, purchaseBusinessId, billingId]);
  useEffect(() => {
    if (manualRequest?.status !== "submitted") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const target = purchaseBusinessId ?? billingId;
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
  }, [manualRequest?.status, purchaseBusinessId, billingId]);
  async function completePurchase(targetBusinessId: string) {
    if (approved.current) return;
    approved.current = true;
    setPurchaseBusinessId(targetBusinessId);
    setPaymentState("approved");
    setCheckout(null);
    await Promise.allSettled([loadWorkspaces(), refreshAlerts()]);
    // Keep the receipt visible; switching into a new workspace is an explicit action.
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
        if (["declined", "cancelled", "failed"].includes(result.paymentState)) { setCheckout(null); return; }
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
  const customMonthlyCents = catalog
    ? customMonthly(customConnections, customUsers, catalog)
    : 0;
  const fullAmount = cycle
    ? selectedPlan === "custom"
      ? Math.round(customMonthlyCents * cycle.months * (1 - cycle.discount))
      : plan
        ? total(plan, cycle)
        : 0
    : 0;
  const subscription = current?.subscription ?? null;
  const renewal = renewalSelection(subscription, security?.isOwner ?? false);
  const renewalAmount = renewal?.amount ?? 0;
  const expired = Boolean(subscription && (["expired", "past_due", "cancelled"].includes(subscription.status) || (subscription.status === "active" && subscription.current_period_end && Date.parse(subscription.current_period_end) <= Date.now())));
  const canReactivate = Boolean(renewal);
  const matchingRenewal = Boolean(renewal && selectedPlan === renewal.planCode && selectedCycle === renewal.billingCycle
    && (selectedPlan !== "custom" || (customConnections === renewal.connections && customUsers === renewal.users)));
  const quoteMatches = matchesUpgradeQuote(quote, customConnections, customUsers, selectedCycle);
  const capacityFits = !current || (current.usage.channels <= (selectedPlan === "custom" ? customConnections : plan?.channels ?? 0)
    && current.usage.members <= (selectedPlan === "custom" ? customUsers : plan?.users ?? 0));
  const action = intent === "buy-new" ? "buy-new"
    : intent === "reactivate" ? canReactivate ? "reactivate" : "blocked"
    : intent === "upgrade" ? security?.canManage && security.mode === "active-paid" ? "upgrade" : "blocked"
    : security?.isOwner && security.mode === "subscribe" ? "subscribe" : "blocked";
  const selectionError = intent === "reactivate" && !matchingRenewal ? "The saved subscription has changed. Return to Subscription and select Reactivate again."
    : intent === "subscribe" && !capacityFits ? "Choose enough connections and team members for this workspace." : "";
  const amount = intent === "reactivate" ? renewalAmount : intent === "upgrade" ? quote?.totalCents ?? 0 : fullAmount;
  const selectedName = selectedPlan === "custom" ? "Custom" : plan?.name ?? "TENH";
  const selectionBody = {
    planCode: intent === "upgrade" ? "custom" : selectedPlan, billingCycle: selectedCycle,
    ...(selectedPlan === "custom" ? { connections: customConnections, users: customUsers } : {}),
    ...(intent === "upgrade" ? { customUpgrade: true } : {}),
    ...(intent === "reactivate" ? { renewSame: true } : {}),
  };
  useEffect(() => {
    if (intent !== "upgrade" || !billingId || !catalog || loading) return;
    const controller = new AbortController();
    setQuote(null);
    setQuoteLoading(true);
    setQuoteError("");
    const timer = setTimeout(async () => {
      try {
        const query = new URLSearchParams({ business_id: billingId, connections: String(customConnections), users: String(customUsers), cycle: selectedCycle });
        const result = await api<{ quote: UpgradeQuote }>(`/api/subscription/custom-upgrade/quote?${query}`, billingId, { signal: controller.signal });
        if (!controller.signal.aborted) setQuote(result.quote);
      } catch (reason) {
        if (!controller.signal.aborted) setQuoteError(reason instanceof Error ? reason.message : "Unable to quote upgrade.");
      } finally {
        if (!controller.signal.aborted) setQuoteLoading(false);
      }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [intent, billingId, catalog, loading, customConnections, customUsers, selectedCycle]);
  function openPlans(nextIntent: "buy-new" | "upgrade" | "subscribe") {
    router.push({ pathname: "/settings/subscription-plans", params: { intent: nextIntent, businessId: billingId || "" } });
  }
  function continuePayment(reactivate = false) {
    if (loading || loadError || (reactivate ? !canReactivate : Boolean(selectionError) || action === "blocked" || (intent === "upgrade" && (!quoteMatches || quoteLoading)))) return;
    if (!catalog || (!reactivate && intent === "upgrade" && (!quote || quoteLoading))) return;
    router.push({ pathname: "/settings/subscription-payment", params: {
      intent: reactivate ? "reactivate" : intent,
      businessId: billingId || "",
      plan: reactivate ? subscription!.plan_code! : selectedPlan,
      cycle: reactivate ? subscription!.billing_cycle! : selectedCycle,
      connections: String(reactivate ? subscription!.channel_limit : customConnections),
      users: String(reactivate ? subscription!.member_limit : customUsers),
    } });
  }
  async function ensureTarget() {
    if (action !== "buy-new") {
      if (!billingId) throw new Error("Select the subscription first.");
      return billingId;
    }
    if (purchaseBusinessId) return purchaseBusinessId;
    const created = await api<{ businessId: string }>(
      "/api/workspaces/create-subscription",
      billingId,
      {
        method: "POST",
        body: selectionBody,
      },
    );
    setPurchaseBusinessId(created.businessId);
    return created.businessId;
  }
  async function startPayWay() {
    if (purchaseDisabled || (!plan && selectedPlan !== "custom") || !cycle) return;
    if (operation.current) return;
    operation.current = true;
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
          ...selectionBody,
          paymentMethod: "abapay_khqr",
          purchaseBusinessId: target,
        },
      });
      setPurchaseBusinessId(target);
      setTransactionId(result.transactionId);
      setPaymentState("waiting");
      setCheckoutVisible(true);
      setCheckout({
        url: result.checkoutUrl,
        fields: result.fields,
        transactionId: result.transactionId,
        businessId: target,
      });
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Unable to start payment.");
    } finally {
      operation.current = false;
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
    const size = asset.size ?? new FileSystemFile(asset.uri).size;
    if (size > 10 * 1024 * 1024) {
      setProof(null);
      setError("Payment proof must be 10 MB or smaller.");
      return;
    }
    setError("");
    setProof({
      uri: asset.uri,
      name: asset.name || "payment-proof",
      mimeType: asset.mimeType || "application/octet-stream",
      size,
    });
  }
  async function submitManual() {
    if (purchaseDisabled || !catalog?.manualPayment.enabled || (!plan && selectedPlan !== "custom") || !cycle || !proof) return;
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      const target = await ensureTarget();
      const common = {
        ...selectionBody,
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
          await file.arrayBuffer(),
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
      operation.current = false;
      setBusy(false);
    }
  }
  async function cancelPayment() {
    if (!transactionId || !purchaseBusinessId || busy || operation.current) return;
    operation.current = true;
    setError("");
    setBusy(true);
    setCheckoutVisible(false);
    try {
      const result = await api<{ paymentState: PaymentState }>(
        "/api/payway/cancel-return",
        purchaseBusinessId,
        { method: "POST", body: { transactionId } },
      );
      setPaymentState(result.paymentState);
      setCheckout(null);
      if (result.paymentState === "approved") await completePurchase(purchaseBusinessId);
      else await loadWorkspaces();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Unable to cancel payment.");
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }
  const buttonTitle = `Pay ${money(amount)}`;
  const ends = subscription?.status === "trialing"
    ? subscription.trial_ends_at ?? subscription.current_period_end
    : subscription?.current_period_end ?? null;
  const pendingPurchase =
    manualRequest?.status === "submitted" ||
    (Boolean(transactionId) && ["waiting", "pending"].includes(paymentState));
  paymentPending.current = pendingPurchase;
  const purchaseDisabled =
    busy || loading || Boolean(loadError) || Boolean(selectionError) || amount <= 0 || paymentState === "approved" ||
    (intent === "upgrade" && (!quoteMatches || quoteLoading || Boolean(quoteError))) ||
    pendingPurchase ||
    action === "blocked" ||
    (method === "manual" && (!proof || !catalog?.manualPayment.enabled));
  usePreventRemove(page === "payment" && (busy || (Boolean(transactionId) && ["waiting", "pending"].includes(paymentState))), () => {
    Alert.alert("Payment in progress", busy ? "Please wait while the payment request finishes." : "Wait for verification or cancel the pending ABA payment before returning to plans.");
  });
  return (
    <SettingsScreen
      title={page === "overview" ? "Subscription" : page === "plans" ? intent === "upgrade" ? "Upgrade subscription" : "Choose a plan" : "Payment summary"}
      detail={intent === "buy-new" && page !== "overview" ? "New TENH subscription" : billingWorkspace?.businessName ?? "TENH Chat"}
      allowWithoutWorkspace
      loading={loading}
      error={loadError || error}
      onRetry={() => { setError(""); void load(); }}
      skeleton={[3, 3, 4]}
    >
      {page === "overview" ? <>
      {subscription ? (
        <SettingsGroup title="Current subscription">
          <View style={{ padding: 14, gap: 10 }}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.heading, { fontSize: 18 }]}>
                  {catalog?.plans.find((one) => one.id === subscription.plan_code)?.name ?? subscription.plan_code ?? "TENH plan"}
                </Text>
                <Text style={styles.muted}>{catalog?.cycles.find((one) => one.id === subscription.billing_cycle)?.label ?? "No billing period"}</Text>
              </View>
              <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: !expired && ["active", "trialing"].includes(subscription.status) ? "#E7F6EE" : "#FFF1EF" }}>
                <Text style={{ fontSize: 11, fontWeight: "800", textTransform: "uppercase", color: !expired && ["active", "trialing"].includes(subscription.status) ? "#2FA36B" : colors.red }}>
                  {expired ? "expired" : subscription.status}
                </Text>
              </View>
            </View>
            <Text style={styles.muted}>Started {formatDate(subscription.current_period_start ?? subscription.trial_started_at)}</Text>
            <Text style={{ color: expired ? colors.red : colors.ink, fontWeight: "700" }}>Expires {formatDate(ends)}</Text>
            <Text style={styles.muted}>Payment: {subscription.payment_provider ?? "—"}</Text>
            <Text style={styles.muted}>
              {current?.usage.channels ?? 0} of {subscription.channel_limit ?? "∞"} channels · {current?.usage.members ?? 0} of {subscription.member_limit ?? "∞"} members
            </Text>
          </View>
        </SettingsGroup>
      ) : null}
      {!subscription ? <Text style={styles.muted}>No current subscription. Choose a plan to get started.</Text> : null}
      {workspaces.length > 1 ? <SettingsGroup title="Your subscriptions"><View style={{ padding: 12, gap: 8 }}>
        {workspaces.map((one) => <Choice key={one.businessId} selected={billingId === one.businessId} title={one.businessName} detail={one.subscriptionOperational ? "Active" : "Expired or awaiting payment"} onPress={() => {
          if (billingId === one.businessId) return;
          initializedSelection.current = false;
          loadedOnce.current = false;
          approved.current = false;
          submittedManualId.current = null;
          setLoading(true);
          setCurrent(null);
          setSecurity(null);
          setManualRequest(null);
          setPurchaseBusinessId(null);
          setPaymentState("idle");
          setBillingId(one.businessId);
        }} />)}
      </View></SettingsGroup> : null}
      {security?.canManage && security.mode === "active-paid" ? <Choice selected={false} title="Upgrade subscription" detail="Add connections, team members or time" onPress={() => openPlans("upgrade")} /> : null}
      {canReactivate ? <Choice selected={false} title="Reactivate Same Subscription" detail={`${money(renewalAmount)} · Keep your previous plan and limits`} onPress={() => continuePayment(true)} /> : null}
      {security?.isOwner && security.mode === "subscribe" && !canReactivate ? <Choice selected={false} title="Activate this workspace" onPress={() => openPlans("subscribe")} /> : null}
      {manualRequest?.status === "submitted" ? <View style={{ padding: 14, borderRadius: 14, backgroundColor: "#FFF7E6", gap: 5 }}><Text style={{ color: colors.ink, fontWeight: "800" }}>Bank transfer under review</Text><Text style={styles.muted}>Your subscription updates after approval.</Text></View> : null}
      <Choice selected title="Buy Subscription" detail="Choose a plan for a new workspace" onPress={() => openPlans("buy-new")} />
      </> : null}
      {page === "plans" ? <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Image source={require("../../assets/tenh-logo.png")} style={{ width: 44, height: 44 }} resizeMode="contain" />
        <View style={{ flex: 1 }}><Text style={[styles.heading, { fontSize: 21 }]}>A plan for your team</Text><Text style={styles.muted}>Choose your capacity and billing duration.</Text></View>
      </View>
      <SettingsGroup title="Billing period">
        <View style={{ padding: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {(catalog?.cycles ?? []).filter((one) => intent !== "upgrade" || one.months >= (catalog?.cycles.find((item) => item.id === subscription?.billing_cycle)?.months ?? 1)).map((one) => (
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
        {(intent === "upgrade" ? [] : catalog?.plans ?? []).map((one) => {
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
              <View style={[styles.row, { justifyContent: "space-between" }]}>
                <View style={{ padding: 10, borderRadius: 14, backgroundColor: "#EAF3FF" }}><Ionicons name={one.id === "mini" ? "rocket-outline" : one.id === "standard" ? "people-outline" : "diamond-outline"} size={26} color={colors.blue} /></View>
                {one.id === "standard" ? <Text style={{ backgroundColor: colors.blue, color: "white", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, fontSize: 10, fontWeight: "900" }}>★ POPULAR</Text> : null}
                <Ionicons name={selected ? "checkmark-circle" : "ellipse-outline"} size={23} color={selected ? colors.blue : colors.border} />
              </View>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.heading, { fontSize: 21 }]}>{one.name}</Text>
                  <Text style={[styles.muted, { fontSize: 12.5, lineHeight: 18 }]}>{one.description}</Text>
                </View>
                <Text style={{ color: colors.blue, fontSize: 17, fontWeight: "900" }}>
                  {money(catalog?.cycles.find((item) => item.id === selectedCycle) ? total(one, catalog!.cycles.find((item) => item.id === selectedCycle)!) : one.monthlyCents)}
                </Text>
              </View>
              <Text style={{ color: colors.ink, fontSize: 13, fontWeight: "600" }}>
                {one.channels} connections · {one.users} team {one.users === 1 ? "member" : "members"}
              </Text>
              <Text style={[styles.muted, { fontSize: 12 }]}>Total for {cycle?.label.toLowerCase() ?? "one month"} · {money(cycle ? Math.round(total(one, cycle) / cycle.months) : one.monthlyCents)}/month</Text>
            </Pressable>
          );
        })}
        {catalog ? (
          <Pressable
            onPress={() => setSelectedPlan("custom")}
            style={({ pressed }) => ({
              padding: 15,
              gap: 8,
              borderRadius: 16,
              borderWidth: selectedPlan === "custom" ? 2 : 1,
              borderColor: selectedPlan === "custom" ? colors.blue : colors.border,
              backgroundColor: selectedPlan === "custom" ? colors.pale : pressed ? "#F8FAFC" : "white",
            })}
          >
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.heading, { fontSize: 17 }]}>Custom</Text>
                <Text style={[styles.muted, { fontSize: 12.5, lineHeight: 18 }]}>Choose your own connection and team limits.</Text>
              </View>
              <Text style={{ color: colors.blue, fontSize: 17, fontWeight: "900" }}>
                {money(cycle ? Math.round(customMonthlyCents * cycle.months * (1 - cycle.discount)) : customMonthlyCents)}
              </Text>
            </View>
            {selectedPlan === "custom" ? (
              <View style={{ marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
                <CapacityChoice
                  label="Connections"
                  value={customConnections}
                  min={intent === "upgrade" ? subscription?.channel_limit ?? catalog.custom.minConnections : catalog.custom.minConnections}
                  max={catalog.custom.maxConnections}
                  onChange={setCustomConnections}
                />
                <CapacityChoice
                  label="Team members"
                  value={customUsers}
                  min={intent === "upgrade" ? subscription?.member_limit ?? catalog.custom.minUsers : catalog.custom.minUsers}
                  max={catalog.custom.maxUsers}
                  onChange={setCustomUsers}
                />
                <Text style={[styles.muted, { fontSize: 11.5, marginTop: 3 }]}>{intent === "upgrade" ? "Your current subscription is updated only after payment approval." : "Choose the capacity that fits your team."}</Text>
              </View>
            ) : null}
          </Pressable>
        ) : null}
      </View>
      <ErrorNotice message={quoteError || selectionError} />
      {intent === "upgrade" ? <Text style={styles.muted}>{quoteLoading ? "Calculating upgrade…" : quote ? `Due today ${money(quote.totalCents)} · New expiry ${formatDate(quote.newPeriodEnd)}` : "Increase capacity or duration to continue."}</Text> : null}
      <Pressable disabled={loading || Boolean(loadError) || Boolean(selectionError) || action === "blocked" || (intent === "upgrade" && (!quoteMatches || quoteLoading))} onPress={() => continuePayment()} style={{ backgroundColor: colors.blue, padding: 16, borderRadius: 14, alignItems: "center", opacity: intent === "upgrade" && (!quoteMatches || quoteLoading) ? 0.5 : 1 }}>
        <Text style={{ color: "white", fontWeight: "800", fontSize: 16 }}>Continue payment</Text>
      </Pressable>
      </> : null}
      {page === "payment" ? <>
      <View style={{ backgroundColor: "#102342", borderRadius: 22, padding: 20, gap: 16 }}>
        <Image source={require("../../assets/tenh-logo.png")} style={{ width: 42, height: 42 }} resizeMode="contain" />
        <Text style={{ color: "#ADC7EF", fontSize: 12, fontWeight: "800", textTransform: "uppercase" }}>{intent === "upgrade" ? "Upgrade summary" : intent === "reactivate" ? "Reactivation summary" : "New subscription summary"}</Text>
        <Text style={{ color: "white", fontSize: 26, fontWeight: "900" }}>{selectedName}</Text>
        <Text style={{ color: "white", fontSize: 34, fontWeight: "900" }}>{quoteLoading ? "…" : money(amount)} <Text style={{ fontSize: 13 }}>USD</Text></Text>
        {[
          ["Workspace", intent === "buy-new" ? "New workspace" : billingWorkspace?.businessName ?? billingId ?? "—"],
          ["Connections", String(intent === "reactivate" ? renewal?.connections ?? "—" : selectedPlan === "custom" ? customConnections : plan?.channels ?? "—")],
          ["Team members", String(intent === "reactivate" ? renewal?.users ?? "—" : selectedPlan === "custom" ? customUsers : plan?.users ?? "—")],
          ["Billing duration", cycle?.label ?? selectedCycle],
          ...(quote ? [["Capacity upgrade", money(quote.capacityProrationCents)], ["Added duration", money(quote.durationExtensionCents)], ["Next renewal", money(quote.renewalTotalCents)], ["Expiry", formatDate(quote.newPeriodEnd)], ["Remaining paid time", `${quote.remainingDays} days`]] : []),
        ].map(([label, value]) => <View key={label} style={{ flexDirection: "row", justifyContent: "space-between", gap: 16 }}><Text style={{ color: "#ADC7EF" }}>{label}</Text><Text style={{ color: "white", fontWeight: "700", flex: 1, textAlign: "right" }}>{value}</Text></View>)}
        <Text style={{ color: "#ADC7EF", fontSize: 12, lineHeight: 18 }}>One-time payment for this period. Activation follows verified payment approval.</Text>
      </View>
      <ErrorNotice message={selectionError || quoteError || (action === "blocked" ? "This subscription cannot be changed with your current access or status. Return to Subscription to refresh it." : "")} />
      <SettingsGroup title="Payment">
        <View style={{ padding: 12, gap: 10 }}>
          {(["payway", "manual"] as const).map((option) => {
            const disabled = busy || pendingPurchase || paymentState === "approved" || (option === "manual" && !catalog?.manualPayment.enabled);
            return <Pressable key={option} disabled={disabled} onPress={() => setMethod(option)} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: method === option ? colors.blue : colors.border, backgroundColor: method === option ? colors.pale : "white", opacity: disabled ? 0.5 : 1 }}>
              {option === "payway" ? <Image source={require("../../assets/aba-khqr.png")} style={{ width: 54, height: 54, borderRadius: 12 }} resizeMode="contain" /> : <View style={{ width: 54, height: 54, backgroundColor: colors.blue, borderRadius: 12, alignItems: "center", justifyContent: "center" }}><Ionicons name="business-outline" size={27} color="white" /></View>}
              <View style={{ flex: 1 }}><Text style={{ color: colors.ink, fontSize: 15, fontWeight: "800" }}>{option === "payway" ? "ABA KHQR" : "Manual bank transfer"}</Text><Text style={[styles.muted, { fontSize: 12, marginTop: 4 }]}>{option === "payway" ? "Scan with any banking app" : catalog?.manualPayment.enabled ? "Transfer and upload your receipt" : "Currently unavailable"}</Text></View>
              <Ionicons name={method === option ? "checkmark-circle" : "ellipse-outline"} size={23} color={method === option ? colors.blue : colors.border} />
            </Pressable>;
          })}
          {method === "manual" && catalog?.manualPayment.enabled ? (
            <View style={{ gap: 10 }}>
              {catalog.manualPayment.qrImageUrl ? (
                <Image source={{ uri: new URL(catalog.manualPayment.qrImageUrl, process.env.EXPO_PUBLIC_TENH_API_URL || "https://app.tenhchat.com").href }} resizeMode="contain" style={{ width: "100%", height: 210, borderRadius: 12, backgroundColor: "white" }} />
              ) : null}
              <Text style={styles.heading}>{catalog.manualPayment.bankName}</Text>
              <Text style={styles.muted}>{catalog.manualPayment.accountName} · {catalog.manualPayment.accountNumber}</Text>
              {catalog.manualPayment.supportText ? <Text style={styles.muted}>{catalog.manualPayment.supportText}</Text> : null}
              <Pressable disabled={busy || pendingPurchase || paymentState === "approved"} onPress={() => void pickProof().catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to open receipt."))} style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", gap: 9 }}>
                <Ionicons name="cloud-upload-outline" size={19} color={colors.blue} />
                <Text numberOfLines={1} style={{ flex: 1, color: colors.ink, fontWeight: "700" }}>
                  {proof?.name ?? "Choose receipt image or PDF"}
                </Text>
              </Pressable>
              <TextInput
                editable={!busy && !pendingPurchase && paymentState !== "approved"}
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
              <Text style={{ color: colors.ink, fontWeight: "800" }}>{manualRequest?.status === "approved" ? "Subscription" : "ABA PayWay"}: {paymentState}</Text>
              {transactionId ? <Text style={[styles.muted, { marginTop: 3 }]}>Transaction {transactionId}</Text> : null}
            </View>
          ) : null}
          <Pressable
            disabled={purchaseDisabled}
            onPress={() => method === "payway" ? void startPayWay() : void submitManual()}
            style={({ pressed }) => ({
              minHeight: 48,
              borderRadius: 13,
              alignItems: "center",
              justifyContent: "center",
              opacity: purchaseDisabled ? 0.45 : 1,
              backgroundColor: pressed ? "#0873AD" : colors.blue,
            })}
          >
            {busy ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={{ color: "white", fontSize: 15, fontWeight: "800" }}>
                {pendingPurchase
                  ? manualRequest?.status === "submitted"
                    ? "Waiting for payment review"
                    : "Verifying ABA PayWay payment"
                  : paymentState === "approved" ? "Payment approved" : method === "manual"
                    ? `Submit ${money(amount)} proof`
                    : buttonTitle}
              </Text>
            )}
          </Pressable>
          {checkout && !checkoutVisible && ["waiting", "pending"].includes(paymentState) ? <Choice selected={false} title="Reopen ABA checkout" onPress={() => setCheckoutVisible(true)} /> : null}
          {transactionId && ["waiting", "pending"].includes(paymentState) ? (
            <Pressable disabled={busy} onPress={() => void cancelPayment()} style={{ alignItems: "center", padding: 9 }}>
              <Text style={{ color: colors.red, fontWeight: "700" }}>Cancel pending payment</Text>
            </Pressable>
          ) : null}
        </View>
      </SettingsGroup>
      {paymentState === "approved" ? <Choice selected title="View subscription" onPress={() => router.replace({ pathname: "/settings/subscription", params: { businessId: purchaseBusinessId || billingId || "" } })} /> : null}
      </> : null}
      <Modal visible={Boolean(checkout) && checkoutVisible} animationType="slide" onRequestClose={() => setCheckoutVisible(false)}>
        <View style={{ flex: 1, backgroundColor: "white", paddingTop: insets.top }}>
          <View style={[styles.header, styles.row]}>
            <IconButton icon="close" label="Close payment" onPress={() => setCheckoutVisible(false)} />
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
                  setCheckoutVisible(false);
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
