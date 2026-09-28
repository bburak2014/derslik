"use client";
import { AuthForm } from "@/components/account/auth-form";
export default function Page() {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- tam sayfa yüklemesi bilerek: oturum bağlamı ve uygulama kabuğu baştan kurulur.
  return <AuthForm reset onSuccess={() => location.assign("/")} />;
}
