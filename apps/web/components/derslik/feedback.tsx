import { CircleAlert, CircleCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

/** Form hatası: her ekranda aynı shadcn uyarısı, aynı ikon ve renk. */
export function FormError({ children }: { children: React.ReactNode }) {
  return (
    <Alert
      variant="destructive"
      className="border-destructive/30 bg-destructive/5"
    >
      <CircleAlert />
      <AlertDescription className="text-destructive">
        {children}
      </AlertDescription>
    </Alert>
  );
}

/** Başarılı bir işlemin kalıcı bildirimi (ör. "e-postanızı kontrol edin"). */
export function FormSuccess({ children }: { children: React.ReactNode }) {
  return (
    <Alert
      role="status"
      className="border-(--ok)/30 bg-(--ok-soft) text-(--ok)"
    >
      <CircleCheck />
      <AlertDescription className="text-(--ok)">{children}</AlertDescription>
    </Alert>
  );
}

export type Tone = "ok" | "warn" | "info" | "danger" | "muted";
const tones: Record<Tone, string> = {
  ok: "bg-(--ok-soft) text-(--ok)",
  warn: "bg-(--warn-soft) text-(--warn)",
  info: "bg-(--info-soft) text-(--info)",
  danger: "bg-(--danger-soft) text-(--danger)",
  muted: "bg-muted text-muted-foreground",
};
/** Durum rozeti: shadcn Badge, anlamı renk tonundan gelir. Uygulamadaki bütün
 *  durum etiketleri (ders, ödev, video, davet, ödeme, ders hakkı) bunu
 *  kullanır. */
export function ToneBadge({
  tone,
  children,
  className = "",
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Badge variant="secondary" className={`${tones[tone]} ${className}`}>
      {children}
    </Badge>
  );
}
