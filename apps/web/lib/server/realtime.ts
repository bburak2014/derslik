/**
 * Anlık mesajlaşma soketinin adresi. Tarayıcı sokete doğrudan API'ye bağlanır
 * (web sunucusu yalnızca bileti verir), bu yüzden adres tarayıcının erişebildiği
 * API adresidir: `API_PUBLIC_URL`, yoksa `API_BASE_URL` (yerel geliştirmede
 * ikisi aynıdır; Docker'da API_BASE_URL iç ağ adresidir, API_PUBLIC_URL
 * verilmelidir). Ayarlanmamışsa null: istemci yalnızca yoklamayla çalışır.
 */
export function socketUrl() {
  const base = process.env.API_PUBLIC_URL || process.env.API_BASE_URL;
  if (!base) return null;
  try {
    const url = new URL("/v1/socket", base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.href;
  } catch {
    return null;
  }
}
