import type { Locale } from "./core.ts";

/** Dil seçicideki bayraklar. Emoji bayrakları Windows'ta harf olarak görünür,
 *  bu yüzden web ve mobil aynı SVG yollarını çizer. İngilizce için Birleşik
 *  Krallık, İspanyolca için İspanya, Çince için Çin bayrağı seçildi. */
export type Flag = { viewBox: string; shapes: { d: string; fill: string }[] };

export const localeFlags: Record<Locale, Flag> = {
  tr: {
    viewBox: "0 0 30 20",
    shapes: [
      { d: "M0 0 30 0 30 20 0 20Z", fill: "#E30A17" },
      { d: "M5 10a5 5 0 1 0 10 0a5 5 0 1 0 -10 0Z", fill: "#FFFFFF" },
      { d: "M7.25 10a4 4 0 1 0 8 0a4 4 0 1 0 -8 0Z", fill: "#E30A17" },
      {
        d: "M14.58 10 16.31 9.44 16.31 7.62 17.38 9.09 19.1 8.53 18.03 10 19.1 11.47 17.38 10.91 16.31 12.38 16.31 10.56Z",
        fill: "#FFFFFF",
      },
    ],
  },
  en: {
    viewBox: "0 0 60 30",
    shapes: [
      { d: "M0 0 60 0 60 30 0 30Z", fill: "#012169" },
      {
        d: "M-7.34 -0.32 64.66 35.68 67.34 30.32 -4.66 -5.68Z",
        fill: "#FFFFFF",
      },
      {
        d: "M-4.66 35.68 67.34 -0.32 64.66 -5.68 -7.34 30.32Z",
        fill: "#FFFFFF",
      },
      { d: "M-6 -3 30 15 29.11 16.79 -6.89 -1.21Z", fill: "#C8102E" },
      { d: "M30 15 66 33 66.89 31.21 30.89 13.21Z", fill: "#C8102E" },
      { d: "M30 15 -6 33 -5.11 34.79 30.89 16.79Z", fill: "#C8102E" },
      { d: "M30 15 66 -3 65.11 -4.79 29.11 13.21Z", fill: "#C8102E" },
      { d: "M25 0 35 0 35 30 25 30Z", fill: "#FFFFFF" },
      { d: "M0 10 60 10 60 20 0 20Z", fill: "#FFFFFF" },
      { d: "M27 0 33 0 33 30 27 30Z", fill: "#C8102E" },
      { d: "M0 12 60 12 60 18 0 18Z", fill: "#C8102E" },
    ],
  },
  de: {
    viewBox: "0 0 30 20",
    shapes: [
      { d: "M0 0 30 0 30 6.67 0 6.67Z", fill: "#000000" },
      { d: "M0 6.67 30 6.67 30 13.33 0 13.33Z", fill: "#DD0000" },
      { d: "M0 13.33 30 13.33 30 20 0 20Z", fill: "#FFCE00" },
    ],
  },
  fr: {
    viewBox: "0 0 30 20",
    shapes: [
      { d: "M0 0 10 0 10 20 0 20Z", fill: "#002654" },
      { d: "M10 0 20 0 20 20 10 20Z", fill: "#FFFFFF" },
      { d: "M20 0 30 0 30 20 20 20Z", fill: "#CE1126" },
    ],
  },
  es: {
    viewBox: "0 0 30 20",
    shapes: [
      { d: "M0 0 30 0 30 20 0 20Z", fill: "#AA151B" },
      { d: "M0 5 30 5 30 15 0 15Z", fill: "#F1BF00" },
    ],
  },
  zh: {
    viewBox: "0 0 30 20",
    shapes: [
      { d: "M0 0 30 0 30 20 0 20Z", fill: "#EE1C25" },
      {
        d: "M5 2 5.67 4.07 7.85 4.07 6.09 5.35 6.76 7.43 5 6.15 3.24 7.43 3.91 5.35 2.15 4.07 4.33 4.07Z",
        fill: "#FFFF00",
      },
      {
        d: "M9.14 2.51 9.62 1.97 9.25 1.34 9.91 1.63 10.39 1.08 10.33 1.8 11 2.09 10.29 2.25 10.22 2.97 9.85 2.35Z",
        fill: "#FFFF00",
      },
      {
        d: "M11.01 4.14 11.66 3.82 11.56 3.1 12.07 3.62 12.72 3.3 12.38 3.95 12.88 4.47 12.17 4.34 11.83 4.99 11.73 4.27Z",
        fill: "#FFFF00",
      },
      {
        d: "M11.04 6.73 11.76 6.7 11.96 6 12.21 6.68 12.94 6.66 12.37 7.1 12.62 7.79 12.01 7.38 11.44 7.83 11.64 7.13Z",
        fill: "#FFFF00",
      },
      {
        d: "M9.22 8.38 9.9 8.63 10.35 8.06 10.32 8.79 11 9.05 10.3 9.24 10.26 9.96 9.87 9.36 9.16 9.55 9.62 8.98Z",
        fill: "#FFFF00",
      },
    ],
  },
  ja: {
    viewBox: "0 0 30 20",
    shapes: [
      { d: "M0 0 30 0 30 20 0 20Z", fill: "#FFFFFF" },
      { d: "M9 10a6 6 0 1 0 12 0a6 6 0 1 0 -12 0Z", fill: "#BC002D" },
    ],
  },
};
