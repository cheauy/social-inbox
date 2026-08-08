type FacebookConnectionButtonProps = {
  connected?: boolean;
  pageName?: string | null;
};

export function FacebookConnectionButton({
  connected = false,
  pageName,
}: FacebookConnectionButtonProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-lg font-bold text-white">
              f
            </div>

            <div>
              <h3 className="font-semibold text-slate-900">
                Facebook
              </h3>

              <p className="text-sm text-slate-500">
                {connected
                  ? `Connected${pageName ? ` to ${pageName}` : ""}`
                  : "Connect your Facebook Page to Tenh Chat"}
              </p>
            </div>
          </div>
        </div>

        <a
          href="/api/facebook/oauth/connect"
          className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
            connected
              ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          {connected
            ? "Reconnect"
            : "Connect Facebook"}
        </a>
      </div>
    </div>
  );
}