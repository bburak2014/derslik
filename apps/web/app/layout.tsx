import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

// Self-hosted by next/font, so the Content-Security-Policy stays at
// `font-src 'self'` with no external font origin.
const inter = Inter({
  subsets: ["latin", "latin-ext"], // latin-ext carries ğ İ ı ş
  display: "swap",
  variable: "--font-derslik",
});

export const metadata: Metadata = {
  title: "Derslik · Öğretmen çalışma alanı",
  description: "Öğrencileriniz, dersleriniz ve tahsilatlarınız bir arada.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // An explicit choice travels in a cookie so the server already renders the
  // right class — no blocking inline script and no light-to-dark flash. With
  // no cookie the class is omitted and the tokens follow the operating system
  // through `color-scheme: light dark`.
  const choice = (await cookies()).get("derslik-theme")?.value;
  const theme = choice === "dark" || choice === "light" ? choice : undefined;
  return (
    <html
      lang="tr"
      className={theme ? `${inter.variable} ${theme}` : inter.variable}
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
