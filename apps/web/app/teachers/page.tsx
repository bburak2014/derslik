import type { Metadata } from "next";
import { PublicDirectory } from "@/components/derslik/public-directory";
import { serverText } from "@/lib/server/locale";
import { hasSessionCookie } from "@/lib/server/session";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: `${await serverText("dir.findTitle")} · Derslik`,
    description: await serverText("dir.findSubtitle"),
  };
}
export default async function Page() {
  return <PublicDirectory hasSession={await hasSessionCookie()} />;
}
