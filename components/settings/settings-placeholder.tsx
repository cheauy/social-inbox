type SettingsPlaceholderProps = {
  title: string;
  description: string;
};

export function SettingsPlaceholder({
  title,
  description,
}: SettingsPlaceholderProps) {
  return (
    <main className="mx-auto max-w-5xl">
      <h2 className="text-3xl font-bold text-slate-900">
        {title}
      </h2>

      <p className="mt-2 text-slate-500">
        {description}
      </p>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-8 text-slate-500 shadow-sm">
        This feature will be added in a later phase.
      </div>
    </main>
  );
}