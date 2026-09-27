import { HttpError } from "./session";

// Giriş, kayıt ve şifre sıfırlama Supabase'e bu sunucudan gider; Supabase
// hepsini aynı IP'den geliyor görür. Kaba kuvvete karşı ilk engel burada:
// süreç içi, sabit pencereli sayaç (tek web kopyası için yeterli).
const buckets = new Map<string, { count: number; reset: number }>();
let sweptAt = 0;

/** `key` için pencere içinde `limit` aşıldıysa 429 fırlatır. */
export function limit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  if (now - sweptAt > 60_000) {
    sweptAt = now;
    for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
  }
  const entry = buckets.get(key);
  if (!entry || entry.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return;
  }
  entry.count += 1;
  if (entry.count > max) throw new HttpError(429, "web.tooManyAttempts");
}
