"use client";
import { AuthForm } from "@/components/account/auth-form";
export default function Page() {
  return <AuthForm reset onSuccess={() => location.assign("/")} />;
}
