import Link from "next/link";
import LanguageSwitcher from "@/components/LanguageSwitcher";

export default function Home() {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-slate-950 px-5 py-16 text-white">
      <div className="absolute right-5 top-5">
        <LanguageSwitcher variant="dark" />
      </div>
      <section className="w-full max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-300">
          Időpontfoglaló
        </p>
        <h1 className="mt-5 max-w-2xl text-4xl font-bold tracking-tight sm:text-6xl">
          Szervizidőpont, egyszerűen.
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-8 text-slate-300">
          Foglalási felület motorszervizeknek és ügyfeleiknek. A szolgáltató
          publikus oldala a saját cégslugján érhető el.
        </p>
        <div className="mt-8">
          <Link
            className="rounded-lg bg-blue-500 px-5 py-3 font-semibold text-white hover:bg-blue-400"
            href="/dashboard/login"
          >
            Szolgáltatói belépés
          </Link>
        </div>
      </section>
    </main>
  );
}
