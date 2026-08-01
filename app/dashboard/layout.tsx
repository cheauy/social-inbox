import Link from "next/link";

const navigation = [
  {
    name: "Inbox",
    href: "/dashboard/inbox",
  },
  {
    name: "Customers",
    href: "/dashboard/customers",
  },
  {
    name: "Integrations",
    href: "/dashboard/integrations",
  },
  {
    name: "Settings",
    href: "/dashboard/settings",
  },
];

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-slate-100">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-200 bg-white lg:block">
        <div className="border-b border-slate-200 px-6 py-5">
          <Link
            href="/"
            className="text-xl font-bold text-slate-900"
          >
            Social Inbox
          </Link>

          <p className="mt-1 text-xs text-slate-500">
            Customer messaging
          </p>
        </div>

        <nav className="space-y-1 p-4">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-xl px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
            >
              {item.name}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="lg:pl-64">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
          <div>
            <p className="font-semibold text-slate-900">
              Facebook customer service
            </p>
          </div>

          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
            A
          </div>
        </header>

        {children}
      </div>
    </div>
  );
}