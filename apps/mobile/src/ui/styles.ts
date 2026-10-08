import { StyleSheet } from "react-native";
import { type Palette, radius, type Typography } from "./tokens";

/* ------------------------------------------------------------------ */
/* Paylaşılan stil sayfaları                                           */
/* ------------------------------------------------------------------ */

export const makeStyles = (colors: Palette, type: Typography) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.canvas },
    body: { padding: 20, paddingBottom: 44, gap: 16 },

    // Yazı
    brand: {
      ...type.heavy,
      fontSize: 23,
      letterSpacing: -0.9,
      color: colors.ink,
    },
    title: {
      ...type.heavy,
      fontSize: 28,
      lineHeight: 34,
      letterSpacing: -0.7,
      color: colors.ink,
    },
    h2: {
      ...type.display,
      fontSize: 17,
      lineHeight: 23,
      letterSpacing: -0.3,
      color: colors.ink,
    },
    text: { ...type.regular, fontSize: 15, lineHeight: 22, color: colors.text },
    muted: {
      ...type.regular,
      fontSize: 14,
      lineHeight: 20,
      color: colors.muted,
    },
    caption: {
      ...type.regular,
      fontSize: 12.5,
      lineHeight: 17,
      color: colors.faint,
    },
    // Web'deki .eyebrow: küçük, aralıklı, marka renginde. Büyük harfe Kicker
    // bileşeni çevirir; textTransform Türkçe "i"yi "I" yapıyordu.
    kicker: {
      ...type.semibold,
      fontSize: 11,
      letterSpacing: 1.3,
      color: colors.brand,
    },
    label2: {
      ...type.semibold,
      fontSize: 11,
      letterSpacing: 1.1,
      color: colors.muted,
    },
    link: { ...type.semibold, fontSize: 14, color: colors.brand },

    // Düzen
    card: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.card,
      padding: 16,
      gap: 10,
      boxShadow: colors.shadowCard,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 8,
    },
    divider: { height: 1, backgroundColor: colors.line, marginVertical: 4 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      minHeight: 60,
      paddingHorizontal: 20,
      paddingVertical: 8,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.line,
    },

    // Düğmeler: shadcn Button (default / outline / ghost / destructive).
    button: {
      minHeight: 48,
      borderRadius: radius.control,
      paddingVertical: 12,
      paddingHorizontal: 18,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderWidth: 1,
      borderColor: colors.brand,
      backgroundColor: colors.brand,
      boxShadow: colors.shadowXs,
    },
    // Metin satıra sığmazsa kısalır; yoksa RN'de (flexShrink 0) yanındaki
    // simgeleri düğmenin dışına iter.
    buttonText: {
      ...type.medium,
      fontSize: 15,
      color: colors.onBrand,
      flexShrink: 1,
    },
    secondary: {
      backgroundColor: colors.surface,
      borderColor: colors.lineControl,
    },
    secondaryText: { color: colors.ink },
    ghost: {
      backgroundColor: "transparent",
      borderColor: "transparent",
      boxShadow: "none",
    },
    ghostText: { color: colors.ink },
    danger: {
      backgroundColor: colors.surface,
      borderColor: colors.dangerLine,
    },
    dangerText: { color: colors.danger },
    onInk: {
      backgroundColor: "transparent",
      borderColor: "rgba(255,255,255,0.18)",
      boxShadow: "none",
    },
    onInkText: { color: colors.onFeature },
    buttonSmall: {
      minHeight: 40,
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: radius.inner,
    },
    buttonSmallText: { fontSize: 14 },

    // Form
    field: { gap: 8 },
    label: {
      ...type.medium,
      fontSize: 14,
      color: colors.ink,
    },
    hint: {
      ...type.regular,
      fontSize: 13,
      lineHeight: 18,
      color: colors.muted,
    },
    input: {
      ...type.regular,
      borderWidth: 1,
      borderColor: colors.lineControl,
      borderRadius: radius.control,
      paddingHorizontal: 14,
      paddingVertical: 12,
      minHeight: 48,
      backgroundColor: colors.surface,
      fontSize: 16,
      color: colors.ink,
      boxShadow: colors.shadowXs,
    },
    // shadcn odak durumu: kenar halka renginde, çevresinde 3 px yarı saydam
    // halka.
    inputFocused: {
      borderColor: colors.ring,
      boxShadow: `0 0 0 3px ${colors.ringSoft}`,
    },
    inputInvalid: {
      borderColor: colors.danger,
      boxShadow: `0 0 0 3px ${colors.dangerRing}`,
    },
    inputDisabled: { opacity: 0.5 },
  });

export const makeSection = (colors: Palette, type: Typography) =>
  StyleSheet.create({
    iconButton: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.lineControl,
      backgroundColor: colors.surface,
      boxShadow: colors.shadowXs,
    },
    iconGhost: {
      borderColor: "transparent",
      backgroundColor: "transparent",
      boxShadow: "none",
    },
    count: {
      position: "absolute",
      top: -5,
      right: -5,
      minWidth: 19,
      height: 19,
      paddingHorizontal: 5,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.marker,
      borderWidth: 2,
      borderColor: colors.surface,
    },
    countText: {
      ...type.semibold,
      fontSize: 10,
      lineHeight: 12,
      color: colors.markerInk,
      fontVariant: ["tabular-nums"],
    },
    pickerTrigger: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    pillTrigger: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 36,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.lineControl,
      backgroundColor: colors.surface,
    },
    pillText: {
      fontSize: 13.5,
    },
    pickerBackdrop: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: colors.overlay,
    },
    pickerSheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.sheet,
      borderTopRightRadius: radius.sheet,
      paddingHorizontal: 16,
      paddingTop: 8,
      gap: 12,
    },
    grabber: {
      alignSelf: "center",
      width: 36,
      height: 4,
      borderRadius: radius.pill,
      backgroundColor: colors.lineControl,
    },
    pickerHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    pickerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 48,
      paddingHorizontal: 12,
      borderRadius: radius.inner,
    },
    wrap: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginTop: 6,
    },
    sectionTitle: {
      ...type.display,
      fontSize: 18,
      lineHeight: 24,
      letterSpacing: -0.35,
      color: colors.ink,
    },
    // shadcn Badge: tam yuvarlak, kenarsız, anlamı renk tonundan gelir.
    badge: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: radius.pill,
      alignSelf: "flex-start",
    },
    badgeText: { ...type.medium, fontSize: 12, lineHeight: 16, flexShrink: 1 },
    badgeDot: { width: 6, height: 6, borderRadius: 3 },
    empty: {
      alignItems: "center",
      gap: 8,
      paddingVertical: 28,
      paddingHorizontal: 20,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.lineControl,
      borderStyle: "dashed",
    },
    emptyIcon: {
      width: 44,
      height: 44,
      marginBottom: 4,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.sunken,
    },
    emptyTitle: {
      ...type.display,
      fontSize: 16,
      lineHeight: 22,
      letterSpacing: -0.2,
      color: colors.ink,
      textAlign: "center",
    },
    // shadcn Alert: ince kenar, yumuşak zemin, simge + metin.
    alert: {
      flexDirection: "row",
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.dangerLine,
      backgroundColor: colors.dangerSoft,
    },
    alertSuccess: {
      borderColor: colors.okLine,
      backgroundColor: colors.okSoft,
    },
    alertText: {
      ...type.regular,
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
      color: colors.danger,
    },
    labelRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    fieldError: {
      ...type.regular,
      fontSize: 13,
      lineHeight: 18,
      color: colors.danger,
    },
    // shadcn TabsList: gömük zemin, seçili parça yüzey renginde ve gölgeli.
    segmented: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 4,
      padding: 4,
      borderRadius: radius.control + 2,
      backgroundColor: colors.sunken,
    },
    segment: {
      flexGrow: 1,
      flexBasis: 90,
      minHeight: 40,
      flexDirection: "row",
      gap: 6,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 12,
      borderRadius: radius.inner,
      borderWidth: 1,
      borderColor: "transparent",
    },
    segmentOn: {
      backgroundColor: colors.surface,
      borderColor: colors.line,
      boxShadow: colors.shadowXs,
    },
    segmentText: {
      ...type.medium,
      fontSize: 14,
      color: colors.muted,
      flexShrink: 1,
    },
    segmentTextOn: { color: colors.ink },
    close: {
      width: 40,
      height: 40,
      borderRadius: radius.control,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.sunken,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 14,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.line,
    },
    sheetTitle: {
      ...type.display,
      fontSize: 19,
      lineHeight: 25,
      letterSpacing: -0.4,
      color: colors.ink,
    },
    footer: {
      flexDirection: "row",
      gap: 10,
      padding: 16,
      paddingBottom: 18,
      borderTopWidth: 1,
      borderTopColor: colors.line,
      backgroundColor: colors.surface,
    },

    // Marka: Tutorwise Academy işareti ve yazısı (ui/brand.tsx).
    brandRow: { flexDirection: "row", alignItems: "center", gap: 10 },

    // Mürekkep yüzeyi
    ink: {
      borderRadius: radius.panel,
      borderWidth: 1,
      padding: 18,
      gap: 16,
      overflow: "hidden",
    },

    // Alt gezinme: web'deki lacivert kenar çubuğunun mobil karşılığı. Etkin
    // sekme, kenar çubuğundaki defter ayracı gibi sayfaya bağlanır: tuval
    // renginde, üst kenardan sarkar.
    tabBar: {
      flexDirection: "row",
      gap: 2,
      paddingHorizontal: 6,
      backgroundColor: colors.navy,
      overflow: "hidden",
    },
    tab: {
      flex: 1,
      minHeight: 58,
      paddingTop: 9,
      paddingBottom: 8,
      gap: 4,
      alignItems: "center",
      justifyContent: "center",
      borderBottomLeftRadius: 16,
      borderBottomRightRadius: 16,
    },
    tabOn: { backgroundColor: colors.canvas },
    tabText: {
      ...type.medium,
      fontSize: 11,
      color: colors.onNavy,
      textAlign: "center",
    },
    tabTextOn: { ...type.semibold, color: colors.ink },

    // Tarih karosu (web: .date-tile). Bugün fosforlu kalemle işaretlenir.
    dateTile: {
      width: 48,
      height: 52,
      borderRadius: radius.control,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.sunken,
    },
    dateMonth: {
      ...type.semibold,
      fontSize: 9.5,
      letterSpacing: 0.8,
      color: colors.muted,
    },
    dateDay: {
      ...type.display,
      fontSize: 20,
      lineHeight: 24,
      color: colors.ink,
      fontVariant: ["tabular-nums"],
    },

    avatarText: { ...type.semibold, letterSpacing: 0.2 },

    metric: {
      flex: 1,
      minWidth: 140,
      padding: 14,
      gap: 4,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.card,
      boxShadow: colors.shadowCard,
    },
    metricValue: {
      ...type.display,
      fontSize: 24,
      lineHeight: 30,
      letterSpacing: -0.6,
      color: colors.ink,
      fontVariant: ["tabular-nums"],
    },

    // Gruplu liste: tek kart içinde ayraçlı satırlar.
    list: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.card,
      overflow: "hidden",
      boxShadow: colors.shadowCard,
    },
    listRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 64,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },

    // Teslim, geri bildirim ve video soruları: gömük zeminli alıntı kutusu.
    quote: {
      gap: 4,
      padding: 12,
      borderRadius: radius.control,
      backgroundColor: colors.sunken,
    },
    fileIcon: {
      width: 40,
      height: 40,
      borderRadius: radius.control,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.brandSoft,
    },
    videoThumb: {
      width: 64,
      height: 48,
      borderRadius: radius.control,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.feature,
    },
    notice: {
      flexDirection: "row",
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    noticeIcon: {
      width: 32,
      height: 32,
      marginTop: 1,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    unreadDot: {
      width: 8,
      height: 8,
      marginTop: 6,
      borderRadius: 4,
      backgroundColor: colors.brand,
    },

    // Mürekkep paneldeki sayılar (web: .day-figures)
    figures: { flexDirection: "row", flexWrap: "wrap", rowGap: 16 },
    figure: { width: "50%", gap: 4, paddingRight: 8 },
    figureLabel: {
      ...type.semibold,
      fontSize: 10.5,
      letterSpacing: 1,
      color: colors.onFeatureMuted,
    },
    figureValue: {
      ...type.display,
      fontSize: 22,
      lineHeight: 28,
      letterSpacing: -0.4,
      color: colors.onFeature,
      fontVariant: ["tabular-nums"],
    },

    // shadcn Progress
    meterTrack: {
      height: 8,
      borderRadius: radius.pill,
      overflow: "hidden",
      backgroundColor: colors.brandSoft,
    },
    meterFill: {
      height: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.brand,
    },
  });
