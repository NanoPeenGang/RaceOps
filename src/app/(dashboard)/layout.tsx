export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <main className="mx-auto max-w-6xl px-4 py-10">{children}</main>;
}
