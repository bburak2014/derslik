import { localeFlags, type Locale } from "@derslik/contracts";
import { cn } from "@/lib/utils";

/** Dilin bayrağı; ad yanında durduğu için ekran okuyucudan gizli. */
export function Flag({
  locale,
  className = "",
}: {
  locale: Locale;
  className?: string;
}) {
  const flag = localeFlags[locale];
  return (
    <svg
      viewBox={flag.viewBox}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className={cn(
        "size-auto h-3.5 w-[21px] shrink-0 rounded-[2px] ring-1 ring-foreground/10",
        className,
      )}
    >
      {flag.shapes.map((shape, i) => (
        <path key={i} d={shape.d} fill={shape.fill} />
      ))}
    </svg>
  );
}
