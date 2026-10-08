import { useId } from "react";
import { MARK_VIEWBOX, ROYAL_GRADIENT, brand, capParts, markParts } from "@derslik/contracts/brand";

/** Tutorwise Academy işareti (açık kitap ve kep), @derslik/contracts/brand'den.
 *  Lacivert kısımlar `currentColor`: koyu kenar çubuğunda ve giriş
 *  ekranında açık, açık zeminde koyu görünür; sayfalar kendi renklerinde. */
export function BrandMark({ className }: Readonly<{ className?: string }>) {
  const id = useId();
  const { x, y, width, height } = MARK_VIEWBOX;
  return (
    <svg viewBox={`${x} ${y} ${width} ${height}`} aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={`${id}-royal`} gradientUnits="userSpaceOnUse" {...ROYAL_GRADIENT}>
          <stop offset="0" stopColor={brand.royal[0]} />
          <stop offset="1" stopColor={brand.royal[1]} />
        </linearGradient>
      </defs>
      <path fill="currentColor" d={markParts.cover.left} />
      <path fill="currentColor" d={markParts.cover.right} />
      <path fill={brand.orange} d={markParts.upper.left} />
      <path fill={brand.sky} d={markParts.upper.right} />
      <path fill={brand.sky} d={markParts.lower.left} />
      <path fill={`url(#${id}-royal)`} d={markParts.lower.right} />
      <path fill="currentColor" stroke="currentColor" strokeWidth="6" strokeLinejoin="round" d={capParts.top} />
      <path fill="currentColor" d={capParts.base} />
      <path fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" d={capParts.cord} />
      <circle fill="currentColor" {...capParts.knob} />
      <path fill="currentColor" d={capParts.tassel} />
    </svg>
  );
}

/** Uygulamadaki marka: işaret ve "Tutorwise" yazısı (logodaki gibi Montserrat). */
export function BrandLockup() {
  return (
    <>
      <BrandMark />
      <span className="brand-name">Tutorwise</span>
    </>
  );
}
