"use client";
import { useCallback, useEffect, useState } from "react";
import { useBotPreviewRegistration } from "@/components/bot/bot-messenger-preview";
import { useBotSaveRegistration, type BotSaveResult } from "@/components/bot/bot-save-toolbar";
import type { AutoReplyRule } from "@/lib/facebook/auto-reply";
import { BotDraftSettings } from "@/components/settings/bot-draft-settings";
type Page = { id: string; account_name: string | null; platform_account_id: string };
type History = { id: string; rule_id: string; comment_id: string; action: string; status: string; reason: string | null; attempts: number; created_at: string };
const field = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
const button = "rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50";
export function AutoReplySettings({includeDrafts=true}:{includeDrafts?:boolean}={}) {
  const [rules, setRules] = useState<AutoReplyRule[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [history, setHistory] = useState<History[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed,setLoadFailed]=useState(false);
  const [paused, setPaused] = useState(true);
  const [workerEnabled, setWorkerEnabled] = useState(false);
  const [circuitUntil, setCircuitUntil] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [step, setStep] = useState(1);
  const [pageMode, setPageMode] = useState("single");
  const [pageIds, setPageIds] = useState<string[]>([]);
  const [posts, setPosts] = useState<{ pageId: string; post: string }[]>([{ pageId: "", post: "" }]);
  const [confirmRule, setConfirmRule] = useState<AutoReplyRule | null>(null);
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState("");
  const [name, setName] = useState("");
  const [pageId, setPageId] = useState("");
  const [scope, setScope] = useState("all");
  const [publicOn, setPublicOn] = useState(true);
  const [privateOn, setPrivateOn] = useState(false);
  const [publicTemplate, setPublicTemplate] = useState("");
  const [privateTemplate, setPrivateTemplate] = useState("");
  const [starts, setStarts] = useState<Record<string, string>>({});
  const [comment, setComment] = useState("");
  const [testRule, setTestRule] = useState("");
  const [testResult, setTestResult] = useState("");
  const [filter, setFilter] = useState("");
  const [timezone, setTimezone] = useState("");
  const load = useCallback(async (before?: string) => {
    const response = await fetch("/api/facebook/auto-reply" + (before ? "?before=" + encodeURIComponent(before) : ""), { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Unable to load Auto Reply.");
    setLoadFailed(false);setRules(result.rules); setPages(result.pages); setCanManage(result.canManage);
    setWorkerEnabled(!!result.workerEnabled);
    setPaused(result.paused); setCircuitUntil(result.circuitUntil && Date.parse(result.circuitUntil) > Date.now() ? result.circuitUntil : null); setLoading(false);
    setHistory(current => before ? [...current, ...result.history] : result.history);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().then(() => setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone))
        .catch(error => { setLoadFailed(true);setNotice(error.message); setLoading(false); });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  async function request(body: object) {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/facebook/auto-reply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to save.");
      return result;
    } finally { setBusy(false); }
  }
  function edit(rule?: AutoReplyRule) {
    setCreating(true); setStep(1); setPageMode("single"); setPageIds([]);
    setEditing(rule?.id ?? ""); setName(rule?.name ?? ""); setPageId(rule?.social_account_id ?? "");
    setScope(rule?.post_id ? "specific" : "all"); setPosts([{ pageId: rule?.social_account_id ?? "", post: rule?.post_url ?? rule?.post_id ?? "" }]);
    setPublicOn(!!rule?.public_template || !rule); setPrivateOn(!!rule?.private_template);
    setPublicTemplate(rule?.public_template ?? ""); setPrivateTemplate(rule?.private_template ?? "");
  }
  const selectedPages = pageMode === "all" ? pages.map(page => page.id) : pageMode === "multiple" ? pageIds : pageId ? [pageId] : [];
  const targets = scope === "all" ? selectedPages.map(pageId => ({ pageId })) : posts;
  function next() {
    if (step === 1 && (!name.trim() || !selectedPages.length || !targets.length || targets.length > 20 ||
      (scope === "specific" && posts.some(row => !selectedPages.includes(row.pageId) || !row.post.trim())))) {
      setNotice("Add a name, choose your Pages and complete each post. Maximum 20 Page/post scopes per save."); return;
    }
    if (step === 2 && ((!publicOn && !privateOn) || (publicOn && !publicTemplate.trim()) || (privateOn && !privateTemplate.trim()))) {
      setNotice("Write at least one public or private reply."); return;
    }
    setNotice(""); setStep(current => current + 1);
  }
  async function persistLegacy():Promise<BotSaveResult> {
    if(!creating||step!==3||!canManage||busy)return {ok:false,message:"Complete the Comment Auto Reply review before saving."};
    try {
      await request({ operation: "save", id: editing || undefined, name, targets, scope,
        publicTemplate: publicOn ? publicTemplate : "", privateTemplate: privateOn ? privateTemplate : "" });
    } catch(error){const message=(error as Error).message;setNotice(message);return {ok:false,message:"Comment Auto Reply: "+message};}
    setCreating(false);
    try {await load();setNotice("Saved disabled. Choose a start time before turning on.");return {ok:true,message:"Comment Auto Reply saved disabled."};}
    catch{setLoadFailed(true);setNotice("Saved disabled, but the rule list could not refresh. Reload to verify.");return {ok:true,message:"Comment Auto Reply saved disabled, but its list could not refresh. Reload to verify."};}
  }
  async function save(event:React.FormEvent){event.preventDefault();if(step!==3){next();return;}await persistLegacy();}
  const sharedSave=useBotSaveRegistration("comments",{dirty:creating,busy:busy||loading,canSave:creating&&step===3&&canManage&&!busy&&!loading&&!loadFailed,
    message:loadFailed?"Comment Auto Reply setup is unavailable.":!canManage?"Channel management permission is required.":"Complete the Comment Auto Reply review before saving."},persistLegacy);
  useEffect(()=>{if(!creating)return;const prevent=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};window.addEventListener("beforeunload",prevent);return()=>window.removeEventListener("beforeunload",prevent);},[creating]);
  async function toggle(rule: AutoReplyRule) {
    try {
      const start = starts[rule.id];
      if (!rule.enabled && !start) throw new Error("Choose the start date and time first.");
      await request({ operation: "toggle", id: rule.id, enabled: !rule.enabled,
        startsAt: start ? new Date(start).toISOString() : undefined });
      await load();
      setConfirmRule(null);
      setNotice(rule.enabled ? "Paused. Queued replies are stopped. A reply already being sent may finish." : "On. Only new comments after activation and your start time are eligible.");
    } catch (error) { setNotice((error as Error).message); }
  }
  async function globalPause() {
    try { await request({ operation: "globalPause", paused: !paused }); await load();
      setNotice(paused ? "Global pause released. Enabled rules can process only new eligible comments." : "All Auto Reply sending paused. A send already in flight may finish.");
    } catch (error) { setNotice((error as Error).message); }
  }
  useBotPreviewRegistration("comments",{kind:"facebook_comment_auto_reply",channel:pages.find(page=>page.id===pageId)?.account_name??"Selected Pages",customerText:comment,
    reply:privateOn?privateTemplate:"",publicReply:publicOn?publicTemplate:"",internal:"Public replies appear on the Facebook post. Private reply templates appear separately in Messenger; eligibility is tested before any action."});
  return <div className={sharedSave?"space-y-5":"mx-auto max-w-5xl space-y-6 p-4 sm:p-6"}>
    {includeDrafts ? <BotDraftSettings /> : null}
    <div><h1 className={sharedSave?"sr-only":"text-2xl font-bold text-slate-900"}>Tenh Bot · Facebook comment Auto Reply</h1>
      <p className="mt-2 text-sm text-slate-600">Reply publicly, privately, or both to new comments on your connected Pages. Specific-post rules take priority. A comment with an existing reply is skipped.</p>
      <p className="mt-2 text-sm text-slate-600">All-post rules include future posts. Start times use {timezone || "your browser timezone"}; earlier comments are never backfilled. Private replies depend on Facebook eligibility and customer response.</p></div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
      <p className="text-sm text-slate-600" aria-live="polite">{loading ? "Loading your connected Pages…" : paused ? "All sending is paused" : "Enabled rules are ready"}{circuitUntil ? " · Safety cooldown until " + new Date(circuitUntil).toLocaleString() : ""}</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!canManage || busy || loading} onClick={() => {
        if (!paused || window.confirm("Release the global pause? Enabled rules may send replies to new comments.")) void globalPause();
      }}>{paused ? "Release global pause" : "Pause all"}</button>
      <button type="button" className={button + " border-blue-600 bg-blue-600 text-white"} disabled={!canManage || busy || loading} onClick={() => edit()}>New rule</button></div>
    </div>
    {!loading && !workerEnabled && <p className="text-sm text-amber-700">The sending worker is not enabled on this deployment. Saved or enabled rules will not send automated replies until setup is completed.</p>}
    {notice && <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm">{notice}</p>}
    {!loading&&!loadFailed&&!canManage && <p className="text-sm text-slate-600">Channel management permission is required to change or test rules.</p>}
    {creating && <form onSubmit={save} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
      <h2 className="font-semibold">{editing ? "Edit paused rule" : "New rule"}</h2>
      <ol aria-label="Rule creation steps" className="grid grid-cols-3 gap-2 text-sm">{["Choose scope", "Write replies", "Review"].map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined} className={"border-b-2 pb-2 " + (step === index + 1 ? "border-blue-600 font-semibold text-blue-700" : "border-slate-200 text-slate-500")}>{index + 1}. {label}</li>)}</ol>
      <fieldset disabled={!canManage || busy} className="space-y-4 disabled:opacity-60">
        {step === 1 && <>
        <label className="block text-sm">Rule name<input required maxLength={120} value={name} onChange={e => setName(e.target.value)} className={field} /></label>
        {!editing && <label className="block text-sm">Pages<select value={pageMode} onChange={e => { setPageMode(e.target.value); setPosts([{ pageId: "", post: "" }]); }} className={field}><option value="single">One Page</option><option value="multiple">Choose several Pages</option><option value="all">All currently connected Pages</option></select></label>}
        {pageMode === "single" &&
        <label className="block text-sm">Connected Page<select required value={pageId} onChange={e => setPageId(e.target.value)} className={field}>
          <option value="">Select a Page</option>{pages.map(page => <option key={page.id} value={page.id}>{page.account_name ?? page.platform_account_id}</option>)}</select></label>}
        {pageMode === "multiple" && <div className="grid gap-2 sm:grid-cols-2">{pages.map(page => <label key={page.id} className="flex items-center gap-2 rounded-xl border p-3 text-sm"><input type="checkbox" checked={pageIds.includes(page.id)} onChange={e => setPageIds(current => e.target.checked ? [...current, page.id] : current.filter(id => id !== page.id))} />{page.account_name ?? page.platform_account_id}</label>)}</div>}
        {pageMode === "all" && <p className="text-sm text-slate-600">{pages.length} currently connected Pages selected. This is a snapshot at save. Newly connected Pages must be deliberately added later.</p>}
        <label className="block text-sm">Posts<select value={scope} onChange={e => setScope(e.target.value)} className={field}>
          <option value="all">All posts, including future posts</option><option value="specific">Choose one or several specific posts</option></select></label>
        {scope === "specific" && <div className="space-y-3">{posts.map((row, index) => <div key={index} className="grid items-end gap-2 sm:grid-cols-2">
          <label className="text-sm">Page for post {index + 1}<select required value={row.pageId} onChange={e => setPosts(current => current.map((p, i) => i === index ? { ...p, pageId: e.target.value } : p))} className={field}><option value="">Choose a selected Page</option>{pages.filter(page => selectedPages.includes(page.id)).map(page => <option key={page.id} value={page.id}>{page.account_name ?? page.platform_account_id}</option>)}</select></label>
          <label className="text-sm">Post link or Page_post ID<input required value={row.post} onChange={e => setPosts(current => current.map((p, i) => i === index ? { ...p, post: e.target.value } : p))} className={field} placeholder="https://www.facebook.com/.../posts/..." /></label>
          {posts.length > 1 && <button type="button" className={button} onClick={() => setPosts(current => current.filter((_, i) => i !== index))}>Remove post {index + 1}</button>}
        </div>)}{!editing && <button type="button" disabled={posts.length >= 20} className={button} onClick={() => setPosts(current => [...current, { pageId: selectedPages.length === 1 ? selectedPages[0] : "", post: "" }])}>Add another post</button>}
        <p className="text-xs text-slate-500">Facebook verifies each post belongs to its selected Page before saving.</p></div>}
        </>}
        {step === 2 && <>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={publicOn} onChange={e => setPublicOn(e.target.checked)} />Public reply</label>
        {publicOn && <label className="block text-sm">Public reply text<textarea required maxLength={8000} value={publicTemplate} onChange={e => setPublicTemplate(e.target.value)} className={field} rows={3} /></label>}
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={privateOn} onChange={e => setPrivateOn(e.target.checked)} />Private reply to the commenter</label>
        {privateOn && <label className="block text-sm">Private reply text<textarea required maxLength={2000} value={privateTemplate} onChange={e => setPrivateTemplate(e.target.value)} className={field} rows={3} /></label>}
        <div className="space-y-2 border-l-2 border-blue-200 pl-4 text-sm"><h3 className="font-medium">Customer preview</h3>{publicOn && <p className="whitespace-pre-wrap break-words">Public: {publicTemplate || "Your public reply will appear here"}</p>}{privateOn && <p className="whitespace-pre-wrap break-words">Private: {privateTemplate || "Your private reply will appear here"}</p>}</div></>}
        {step === 3 && <div className="space-y-3 text-sm" aria-label="Review rule scope"><h3 className="font-semibold">Review {name}</h3>
          <p>{new Set(targets.map(row => row.pageId)).size} Page(s) · {targets.length} separate Page/post rule(s) · {scope === "all" ? "All posts, including future posts" : "Verified specific posts"}</p>
          <ul className="space-y-1">{targets.map((row, index) => <li key={index} className="break-words">{pages.find(page => page.id === row.pageId)?.account_name ?? "Page"} — {scope === "specific" ? posts[index]?.post : "All posts"}</li>)}</ul>
          {publicOn && <p className="whitespace-pre-wrap break-words">Public: {publicTemplate}</p>}{privateOn && <p className="whitespace-pre-wrap break-words">Private: {privateTemplate}</p>}
          <p className="text-slate-600">Saved disabled. Each scope is managed separately. Conflicts reject the entire save. Only new comments after activation and your chosen start are eligible; existing replies are skipped.</p>
        </div>}
        <div className="flex flex-wrap gap-2">{step > 1 && <button type="button" className={button} onClick={() => setStep(current => current - 1)}>Back</button>}{step < 3 ? <button type="button" className={button} onClick={next}>Continue</button> : <button className={button} type="submit" hidden={sharedSave}>Save disabled</button>}<button type="button" className={button} onClick={() => { setCreating(false); setNotice(""); }}>Cancel</button></div>
      </fieldset>
    </form>}
    <section className="space-y-3"><h2 className="font-semibold">Rules</h2>{!rules.length && <p className="text-sm">No rules saved yet.</p>}
      {rules.map(rule => <article key={rule.id} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">{rule.name} · {rule.enabled ? "On" : "Off"}</h3>
          <p className="text-sm text-slate-500">{pages.find(page => page.id === rule.social_account_id)?.account_name ?? "Disconnected Page"} · {rule.post_id ? "Specific post: " + rule.post_id : "All posts, including future posts"}</p>
          {rule.activated_at && <p className="text-xs text-slate-500">Activated {new Date(rule.activated_at).toLocaleString()}</p>}</div>
          <div className="flex flex-wrap items-end gap-2">{!rule.enabled && <label className="text-xs">Start ({timezone})<input type="datetime-local" value={starts[rule.id] ?? ""} onChange={e => setStarts(current => ({ ...current, [rule.id]: e.target.value }))} className={field} disabled={!canManage || busy} /></label>}
            <button type="button" disabled={!canManage || busy} className={button} onClick={() => rule.enabled ? void toggle(rule) : setConfirmRule(rule)}>{rule.enabled ? "Pause" : "Turn on"}</button>
            <button type="button" disabled={!canManage || busy || rule.enabled} className={button} onClick={() => edit(rule)}>Edit</button></div></div>
      </article>)}</section>
    {confirmRule && <section role="dialog" aria-modal="false" aria-label="Review before enabling" className="space-y-3 rounded-2xl border border-blue-300 bg-blue-50 p-5">
      <h2 className="font-semibold">Review before enabling {confirmRule.name}</h2><p className="text-sm">1 Page: {pages.find(page => page.id === confirmRule.social_account_id)?.account_name} · {confirmRule.post_id ?? "All posts, including future posts"}</p>
      <p className="text-sm">Start: {starts[confirmRule.id] || "Choose a start time above"} ({timezone}). Actual cutoff is no earlier than server activation. {paused ? "Global sending is still paused." : "New eligible comments may receive replies."}</p>
      {confirmRule.public_template && <p className="whitespace-pre-wrap break-words text-sm">Public: {confirmRule.public_template}</p>}{confirmRule.private_template && <p className="whitespace-pre-wrap break-words text-sm">Private: {confirmRule.private_template}</p>}
      <div className="flex gap-2"><button type="button" className={button} disabled={!canManage || busy} onClick={() => void toggle(confirmRule)}>Confirm turn on</button><button type="button" className={button} onClick={() => setConfirmRule(null)}>Cancel enable</button></div>
    </section>}
    <details className="space-y-3"><summary className="cursor-pointer text-sm font-medium text-slate-600">Advanced · read-only eligibility test</summary>
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Read-only test</h2>
      <p className="text-sm text-slate-600">Checks an inbox comment against a saved rule and Facebook reply eligibility. Nothing is sent or queued. Turning on still applies the new-only cutoff.</p>
      <label className="block text-sm">Saved rule<select value={testRule} onChange={e => setTestRule(e.target.value)} className={field}><option value="">Select a rule</option>{rules.map(rule => <option key={rule.id} value={rule.id}>{rule.name}</option>)}</select></label>
      <label className="block text-sm">Comment ID<input value={comment} onChange={e => setComment(e.target.value)} className={field} /></label>
      <button type="button" className={button} disabled={!canManage || busy || !testRule || !comment} onClick={() => {
        void request({ operation: "test", id: testRule, commentId: comment }).then(result => setTestResult(JSON.stringify(result.results, null, 2))).catch(error => setNotice(error.message));
      }}>Test without sending</button>
      {testResult && <pre role="status" className="whitespace-pre-wrap text-sm">{testResult}</pre>}
    </section></details>
    <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Reply history</h2>
      <select aria-label="Filter history" value={filter} onChange={e => setFilter(e.target.value)} className="rounded-lg border p-2 text-sm"><option value="">All statuses</option>{["sent","skipped","failed","needs_review","pending","retry","claimed","sending"].map(status => <option key={status}>{status}</option>)}</select>
      <button type="button" className={button} onClick={() => void load().catch(error => setNotice(error.message))}>Refresh</button></div>
      <p className="text-sm text-slate-600">Needs review means Facebook may have sent the reply. Check the Facebook post or Messenger conversation before any manual reply; Auto Reply will not resend it.</p>
      <div className="overflow-x-auto rounded-xl border bg-white"><table className="w-full text-left text-sm"><thead><tr>{["Time","Comment","Delivery","Status","Reason"].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead>
        <tbody>{history.filter(row => !filter || row.status === filter).map(row => <tr key={row.id} className="border-t"><td className="p-3">{new Date(row.created_at).toLocaleString()}</td><td className="p-3">{row.comment_id}</td><td className="p-3">{row.action}</td><td className="p-3">{row.status.replaceAll("_"," ")}</td><td className="p-3">{row.reason?.replaceAll("_"," ") ?? "Queued"}</td></tr>)}</tbody></table></div>
      {history.length > 0 && history.length % 50 === 0 && <button type="button" className={button} onClick={() => void load(history.at(-1)?.created_at).catch(error => setNotice(error.message))}>Load older</button>}
    </section>
  </div>;
}
