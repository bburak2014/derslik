/**
 * Ziyaretçinin IP adresi. Web sunucusunun önündeki ters vekil (Caddy, Nginx,
 * yük dengeleyici) X-Forwarded-For'a gördüğü adresi ekler. İstemci bu başlığa
 * istediğini yazabildiği için ilk değere değil, vekilin eklediği son değere
 * güvenilir. Vekil yoksa (yerel geliştirme) boş döner.
 */
export function clientIp(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  const ip = forwarded || headers.get("x-real-ip")?.trim() || "";
  return /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : "";
}
