import { json } from "@/lib/server/session";
import { serverText } from "@/lib/server/locale";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Not configured");
    const response = await fetch(new URL("/auth/v1/settings", url), {
      headers: { apikey: key },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Unavailable");
    const settings = (await response.json()) as {
      external?: Record<string, boolean>;
    };
    return json({
      providers: ["google", "apple", "azure"].filter(
        (p) => settings.external?.[p] === true,
      ),
    });
  } catch {
    return json(
      {
        error: await serverText("web.providersFailed"),
      },
      503,
    );
  }
}
