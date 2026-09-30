/** Takvim aboneliği bağlantısından Google ve Apple Takvim'in ekleme adresleri. */
export function calendarLinks(url: string) {
  return {
    url,
    // Apple Takvim (ve Outlook) webcal:// adresine tek dokunuşla abone olur.
    webcal: url.replace(/^https?:\/\//, "webcal://"),
    // Google'a bağlantı adreste verilmez: ?cid=webcal://… verilince Google
    // akışı düz http ile okur ve belirteç şifresiz gider. Kişi https
    // bağlantısını kopyalayıp bu sayfadaki URL alanına yapıştırır.
    google: "https://calendar.google.com/calendar/r/settings/addbyurl",
    // Google bağlantıyı kendi sunucusundan okur; bu bilgisayardaki ya da yerel
    // ağdaki bir adrese ulaşamaz.
    local:
      /^https?:\/\/(localhost|127\.|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(
        url,
      ),
  };
}
