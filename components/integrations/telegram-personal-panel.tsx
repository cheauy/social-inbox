"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useWorkspaceLanguageId } from "@/components/display/workspace-language-text";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";

type TeamAccess = "holder_only" | "owners" | "all_inbox_members" | "selected_members";

type PersonalConnection = {
  id: string;
  kind: "telegram_personal";
  status: string;
  loginMethod: "qr" | "phone";
  displayName: string | null;
  username: string | null;
  phoneMasked: string | null;
  teamAccess: TeamAccess;
  lastErrorCode: string | null;
  connectedAt: string | null;
  isHolder: boolean;
  can: { useLogin: boolean; pause: boolean; resume: boolean; disconnect: boolean; setTeamAccess: boolean };
};

type ListResponse = {
  success: boolean;
  enabled?: boolean;
  configured?: boolean;
  canConnect?: boolean;
  connections?: PersonalConnection[];
  error?: string;
};

type LoginState = {
  status: string;
  method: "qr" | "phone";
  qr: string | null;
  passwordHint: string | null;
  deadlineAt: string | null;
  errorCode: string | null;
};

const OPEN_LOGIN = ["connecting", "waiting_phone", "waiting_qr", "waiting_code", "waiting_password"];
const TRANSITIONAL = [...OPEN_LOGIN, "reconnecting", "pausing", "disconnect_pending"];

function useT() {
  const km = useWorkspaceLanguageId() === "km";
  return (en: string, kmText: string) => (km ? kmText : en);
}

function statusLabel(t: ReturnType<typeof useT>, status: string) {
  switch (status) {
    case "connecting": return t("Connecting…", "កំពុងភ្ជាប់…");
    case "waiting_qr":
    case "waiting_phone":
    case "waiting_code":
    case "waiting_password": return t("Waiting for login", "កំពុងរង់ចាំការចូល");
    case "connected": return t("Connected", "បានភ្ជាប់");
    case "reconnecting": return t("Reconnecting…", "កំពុងភ្ជាប់ឡើងវិញ…");
    case "pausing": return t("Pausing…", "កំពុងផ្អាក…");
    case "paused": return t("Paused", "បានផ្អាក");
    case "disconnect_pending": return t("Signing out…", "កំពុងចាកចេញ…");
    case "expired": return t("Login expired", "ការចូលផុតកំណត់");
    case "cancelled": return t("Cancelled", "បានបោះបង់");
    case "revoked": return t("Session ended in Telegram", "វគ្គត្រូវបានបញ្ចប់ក្នុង Telegram");
    case "disconnected": return t("Disconnected", "បានផ្តាច់");
    default: return t("Not connected", "មិនបានភ្ជាប់");
  }
}

function statusTone(status: string) {
  if (status === "connected") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (TRANSITIONAL.includes(status)) return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "paused") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-100 text-slate-600";
}

function errorMessage(t: ReturnType<typeof useT>, code: string | null) {
  switch (code) {
    case null:
    case undefined: return null;
    case "PHONE_NUMBER_INVALID": return t("Telegram did not accept this phone number.", "Telegram មិនទទួលយកលេខទូរស័ព្ទនេះទេ។");
    case "PHONE_CODE_INVALID": return t("The login code is incorrect.", "លេខកូដចូលមិនត្រឹមត្រូវ។");
    case "PHONE_CODE_EXPIRED": return t("The login code expired. Start again.", "លេខកូដចូលផុតកំណត់។ សូមចាប់ផ្តើមម្តងទៀត។");
    case "PASSWORD_INVALID": return t("The two-step verification password is incorrect.", "ពាក្យសម្ងាត់ផ្ទៀងផ្ទាត់ពីរជំហានមិនត្រឹមត្រូវ។");
    case "FLOOD_WAIT": return t("Telegram asked to wait before trying again.", "Telegram ស្នើឱ្យរង់ចាំមុនពេលព្យាយាមម្តងទៀត។");
    case "LOGIN_STEP_TIMEOUT": return t("Telegram has not answered yet. Wait a moment before retrying.", "Telegram មិនទាន់ឆ្លើយតបនៅឡើយ។ សូមរង់ចាំបន្តិចមុនព្យាយាមម្តងទៀត។");
    case "ACCOUNT_IN_OTHER_WORKSPACE": return t("This Telegram account is already connected to another TENH workspace.", "គណនី Telegram នេះបានភ្ជាប់ជាមួយកន្លែងធ្វើការ TENH ផ្សេងរួចហើយ។");
    case "ACCOUNT_ALREADY_CONNECTED": return t("This Telegram account is already connected in this workspace.", "គណនី Telegram នេះបានភ្ជាប់នៅក្នុងកន្លែងធ្វើការនេះរួចហើយ។");
    case "CHANNEL_LIMIT_REACHED": return t("Channel limit reached. Disable another channel or upgrade the plan.", "ដល់កម្រិតឆានែលហើយ។ សូមបិទឆានែលផ្សេង ឬដំឡើងគម្រោង។");
    case "CHANNEL_ACTIVATION_REFUSED": return t("This workspace's channel rules did not allow activating the account.", "ច្បាប់ឆានែលរបស់កន្លែងធ្វើការនេះមិនអនុញ្ញាតឱ្យបើកដំណើរការគណនីនេះទេ។");
    case "TRIAL_NOT_ALLOWED": return t("This account cannot be connected on a free trial in this workspace.", "គណនីនេះមិនអាចភ្ជាប់ក្នុងការសាកល្បងឥតគិតថ្លៃនៅកន្លែងធ្វើការនេះបានទេ។");
    case "UNSUPPORTED_AUTH_STEP": return t("Telegram asked for a sign-in step TENH does not support. Finish account setup in the Telegram app first.", "Telegram ស្នើជំហានចូលដែល TENH មិនគាំទ្រ។ សូមបញ្ចប់ការរៀបចំគណនីក្នុងកម្មវិធី Telegram ជាមុនសិន។");
    case "SESSION_REVOKED": return t("This session was ended from Telegram (Settings → Devices). Connect again to continue.", "វគ្គនេះត្រូវបានបញ្ចប់ពី Telegram (Settings → Devices)។ សូមភ្ជាប់ម្តងទៀត។");
    case "LOGIN_EXPIRED": return t("The sign-in took too long and expired.", "ការចូលយូរពេក ហើយបានផុតកំណត់។");
    case "LOGOUT_UNCONFIRMED": return t("Telegram has not confirmed the sign-out yet. TENH will keep retrying; you can also end the session in Telegram → Settings → Devices.", "Telegram មិនទាន់បញ្ជាក់ការចាកចេញនៅឡើយ។ TENH នឹងព្យាយាមបន្ត ឬអ្នកអាចបញ្ចប់វគ្គក្នុង Telegram → Settings → Devices។");
    default: return t("Something went wrong. Try again.", "មានបញ្ហាកើតឡើង។ សូមព្យាយាមម្តងទៀត។");
  }
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}

export function PersonalBadge() {
  return (
    <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">
      Personal
    </span>
  );
}

function Disclosure({ onAccept, onClose, busy }: { onAccept: (method: "qr" | "phone") => void; onClose: () => void; busy: boolean }) {
  const t = useT();
  const [accepted, setAccepted] = useState(false);
  const [method, setMethod] = useState<"qr" | "phone">("qr");
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="font-bold text-slate-950">{t("Before you connect your personal Telegram account", "មុនពេលភ្ជាប់គណនី Telegram ផ្ទាល់ខ្លួនរបស់អ្នក")}</p>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-6 text-slate-600">
        <li>{t("TENH keeps a Telegram session for your account on its servers. It appears in Telegram → Settings → Devices, where you can end it at any time.", "TENH រក្សាវគ្គ Telegram សម្រាប់គណនីរបស់អ្នកនៅលើម៉ាស៊ីនមេរបស់ខ្លួន។ វាបង្ហាញក្នុង Telegram → Settings → Devices ដែលអ្នកអាចបញ្ចប់បានគ្រប់ពេល។")}</li>
        <li>{t("Nothing is shared with your team until you choose chats to share. Contacts and other chats are never imported.", "គ្មានអ្វីត្រូវបានចែករំលែកជាមួយក្រុមរបស់អ្នក រហូតដល់អ្នកជ្រើសរើសការជជែកដើម្បីចែករំលែក។ ទំនាក់ទំនង និងការជជែកផ្សេងទៀតមិនត្រូវបាននាំចូលទេ។")}</li>
        <li>{t("By default only you can see this account in TENH. You decide later whether owners, all inbox members or selected members may see shared chats and reply as you.", "តាមលំនាំដើម មានតែអ្នកប៉ុណ្ណោះដែលឃើញគណនីនេះក្នុង TENH។ អ្នកសម្រេចនៅពេលក្រោយថាតើម្ចាស់ សមាជិក Inbox ទាំងអស់ ឬសមាជិកដែលបានជ្រើសរើស អាចឃើញការជជែកដែលបានចែករំលែក និងឆ្លើយតបជំនួសអ្នកបាន។")}</li>
        <li>{t("Telegram reviews accounts that use third-party apps. TENH never sends bulk or unsolicited messages.", "Telegram ពិនិត្យគណនីដែលប្រើកម្មវិធីភាគីទីបី។ TENH មិនដែលផ្ញើសារច្រើន ឬសារដែលមិនបានស្នើសុំឡើយ។")}</li>
        <li>{t("It uses one channel of your plan while connected. Workspace owners can sign it out at any time.", "វាប្រើឆានែលមួយនៃគម្រោងរបស់អ្នកពេលភ្ជាប់។ ម្ចាស់កន្លែងធ្វើការអាចចាកចេញវាបានគ្រប់ពេល។")}</li>
        <li>{t("TENH will never ask for your password or login code in chat. Enter them only in this form.", "TENH មិនដែលសុំពាក្យសម្ងាត់ ឬលេខកូដចូលរបស់អ្នកក្នុងការជជែកទេ។ សូមបញ្ចូលវាតែក្នុងទម្រង់នេះប៉ុណ្ណោះ។")}</li>
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        {(["qr", "phone"] as const).map((value) => (
          <button key={value} type="button" onClick={() => setMethod(value)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold ${method === value ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
            {value === "qr" ? t("QR code (recommended)", "កូដ QR (ណែនាំ)") : t("Phone number", "លេខទូរស័ព្ទ")}
          </button>
        ))}
      </div>
      <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-1" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
        <span>{t("I understand and want to connect my own Telegram account.", "ខ្ញុំយល់ ហើយចង់ភ្ជាប់គណនី Telegram ផ្ទាល់ខ្លួនរបស់ខ្ញុំ។")}</span>
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">{t("Cancel", "បោះបង់")}</button>
        <button type="button" disabled={!accepted || busy} onClick={() => onAccept(method)}
          className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">
          {busy ? t("Starting…", "កំពុងចាប់ផ្តើម…") : t("Continue", "បន្ត")}
        </button>
      </div>
    </div>
  );
}

async function fetchLoginState(sessionId: string): Promise<LoginState | "gone" | null> {
  try {
    const response = await fetch(`/api/telegram-personal/connections/${sessionId}/login`, { cache: "no-store" });
    if (response.status === 404) return "gone";
    const data = await readJson<LoginState>(response);
    return response.ok && data.status ? data : null;
  } catch {
    return null;
  }
}

async function fetchConnections(): Promise<ListResponse | null> {
  try {
    const response = await fetch("/api/telegram-personal/connections", { cache: "no-store" });
    if (response.status === 404) return { success: false, enabled: false };
    return await readJson<ListResponse>(response);
  } catch {
    return null;
  }
}

function LoginFlow({ sessionId, onFinished }: { sessionId: string; onFinished: () => void }) {
  const t = useT();
  const [state, setState] = useState<LoginState | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const finishedRef = useRef(false);

  const refresh = useCallback(() => {
    void fetchLoginState(sessionId).then((result) => {
      if (result === "gone" || (result && !OPEN_LOGIN.includes(result.status))) {
        if (result !== "gone") setState(result);
        if (!finishedRef.current) {
          finishedRef.current = true;
          onFinished();
        }
        return;
      }
      if (result) setState(result);
    });
  }, [sessionId, onFinished]);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const poll = setInterval(refresh, 1500);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearTimeout(first); clearInterval(poll); clearInterval(clock); };
  }, [refresh]);

  const kind = state?.status === "waiting_phone" ? "phone" : state?.status === "waiting_code" ? "code" : state?.status === "waiting_password" ? "password" : null;

  async function submit() {
    if (!kind || !value) return;
    setBusy(true);
    setLocalError(null);
    try {
      const response = await fetch(`/api/telegram-personal/connections/${sessionId}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, value }),
      });
      if (!response.ok) setLocalError((await readJson<{ error?: string }>(response)).error ?? t("Try again.", "សូមព្យាយាមម្តងទៀត។"));
    } finally {
      setValue("");
      setBusy(false);
      refresh();
    }
  }

  async function cancel() {
    setBusy(true);
    await fetch(`/api/telegram-personal/connections/${sessionId}/login`, { method: "DELETE" }).catch(() => undefined);
    setBusy(false);
    refresh();
  }

  const secondsLeft = state?.deadlineAt ? Math.max(0, Math.floor((Date.parse(state.deadlineAt) - now) / 1000)) : null;
  const message = localError ?? errorMessage(t, state?.errorCode ?? null);

  return (
    <div className="rounded-2xl border border-blue-100 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="font-bold text-slate-950">{t("Sign in to Telegram", "ចូល Telegram")}</p>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusTone(state?.status ?? "connecting")}`}>
          {statusLabel(t, state?.status ?? "connecting")}
        </span>
      </div>

      {!state || state.status === "connecting" ? (
        <p className="mt-4 text-sm text-slate-500">{t("Preparing a secure Telegram session…", "កំពុងរៀបចំវគ្គ Telegram សុវត្ថិភាព…")}</p>
      ) : null}

      {state?.status === "waiting_qr" ? (
        <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          {state.qr ? <img src={state.qr} alt={t("Telegram login QR code", "កូដ QR សម្រាប់ចូល Telegram")} className="h-56 w-56 rounded-xl border border-slate-200" /> : null}
          <ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-slate-600">
            <li>{t("Open Telegram on your phone.", "បើក Telegram នៅលើទូរស័ព្ទរបស់អ្នក។")}</li>
            <li>{t("Go to Settings → Devices → Link Desktop Device.", "ចូលទៅ Settings → Devices → Link Desktop Device។")}</li>
            <li>{t("Scan this code. It refreshes automatically.", "ស្កេនកូដនេះ។ វាធ្វើបច្ចុប្បន្នភាពដោយស្វ័យប្រវត្តិ។")}</li>
          </ol>
        </div>
      ) : null}

      {kind ? (
        <form className="mt-4 space-y-2" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label className="block text-sm font-semibold text-slate-800" htmlFor="tgp-input">
            {kind === "phone" ? t("Phone number with country code", "លេខទូរស័ព្ទជាមួយលេខកូដប្រទេស")
              : kind === "code" ? t("Login code Telegram sent you", "លេខកូដចូលដែល Telegram បានផ្ញើឱ្យអ្នក")
                : t("Two-step verification password", "ពាក្យសម្ងាត់ផ្ទៀងផ្ទាត់ពីរជំហាន")}
          </label>
          {kind === "password" && state?.passwordHint ? (
            <p className="text-xs text-slate-500">{t("Hint", "ជំនួយ")}: {state.passwordHint}</p>
          ) : null}
          <input id="tgp-input" value={value} onChange={(event) => setValue(event.target.value)}
            type={kind === "password" ? "password" : kind === "phone" ? "tel" : "text"}
            inputMode={kind === "code" ? "numeric" : undefined}
            autoComplete={kind === "password" ? "current-password" : kind === "code" ? "one-time-code" : "tel"}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" disabled={busy || !value} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-400">
            {busy ? t("Sending…", "កំពុងផ្ញើ…") : t("Continue", "បន្ត")}
          </button>
        </form>
      ) : null}

      {message ? <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</p> : null}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <span className="text-xs text-slate-500">
          {secondsLeft !== null ? t(`Expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`, `ផុតកំណត់ក្នុង ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`) : ""}
        </span>
        <button type="button" disabled={busy} onClick={() => void cancel()} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          {t("Cancel sign-in", "បោះបង់ការចូល")}
        </button>
      </div>
    </div>
  );
}

export function TelegramPersonalPanel({ openSignal = 0, onAvailability }: { openSignal?: number; onAvailability?: (available: boolean) => void }) {
  const t = useT();
  const [list, setList] = useState<ListResponse | null>(null);
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const [handledOpenSignal, setHandledOpenSignal] = useState(0);
  const [starting, setStarting] = useState(false);
  const [activeLogin, setActiveLogin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PersonalConnection | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const load = useCallback(() => {
    void fetchConnections().then((data) => {
      if (!data) return; // keep the last good state
      setList(data);
      onAvailability?.(Boolean(data.enabled));
      const mine = data.connections?.find((connection) => connection.isHolder && connection.can.useLogin);
      if (mine) setActiveLogin((current) => current ?? mine.id);
    });
  }, [onAvailability]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    return () => clearTimeout(first);
  }, [load]);

  const transitional = list?.connections?.some((connection) => TRANSITIONAL.includes(connection.status)) ?? false;
  const live = list?.connections?.some((connection) => connection.status === "connected" || connection.status === "paused") ?? false;
  // Fast refresh while something is changing; slower while connected so a
  // session ended from Telegram (Settings -> Devices) shows up without a reload.
  const refreshMs = transitional ? 4000 : live ? 15000 : null;
  useEffect(() => {
    if (!refreshMs) return;
    const timer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") load();
    }, refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs, load]);

  if (!list?.enabled) return null;

  // "Add connection → Telegram Personal" asks to open the disclosure once per request.
  const showDisclosure = disclosureOpen ||
    (openSignal > handledOpenSignal && Boolean(list.canConnect) && !activeLogin);
  const closeDisclosure = () => {
    setDisclosureOpen(false);
    setHandledOpenSignal(openSignal);
  };

  async function start(method: "qr" | "phone") {
    setStarting(true);
    setError(null);
    try {
      const response = await fetch("/api/telegram-personal/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, acceptDisclosure: true }),
      });
      const data = await readJson<{ sessionId?: string; error?: string }>(response);
      if (!response.ok || !data.sessionId) {
        setError(data.error ?? t("Unable to start the sign-in.", "មិនអាចចាប់ផ្តើមការចូលបានទេ។"));
        return;
      }
      closeDisclosure();
      setActiveLogin(data.sessionId);
      load();
    } finally {
      setStarting(false);
    }
  }

  async function patch(connection: PersonalConnection, body: Record<string, unknown>) {
    setError(null);
    const response = await fetch(`/api/telegram-personal/connections/${connection.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientRequestId: crypto.randomUUID(), ...body }),
    });
    if (!response.ok) setError((await readJson<{ error?: string }>(response)).error ?? t("Request failed.", "សំណើបរាជ័យ។"));
    load();
  }

  async function signOut() {
    if (!confirm) return;
    setConfirmBusy(true);
    setConfirmError(null);
    const response = await fetch(`/api/telegram-personal/connections/${confirm.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "SIGN_OUT", clientRequestId: crypto.randomUUID() }),
    });
    setConfirmBusy(false);
    if (!response.ok) {
      setConfirmError((await readJson<{ error?: string }>(response)).error ?? t("Request failed.", "សំណើបរាជ័យ។"));
      return;
    }
    setConfirm(null);
    load();
  }

  const connections = (list.connections ?? []).filter((connection) => !connection.can.useLogin);

  return (
    <section className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-slate-950">{t("Telegram Personal", "Telegram ផ្ទាល់ខ្លួន")}</h3>
            <PersonalBadge />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {t("Sign in with your own Telegram account. Separate from Telegram Bot connections.", "ចូលដោយប្រើគណនី Telegram ផ្ទាល់ខ្លួនរបស់អ្នក។ ដាច់ដោយឡែកពីការតភ្ជាប់ Telegram Bot។")}
          </p>
        </div>
        {list.canConnect && !activeLogin && !showDisclosure ? (
          <button type="button" disabled={!list.configured} onClick={() => setDisclosureOpen(true)}
            title={list.configured ? undefined : t("Not configured on this server yet.", "មិនទាន់កំណត់រចនាសម្ព័ន្ធនៅលើម៉ាស៊ីនមេនេះទេ។")}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">
            {t("Connect Telegram Personal", "ភ្ជាប់ Telegram ផ្ទាល់ខ្លួន")}
          </button>
        ) : null}
      </div>

      {error ? <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      {showDisclosure ? <Disclosure busy={starting} onAccept={(method) => void start(method)} onClose={closeDisclosure} /> : null}
      {activeLogin ? <LoginFlow sessionId={activeLogin} onFinished={() => { setActiveLogin(null); load(); }} /> : null}

      {connections.map((connection) => (
        <article key={connection.id} className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <img src="/images/channels/telegram.png" alt="" className="h-6 w-6 rounded" />
                <p className="font-semibold text-slate-950">{connection.displayName ?? t("Telegram account", "គណនី Telegram")}</p>
                <PersonalBadge />
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusTone(connection.status)}`}>
                  {statusLabel(t, connection.status)}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {[connection.username ? `@${connection.username}` : null, connection.phoneMasked].filter(Boolean).join(" · ")}
              </p>
              {errorMessage(t, connection.lastErrorCode) && connection.status !== "connected" ? (
                <p className="mt-2 text-xs text-amber-700">{errorMessage(t, connection.lastErrorCode)}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {connection.can.pause ? (
                <button type="button" onClick={() => void patch(connection, { action: "pause" })} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">{t("Pause", "ផ្អាក")}</button>
              ) : null}
              {connection.can.resume ? (
                <button type="button" onClick={() => void patch(connection, { action: "resume" })} className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">{t("Resume", "បន្ត")}</button>
              ) : null}
              {connection.can.disconnect ? (
                <button type="button" onClick={() => { setConfirmError(null); setConfirm(connection); }} className="rounded-xl border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50">{t("Sign out", "ចាកចេញ")}</button>
              ) : null}
            </div>
          </div>
          {connection.can.setTeamAccess && ["connected", "reconnecting", "paused"].includes(connection.status) ? (
            <label className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="font-semibold">{t("Who on your team can see shared chats", "អ្នកណាក្នុងក្រុមអាចឃើញការជជែកដែលបានចែករំលែក")}</span>
              <select value={connection.teamAccess}
                onChange={(event) => void patch(connection, { action: "team_access", mode: event.target.value })}
                className="rounded-lg border border-slate-300 px-2 py-1">
                <option value="holder_only">{t("Only me", "តែខ្ញុំ")}</option>
                <option value="owners">{t("Workspace owners", "ម្ចាស់កន្លែងធ្វើការ")}</option>
                <option value="all_inbox_members">{t("All inbox members", "សមាជិក Inbox ទាំងអស់")}</option>
                {connection.teamAccess === "selected_members" ? (
                  <option value="selected_members" disabled>{t("Selected members", "សមាជិកដែលបានជ្រើសរើស")}</option>
                ) : null}
              </select>
            </label>
          ) : null}
        </article>
      ))}

      <ConfirmActionDialog
        open={confirm !== null}
        title={t("Sign out this Telegram account?", "ចាកចេញពីគណនី Telegram នេះ?")}
        description={t("TENH will sign out of Telegram for this account, end its session in Telegram → Devices and delete TENH's copy of the session.", "TENH នឹងចាកចេញពី Telegram សម្រាប់គណនីនេះ បញ្ចប់វគ្គរបស់វានៅក្នុង Telegram → Devices និងលុបច្បាប់ចម្លងវគ្គរបស់ TENH។")}
        note={t("Conversation history already in TENH is kept. Your Telegram account and chats are not affected.", "ប្រវត្តិការសន្ទនាដែលមានក្នុង TENH ត្រូវបានរក្សាទុក។ គណនី Telegram និងការជជែករបស់អ្នកមិនរងផលប៉ះពាល់ទេ។")}
        confirmLabel={t("Sign out", "ចាកចេញ")}
        cancelLabel={t("Cancel", "បោះបង់")}
        loadingLabel={t("Signing out…", "កំពុងចាកចេញ…")}
        loading={confirmBusy}
        tone="danger"
        icon="unplug"
        error={confirmError}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void signOut()}
      />
    </section>
  );
}
