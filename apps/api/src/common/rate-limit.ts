import { HttpException, HttpStatus } from "@nestjs/common";
import { isIPv6 } from "node:net";

/**
 * IP başına sayaçların anahtarı. Bir IPv6 ağının (/64) elinde sayısız adres
 * vardır: her adres yeni kova açsaydı anahtar sınırı dolar, yeni ziyaretçiler
 * bir pencere boyunca reddedilirdi. IPv6 /64 ön ekiyle, IPv4 olduğu gibi sayılır.
 */
export function ipBucket(ip: string) {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1];
  const address = ip.split("%")[0];
  if (!isIPv6(address)) return ip;
  const parts = address.split("::");
  const left = parts[0] ? parts[0].split(":") : [];
  let groups = left;
  if (parts.length === 2) {
    const right = parts[1] ? parts[1].split(":") : [];
    groups = [
      ...left,
      ...new Array<string>(8 - left.length - right.length).fill("0"),
      ...right,
    ];
  }
  return (
    groups
      .slice(0, 4)
      .map((g) => Number.parseInt(g, 16).toString(16))
      .join(":") + "::/64"
  );
}

/**
 * Süreç içi sabit pencereli sayaç. Tek API süreci için yeterli; birden fazla
 * kopya çalışırsa her kopya kendi sayacını tutar (sınır kopya sayısıyla
 * çarpılır), yine de kaba kuvvete ve toplu taramaya karşı taban sağlar.
 *
 * Anahtar sayısı sınırlıdır: her istekte değişen anahtarla (ör. rastgele
 * belirteç) sayaç belleği şişirilemez. Sınır doluyken yeni anahtar, süresi
 * dolan kovalar silinene kadar reddedilir; mevcut anahtarlar etkilenmez.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; reset: number }>();
  private sweptAt = 0;

  constructor(
    readonly limit: number,
    readonly windowMs = 60_000,
    readonly maxKeys = 50_000,
  ) {}

  private sweep(now: number) {
    this.sweptAt = now;
    for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
  }

  /** Sınır aşıldıysa kalan saniyeyi, değilse 0 döndürür. */
  take(key: string, now = Date.now()) {
    if (this.limit <= 0) return 0;
    if (now - this.sweptAt > this.windowMs) this.sweep(now);
    const entry = this.hits.get(key);
    if (!entry || entry.reset <= now) {
      if (!entry && this.hits.size >= this.maxKeys) {
        this.sweep(now);
        if (this.hits.size >= this.maxKeys)
          return Math.ceil(this.windowMs / 1000);
      }
      this.hits.set(key, { count: 1, reset: now + this.windowMs });
      return 0;
    }
    entry.count += 1;
    return entry.count > this.limit ? Math.ceil((entry.reset - now) / 1000) : 0;
  }

  /** Saymadan bakar: sınır doluysa kalan saniye, değilse 0. */
  peek(key: string, now = Date.now()) {
    const entry = this.hits.get(key);
    if (this.limit <= 0 || !entry || entry.reset <= now) return 0;
    return entry.count >= this.limit ? Math.ceil((entry.reset - now) / 1000) : 0;
  }

  check(key: string) {
    const wait = this.take(key);
    if (wait)
      throw new HttpException(
        "api.tooManyRequests",
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }
}

/** Son görülen anahtarlar; en eskisi düşer, süresi dolan sayılmaz. */
export class RecentKeys {
  private readonly seen = new Map<string, number>();

  constructor(
    readonly max: number,
    readonly ttlMs: number,
  ) {}

  has(key: string, now = Date.now()) {
    const at = this.seen.get(key);
    if (at === undefined) return false;
    if (now - at < this.ttlMs) return true;
    this.seen.delete(key);
    return false;
  }

  add(key: string, now = Date.now()) {
    // Silip yeniden eklemek anahtarı en yeniler arasına taşır.
    this.seen.delete(key);
    this.seen.set(key, now);
    if (this.seen.size > this.max)
      this.seen.delete(this.seen.keys().next().value!);
  }

  delete(key: string) {
    this.seen.delete(key);
  }
}
