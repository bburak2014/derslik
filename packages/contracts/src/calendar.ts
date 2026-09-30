/** Takvim aboneliği bağlantısından Google ve Apple Takvim'in ekleme adresleri. */
export function calendarLinks(url: string) {
  const webcal = url.replace(/^https?:\/\//, "webcal://");
  return {
    url,
    webcal,
    google:
      "https://calendar.google.com/calendar/r?cid=" +
      encodeURIComponent(webcal),
    // Google bağlantıyı kendi sunucusundan okur; bu bilgisayardaki ya da yerel
    // ağdaki bir adrese ulaşamaz.
    local:
      /^https?:\/\/(localhost|127\.|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(
        url,
      ),
  };
}
