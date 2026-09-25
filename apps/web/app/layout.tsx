import type { Metadata } from "next";
import { Bricolage_Grotesque, Onest } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

// Self-hosted by next/font, so the Content-Security-Policy stays at
// `font-src 'self'` with no external font origin.
const onest = Onest({
  subsets: ["latin", "latin-ext"], // latin-ext carries ğ İ ı ş
  display: "swap",
  variable: "--font-derslik",
});
// Başlıklar için karakterli yüz; gövde metni Onest'te kalır.
const bricolage = Bricolage_Grotesque({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-derslik-display",
});
const fonts = `${onest.variable} ${bricolage.variable}`;

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
    <html lang="tr" className={theme ? `${fonts} ${theme}` : fonts}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
