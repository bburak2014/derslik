"use client";
import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { t, type MessageKey } from "@derslik/contracts";

type Theme = "light" | "dark" | "system";
const COOKIE = "derslik-theme";
const EVENT = "derslik-theme-change";
const options: { id: Theme; label: MessageKey; Icon: typeof Sun }[] = [
  { id: "light", label: "theme.light", Icon: Sun },
  { id: "dark", label: "theme.dark", Icon: Moon },
  { id: "system", label: "theme.system", Icon: Monitor },
];

// The root element is the source of truth. The server stamps it from the
// cookie, so reading it back needs no effect and cannot mismatch hydration.
function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}
function readTheme(): Theme {
  const root = document.documentElement.classList;
  return root.contains("dark")
    ? "dark"
    : root.contains("light")
      ? "light"
      : "system";
}

// Kept at module scope: it writes to document, which the React compiler
// rightly refuses to see mutated from inside a component body.
function choose(next: Theme) {
  const root = document.documentElement.classList;
  root.remove("light", "dark");
  if (next !== "system") root.add(next);
  // A year-long cookie keeps the choice; "system" clears it so the tokens
  // fall back to `color-scheme: light dark`.
  document.cookie =
    next === "system"
      ? `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
      : `${COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
  window.dispatchEvent(new Event(EVENT));
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system");

  return (
    <div
      className="theme-toggle"
      role="radiogroup"
      aria-label={t("theme.label")}
    >
      {options.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={theme === id}
          aria-label={t("theme.option", { name: t(label) })}
          title={t(label)}
          data-active={theme === id ? "true" : undefined}
          onClick={() => choose(id)}
        >
          <Icon size={15} aria-hidden="true" />
          <span>{t(label)}</span>
        </button>
      ))}
    </div>
  );
}
