// 3.x supports the native WebView script format. Every document disables
// evaluation, the vendor mitigation for crafted font programs (CVE-2024-4367).
export const nativePdfJsUrl = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";

/** Never allow data to terminate an inline script element. */
export const pdfScriptJson = (value: string | number) =>
  JSON.stringify(value).replaceAll("<", String.raw`\u003c`);
