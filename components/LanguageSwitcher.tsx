"use client";

import { useLanguage } from "@/lib/i18n";

export default function LanguageSwitcher({
  className = "",
  variant = "light",
}: {
  className?: string;
  variant?: "light" | "dark";
}) {
  const { locale, toggleLocale } = useLanguage();
  const isHu = locale === "hu";

  const baseStyles =
    variant === "dark"
      ? "border-slate-700 bg-slate-900/90 text-slate-100 hover:border-slate-500 hover:bg-slate-800"
      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50";

  return (
    <button
      aria-label={
        isHu ? "Switch language to English" : "Nyelv váltása magyarra"
      }
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold shadow-xs transition ${baseStyles} ${className}`}
      data-testid="language-switcher"
      onClick={toggleLocale}
      title={isHu ? "Switch to English (EN)" : "Váltás magyar nyelvre (HU)"}
      type="button"
    >
      <span
        className={
          isHu
            ? "rounded bg-blue-600 px-1.5 py-0.5 text-white"
            : "px-1 py-0.5 opacity-60"
        }
      >
        HU
      </span>
      <span aria-hidden="true" className="opacity-40">
        /
      </span>
      <span
        className={
          !isHu
            ? "rounded bg-blue-600 px-1.5 py-0.5 text-white"
            : "px-1 py-0.5 opacity-60"
        }
      >
        EN
      </span>
    </button>
  );
}
