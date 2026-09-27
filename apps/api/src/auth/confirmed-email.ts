import { UnauthorizedException } from "@nestjs/common";
import type { ApiConfig } from "../config.js";

/**
 * Oturumun e-postasını Auth'a sorar ve yalnızca onaylıysa döndürür.
 * JWT'deki `email` alanı onaylanmamış bir adres olabilir; davet kabulü ve
 * ders isteği gibi başkasına gösterilen ya da yetki veren yerler bunu kullanır.
 */
export async function confirmedEmail(
  config: ApiConfig,
  authorization: string | undefined,
  actorId: string,
): Promise<string | null> {
  const response = await fetch(config.AUTH_ISSUER + "/user", {
    headers: {
      Authorization: authorization ?? "",
      ...(config.SUPABASE_PUBLISHABLE_KEY
        ? { apikey: config.SUPABASE_PUBLISHABLE_KEY }
        : {}),
    },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new UnauthorizedException("api.refreshSession");
  const user = (await response.json()) as {
    id?: string;
    email?: string;
    email_confirmed_at?: string;
  };
  if (user.id !== actorId || !user.email_confirmed_at || !user.email)
    return null;
  return user.email.toLowerCase();
}
