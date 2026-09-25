import type { Metadata } from "next";
import { PublicDirectory } from "@/components/derslik/public-directory";
import { serverText } from "@/lib/server/locale";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: `${await serverText("dir.findTitle")} · Derslik`,
    description: await serverText("dir.findSubtitle"),
  };
}
export default function Page() {
  return <PublicDirectory />;
}
