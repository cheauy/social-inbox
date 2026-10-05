"use client";

import Image from "next/image";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Play,
  RefreshCcw,
  RotateCcw,
  Send,
  ShieldCheck,
  Store,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

type Screen = "welcome" | "accounts" | "comments";
type MerchantId = "lotus" | "northstar";
type VideoId = "packing" | "launch" | "studio";

type Comment = {
  id: string;
  author: string;
  initials: string;
  text: string;
  time: string;
  likes: number;
  hidden?: boolean;
  replies: { id: string; author: string; text: string; time: string }[];
};

const merchants = [
  {
    id: "lotus" as const,
    name: "Lotus & Loom",
    handle: "@lotusandloom_demo",
    initials: "LL",
    category: "Home goods",
    followers: "12.8K",
    videos: "48",
    accent: "from-rose-400 to-orange-300",
  },
  {
    id: "northstar" as const,
    name: "Northstar Coffee",
    handle: "@northstarcoffee_demo",
    initials: "NC",
    category: "Food & beverage",
    followers: "8.4K",
    videos: "31",
    accent: "from-sky-500 to-indigo-500",
  },
];

const videos = [
  {
    id: "packing" as const,
    title: "Pack an order with us ✨",
    date: "Sep 28, 2026",
    views: "24.6K",
    comments: 3,
    gradient: "from-amber-200 via-orange-300 to-rose-400",
    label: "PACK WITH US",
  },
  {
    id: "launch" as const,
    title: "The autumn edit is here",
    date: "Sep 24, 2026",
    views: "18.2K",
    comments: 2,
    gradient: "from-stone-300 via-amber-100 to-lime-200",
    label: "AUTUMN EDIT",
  },
  {
    id: "studio" as const,
    title: "A quiet morning in the studio",
    date: "Sep 20, 2026",
    views: "9.7K",
    comments: 2,
    gradient: "from-indigo-300 via-purple-200 to-pink-200",
    label: "STUDIO DAY",
  },
];

const initialComments: Record<VideoId, Comment[]> = {
  packing: [
    {
      id: "c1",
      author: "Maya Chen",
      initials: "MC",
      text: "The care you put into every package is why I keep coming back 💛",
      time: "18 min ago",
      likes: 14,
      replies: [
        {
          id: "r1",
          author: "Lotus & Loom",
          text: "This made our day, Maya — thank you!",
          time: "12 min ago",
        },
      ],
    },
    {
      id: "c2",
      author: "Theo James",
      initials: "TJ",
      text: "Do you ship the new linen set internationally?",
      time: "42 min ago",
      likes: 3,
      replies: [],
    },
    {
      id: "c3",
      author: "Ari Bloom",
      initials: "AB",
      text: "Mine arrived yesterday and the colour is perfect.",
      time: "1 hr ago",
      likes: 8,
      replies: [],
    },
  ],
  launch: [
    {
      id: "c4",
      author: "Jamie Vale",
      initials: "JV",
      text: "That olive throw needs to be in my living room immediately.",
      time: "2 days ago",
      likes: 21,
      replies: [],
    },
    {
      id: "c5",
      author: "Noor Studio",
      initials: "NS",
      text: "Beautiful styling! Is the ceramic vase part of the collection?",
      time: "2 days ago",
      likes: 6,
      replies: [],
    },
  ],
  studio: [
    {
      id: "c6",
      author: "Rin Park",
      initials: "RP",
      text: "The light in your studio is a dream.",
      time: "4 days ago",
      likes: 17,
      replies: [],
    },
    {
      id: "c7",
      author: "Lena Ortiz",
      initials: "LO",
      text: "Would love a longer behind-the-scenes video!",
      time: "5 days ago",
      likes: 11,
      replies: [],
    },
  ],
};

function PrototypeBanner() {
  return (
    <div className="sticky top-0 z-50 flex min-h-10 items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-center text-xs font-semibold text-amber-950 shadow-sm sm:text-sm">
      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
      Prototype — TikTok API access pending
      <span className="hidden font-normal text-amber-800 sm:inline">· Synthetic data only · No TikTok connection</span>
    </div>
  );
}

function BrandHeader({ onReset }: { onReset: () => void }) {
  return (
    <header className="flex h-[72px] items-center border-b border-slate-200 bg-white px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <Image src="/images/tenh_logo.png" alt="TENH Chat" width={44} height={44} className="h-11 w-11 object-contain" priority />
        <div>
          <p className="font-bold leading-tight text-slate-950">Tenh Chat</p>
          <p className="text-xs text-slate-500">TikTok review prototype</p>
        </div>
      </div>
      <button onClick={onReset} className="ml-auto inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
        <RotateCcw className="h-4 w-4" />
        <span className="hidden sm:inline">Reset demo</span>
      </button>
    </header>
  );
}

function Welcome({ onConnect }: { onConnect: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 items-center px-5 py-10 sm:px-8">
      <div className="grid min-w-0 w-full overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/50 lg:grid-cols-[1.05fr_.95fr]">
        <section className="min-w-0 p-7 sm:p-10 lg:p-12">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-blue-700">
            <span className="h-2 w-2 rounded-full bg-blue-500" /> Review environment
          </div>
          <h1 className="max-w-xl text-2xl font-bold tracking-tight text-slate-950 sm:text-4xl">Manage TikTok video conversations from TENH</h1>
          <p className="mt-4 max-w-lg text-base leading-7 text-slate-600">Preview how a merchant would connect an account, review owned videos, and manage public comments after TikTok approval.</p>

          <div className="mt-8 space-y-4">
            {[
              [Video, "Read owned videos", "Show a merchant's published video list."],
              [MessageCircle, "Manage public comments", "Read, reply to, hide, and delete comments."],
              [ShieldCheck, "Keep merchants separated", "Every action stays scoped to the selected account."],
            ].map(([Icon, title, copy]) => (
              <div key={String(title)} className="flex gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100"><Icon className="h-5 w-5 text-slate-700" /></div>
                <div><p className="text-sm font-bold text-slate-900">{String(title)}</p><p className="mt-0.5 text-sm text-slate-500">{String(copy)}</p></div>
              </div>
            ))}
          </div>

          <button onClick={onConnect} className="mt-9 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 py-3.5 text-xs font-bold text-white shadow-lg transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:w-auto sm:gap-3 sm:px-5 sm:text-sm">
            <Image src="/images/channels/tiktok.png" alt="" width={22} height={22} className="h-[22px] w-[22px] rounded" />
            Simulate Connect TikTok
            <ChevronRight className="h-4 w-4" />
          </button>
          <p className="mt-3 text-xs leading-5 text-slate-500">Simulation only. This does not open TikTok, request a real grant, or activate messaging.</p>
        </section>

        <aside className="relative flex min-h-[360px] items-center justify-center overflow-hidden bg-slate-950 p-8 text-white">
          <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-fuchsia-500/20 blur-3xl" />
          <div className="absolute -bottom-24 -left-20 h-64 w-64 rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="relative w-full max-w-sm rounded-3xl border border-white/15 bg-white/10 p-6 backdrop-blur">
            <div className="flex items-center justify-between"><span className="text-sm font-semibold">Review scope</span><span className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs text-emerald-300">Transparent demo</span></div>
            <div className="mt-6 space-y-3">
              {["Basic account profile", "Owned video list", "Public comments & replies", "Comment moderation actions"].map((item) => <div key={item} className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3 text-sm"><Check className="h-4 w-4 text-emerald-300" />{item}</div>)}
            </div>
            <div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-xs leading-5 text-amber-100">Direct messaging is future scope and is not represented as available or approved here.</div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function Accounts({ selected, onSelect, onBack, onContinue }: { selected: MerchantId; onSelect: (id: MerchantId) => void; onBack: () => void; onContinue: () => void }) {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-8 sm:px-8 sm:py-12">
      <button onClick={onBack} className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950"><ArrowLeft className="h-4 w-4" />Back</button>
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div><p className="text-sm font-bold text-blue-600">Step 2 of 3</p><h1 className="mt-1 text-2xl font-bold text-slate-950 sm:text-3xl">Choose a merchant account</h1><p className="mt-2 text-sm leading-6 text-slate-600">Synthetic profiles stand in for accounts returned after a merchant-authorized TikTok connection.</p></div>
          <div className="shrink-0 rounded-xl bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">Mock account selection</div>
        </div>

        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          {merchants.map((merchant) => {
            const active = selected === merchant.id;
            return (
              <button key={merchant.id} onClick={() => onSelect(merchant.id)} aria-pressed={active} className={`relative rounded-2xl border-2 p-5 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${active ? "border-blue-600 bg-blue-50/60" : "border-slate-200 hover:border-slate-300"}`}>
                {active && <span className="absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white"><Check className="h-4 w-4" /></span>}
                <div className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${merchant.accent} text-lg font-bold text-white shadow-sm`}>{merchant.initials}</div>
                <p className="mt-4 font-bold text-slate-950">{merchant.name}</p><p className="mt-0.5 text-sm text-slate-500">{merchant.handle}</p>
                <div className="mt-4 flex gap-5 text-xs text-slate-500"><span><b className="text-slate-900">{merchant.followers}</b> followers</span><span><b className="text-slate-900">{merchant.videos}</b> videos</span></div>
                <div className="mt-4 flex items-center gap-2 border-t border-slate-200 pt-4 text-xs text-slate-600"><Store className="h-4 w-4" />{merchant.category} · Separate mock workspace</div>
              </button>
            );
          })}
        </div>

        <div className="mt-7 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-slate-900"><ShieldCheck className="h-4 w-4 text-emerald-600" />Permission intent shown for review</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">TENH would request basic profile, owned-video, and public comment permissions only after approval. This prototype issues no tokens and sends no provider requests.</p>
        </div>
        <button onClick={onContinue} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 sm:w-auto">Open selected account <ChevronRight className="h-4 w-4" /></button>
      </div>
    </main>
  );
}

function CommentsWorkspace({ merchantId, onBack, onClose }: { merchantId: MerchantId; onBack: () => void; onClose: () => void }) {
  const [selectedVideo, setSelectedVideo] = useState<VideoId>("packing");
  const [comments, setComments] = useState(initialComments);
  const [replyTo, setReplyTo] = useState<string | null>("c2");
  const [draft, setDraft] = useState("Yes — we ship internationally! Delivery options appear at checkout.");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const merchant = merchants.find((item) => item.id === merchantId) ?? merchants[0];
  const video = videos.find((item) => item.id === selectedVideo) ?? videos[0];
  const visibleComments = comments[selectedVideo];
  const replyTarget = visibleComments.find((comment) => comment.id === replyTo);

  function mutateComment(commentId: string, update: (comment: Comment) => Comment) {
    setComments((current) => ({ ...current, [selectedVideo]: current[selectedVideo].map((comment) => comment.id === commentId ? update(comment) : comment) }));
  }

  function sendReply() {
    if (!replyTarget || !draft.trim()) return;
    mutateComment(replyTarget.id, (comment) => ({ ...comment, replies: [...comment.replies, { id: `local-${Date.now()}`, author: merchant.name, text: draft.trim(), time: "Just now" }] }));
    setDraft("");
    setReplyTo(null);
    setNotice("Reply added locally to this synthetic conversation.");
  }

  function toggleHidden(comment: Comment) {
    mutateComment(comment.id, (current) => ({ ...current, hidden: !current.hidden }));
    setMenuFor(null);
    setNotice(comment.hidden ? "Comment restored in this local demo." : "Comment hidden in this local demo.");
  }

  function deleteComment(comment: Comment) {
    setComments((current) => ({ ...current, [selectedVideo]: current[selectedVideo].filter((item) => item.id !== comment.id) }));
    setMenuFor(null);
    setReplyTo(null);
    setNotice("Synthetic comment deleted locally.");
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-slate-100">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <button onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950"><ArrowLeft className="h-4 w-4" />Accounts</button>
        <div className="hidden h-5 w-px bg-slate-200 sm:block" />
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${merchant.accent} text-xs font-bold text-white`}>{merchant.initials}</div>
        <div className="min-w-0"><p className="truncate text-sm font-bold text-slate-950">{merchant.name}</p><p className="truncate text-xs text-slate-500">{merchant.handle} · Synthetic merchant</p></div>
        <button onClick={onClose} className="ml-auto inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"><X className="h-4 w-4" />Close connection</button>
      </div>

      {notice && <div role="status" className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-800 sm:mx-6"><Check className="h-4 w-4" />{notice}<button onClick={() => setNotice(null)} className="ml-auto" aria-label="Dismiss notice"><X className="h-4 w-4" /></button></div>}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="border-b border-slate-200 bg-white lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between px-5 py-4"><div><h2 className="font-bold text-slate-950">Owned videos</h2><p className="text-xs text-slate-500">Synthetic published content</p></div><button className="rounded-lg border border-slate-200 p-2 text-slate-500" aria-label="Refresh mock videos"><RefreshCcw className="h-4 w-4" /></button></div>
          <div className="flex gap-3 overflow-x-auto px-4 pb-4 lg:block lg:space-y-2 lg:overflow-visible">
            {videos.map((item) => <button key={item.id} onClick={() => { setSelectedVideo(item.id); setReplyTo(null); setMenuFor(null); }} className={`flex min-w-[285px] gap-3 rounded-xl border p-3 text-left transition lg:min-w-0 lg:w-full ${selectedVideo === item.id ? "border-blue-200 bg-blue-50" : "border-transparent hover:bg-slate-50"}`}>
              <div className={`relative flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br ${item.gradient}`}><span className="px-1 text-center text-[9px] font-black tracking-wider text-white drop-shadow">{item.label}</span><span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 p-1"><Play className="h-2.5 w-2.5 fill-white text-white" /></span></div>
              <div className="min-w-0 py-1"><p className="line-clamp-2 text-sm font-bold text-slate-900">{item.title}</p><p className="mt-2 text-xs text-slate-500">{item.date}</p><div className="mt-2 flex gap-3 text-xs text-slate-500"><span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" />{item.views}</span><span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" />{comments[item.id].length}</span></div></div>
            </button>)}
          </div>
        </aside>

        <section className="min-h-0 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto max-w-3xl">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-600">Public comments</p><h1 className="mt-1 text-xl font-bold text-slate-950">{video.title}</h1></div><span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm">{visibleComments.length} comments</span></div>
            <div className="space-y-3">
              {visibleComments.map((comment) => <article key={comment.id} className={`relative rounded-2xl border bg-white p-4 shadow-sm ${comment.hidden ? "border-dashed border-slate-300 opacity-65" : "border-slate-200"}`}>
                <div className="flex gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">{comment.initials}</div><div className="min-w-0 flex-1"><div className="flex items-start gap-2"><div><p className="text-sm font-bold text-slate-900">{comment.author}</p><p className="text-xs text-slate-400">{comment.time}</p></div>{comment.hidden && <span className="ml-auto rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-500">Hidden</span>}<button onClick={() => setMenuFor(menuFor === comment.id ? null : comment.id)} className={`${comment.hidden ? "" : "ml-auto"} rounded-lg p-1.5 text-slate-400 hover:bg-slate-100`} aria-label={`Manage comment by ${comment.author}`}><MoreHorizontal className="h-5 w-5" /></button></div>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{comment.text}</p><div className="mt-3 flex items-center gap-4 text-xs font-semibold text-slate-500"><span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5" />{comment.likes}</span><button onClick={() => { setReplyTo(comment.id); setDraft(""); }} className="text-blue-600 hover:text-blue-700">Reply</button></div>
                    {comment.replies.map((reply) => <div key={reply.id} className="mt-4 flex gap-2 border-l-2 border-blue-100 pl-3"><div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${merchant.accent} text-[9px] font-bold text-white`}>{merchant.initials}</div><div><p className="text-xs font-bold text-slate-900">{reply.author} <span className="ml-1 rounded bg-blue-50 px-1.5 py-0.5 text-[9px] uppercase text-blue-700">Merchant</span></p><p className="mt-1 text-sm text-slate-700">{reply.text}</p><p className="mt-1 text-[11px] text-slate-400">{reply.time}</p></div></div>)}
                  </div></div>
                {menuFor === comment.id && <div className="absolute right-4 top-12 z-10 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl"><button onClick={() => toggleHidden(comment)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50">{comment.hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}{comment.hidden ? "Restore comment" : "Hide comment"}</button><button onClick={() => deleteComment(comment)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" />Delete comment</button></div>}
              </article>)}
              {visibleComments.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">No comments remain. Reset the demo to restore fixtures.</div>}
            </div>

            {replyTarget && <div className="sticky bottom-4 mt-4 rounded-2xl border border-blue-200 bg-white p-4 shadow-xl shadow-slate-300/40"><div className="flex items-center justify-between"><p className="text-xs font-bold text-slate-900">Replying to {replyTarget.author}</p><button onClick={() => setReplyTo(null)} aria-label="Cancel reply"><X className="h-4 w-4 text-slate-400" /></button></div><div className="mt-3 flex flex-col gap-2 sm:flex-row"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} placeholder="Write a public reply…" className="min-h-12 flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /><button onClick={sendReply} disabled={!draft.trim()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"><Send className="h-4 w-4" />Reply</button></div><p className="mt-2 text-[11px] text-slate-500">Local simulation — no content is sent to TikTok.</p></div>}
          </div>
        </section>
      </div>
    </main>
  );
}

export function TikTokReviewPrototype() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [merchantId, setMerchantId] = useState<MerchantId>("lotus");
  const resetKey = useMemo(() => `${screen}-${merchantId}`, [screen, merchantId]);

  function reset() {
    setMerchantId("lotus");
    setScreen("welcome");
  }

  return (
    <div className="flex min-h-dvh flex-col bg-slate-100 text-slate-950">
      <PrototypeBanner />
      <BrandHeader onReset={reset} />
      {screen === "welcome" && <Welcome onConnect={() => setScreen("accounts")} />}
      {screen === "accounts" && <Accounts selected={merchantId} onSelect={setMerchantId} onBack={() => setScreen("welcome")} onContinue={() => setScreen("comments")} />}
      {screen === "comments" && <CommentsWorkspace key={resetKey} merchantId={merchantId} onBack={() => setScreen("accounts")} onClose={reset} />}
    </div>
  );
}
