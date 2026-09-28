import type { Metadata } from "next";
import { PublicDirectory } from "@/components/derslik/public-directory";
import { serverText } from "@/lib/server/locale";
import { hasSessionCookie } from "@/lib/server/session";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: `${await serverText("dir.findTitle")} · Derslik` };
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ request?: string | string[] }>;
}) {
  const { id } = await params;
  const { request } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id))
    return (
      <main className="connection-state">
        <h1>{await serverText("api.teacherNotFound")}</h1>
        <a href="/teachers">{await serverText("dir.back")}</a>
      </main>
    );
  return (
    <PublicDirectory
      teacherId={id}
      hasSession={await hasSessionCookie()}
      openRequest={request === "1"}
    />
  );
}
