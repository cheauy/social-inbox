export function QuickPickerLoading({ kind }: { kind: "tags" | "replies" }) {
  const block = "tenh-picker-shimmer relative overflow-hidden bg-slate-100 motion-reduce:before:animate-none";
  return <div role="status" aria-live="polite" aria-label={kind === "tags" ? "Loading tags" : "Loading quick replies"}>
    <span className="sr-only">{kind === "tags" ? "Loading tags…" : "Loading quick replies…"}</span>
    {kind === "tags" ? <div aria-hidden="true" className="flex flex-wrap gap-2">
      {[88,112,72,96,104,80,120,92].map((width,index) => <div key={index} className={`${block} h-9 rounded-full`} style={{ width }} />)}
    </div> : <div aria-hidden="true" className="overflow-hidden rounded-2xl border border-slate-200">
      {[0,1,2].map(index => <div key={index} className="space-y-3 border-b border-slate-100 p-4 last:border-0">
        <div className={`${block} h-4 w-2/5 rounded`} /><div className={`${block} h-3 w-5/6 rounded`} /><div className={`${block} h-3 w-3/5 rounded`} />
      </div>)}
    </div>}
  </div>;
}
