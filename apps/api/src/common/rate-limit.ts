import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * Süreç içi sabit pencereli sayaç. Tek API süreci için yeterli; birden fazla
 * kopya çalışırsa her kopya kendi sayacını tutar (sınır kopya sayısıyla
 * çarpılır), yine de kaba kuvvete ve toplu taramaya karşı taban sağlar.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; reset: number }>();
  private sweptAt = 0;

  constructor(
    readonly limit: number,
    readonly windowMs = 60_000,
  ) {}

  /** Sınır aşıldıysa kalan saniyeyi, değilse 0 döndürür. */
  take(key: string, now = Date.now()) {
    if (this.limit <= 0) return 0;
    if (now - this.sweptAt > this.windowMs) {
      this.sweptAt = now;
      for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
    }
    const entry = this.hits.get(key);
    if (!entry || entry.reset <= now) {
      this.hits.set(key, { count: 1, reset: now + this.windowMs });
      return 0;
    }
    entry.count += 1;
    return entry.count > this.limit ? Math.ceil((entry.reset - now) / 1000) : 0;
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
