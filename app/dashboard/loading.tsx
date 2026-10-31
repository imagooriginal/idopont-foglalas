function Skeleton({ className }: { className: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-slate-200 ${className}`} />;
}

export default function DashboardLoading() {
  return (
    <div
      aria-label="Dashboard betöltése"
      aria-busy="true"
      className="min-h-screen bg-slate-50"
      role="status"
    >
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-200 bg-white p-6 md:flex">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-6">
          <Skeleton className="size-10 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-2.5 w-20" />
          </div>
        </div>
        <div className="mt-8 space-y-3">
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
        <Skeleton className="mt-auto h-14 w-full rounded-xl" />
      </aside>

      <div className="md:pl-64">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-28 rounded-xl" />
        </header>
        <main className="mx-auto max-w-7xl space-y-8 px-4 py-6 pb-28 sm:px-6 sm:py-8 md:pb-10 lg:px-8">
          <div className="space-y-3">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-9 w-64 max-w-full" />
            <Skeleton className="h-4 w-52" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
                key={item}
              >
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-4 h-9 w-14" />
                <Skeleton className="mt-4 h-3 w-40" />
              </div>
            ))}
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(20rem,0.85fr)]">
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-60 max-w-full" />
              {[0, 1, 2, 3].map((item) => (
                <div
                  className="flex items-center justify-between gap-4 border-t border-slate-100 pt-4"
                  key={item}
                >
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-52 max-w-full" />
                  </div>
                  <Skeleton className="h-6 w-24 rounded-full" />
                </div>
              ))}
            </section>
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-24 w-full rounded-2xl" />
            </section>
          </div>
        </main>
      </div>

      <nav
        aria-hidden="true"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-slate-200 bg-white px-4 pb-[env(safe-area-inset-bottom)] pt-3 md:hidden"
      >
        <Skeleton className="mx-auto h-8 w-14" />
        <Skeleton className="mx-auto h-8 w-14" />
        <Skeleton className="mx-auto h-8 w-14" />
      </nav>
      <span className="sr-only">A foglalási adatok betöltése folyamatban.</span>
    </div>
  );
}
