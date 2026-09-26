// Sosyal girişten sonra dönülecek sayfa. Açık yönlendirmeye izin vermemek için
// yalnızca bilinen biçimler kabul edilir: davet bağlantısı ve vitrinde
// seçilen öğretmen (/?teacher=...).
const ALLOWED = [
  /^\/invite\/[a-f0-9]{64}\/?$/,
  /^\/\?teacher=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
];
export const safeAuthNext = (value: string | undefined) =>
  value && ALLOWED.some((pattern) => pattern.test(value)) ? value : "/";
