/**
 * Ziyaretçinin IP adresi, yalnızca `CLIENT_IP_HEADER` ayarlıysa okunur.
 *
 * İstemci her başlığı kendisi yazabilir; bir başlığa ancak web sunucusunun
 * önündeki ters vekil (Caddy, Nginx, Cloudflare) onu kendisi yazıyor ya da
 * sonuna ekliyorsa güvenilir. Bu yüzden hangi başlığın güvenilir olduğunu
 * kurulum söyler:
 *  - `x-forwarded-for`: vekilin eklediği son değer alınır,
 *  - `cf-connecting-ip`, `x-real-ip` vb.: değer olduğu gibi alınır
 *    (vekil üzerine yazmalıdır).
 * Ayar yoksa boş döner; çağıran taraf IP'ye dayalı sınırı atlar. Tüm
 * ziyaretçileri tek bir kovada toplamak, 30 denemeyle herkesin girişini
 * kilitlemeye izin verirdi.
 */
export function clientIp(headers: Headers) {
  const name = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (!name) return "";
  const raw = headers.get(name) ?? "";
  const ip = (name === "x-forwarded-for" ? raw.split(",").at(-1) : raw)?.trim();
  return ip && /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : "";
}
