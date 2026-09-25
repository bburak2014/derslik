import React, { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import type { Session } from "@supabase/supabase-js";
import type { Access } from "@derslik/api-client";
import { configured, request, supabase, watchRefresh } from "./core";
import { AuthScreen } from "./AuthScreen";
import { authRoute, completeAuthLink } from "./oauth";
import { TeacherScreen } from "./TeacherScreen";
import { PortalScreen, type NoticeFocus } from "./LearningScreen";
import type { NoticeTarget } from "@derslik/contracts";
import { Ionicons } from "@expo/vector-icons";
import {
  Avatar,
  Badge,
  Brand,
  Button,
  Card,
  EmptyState,
  ErrorText,
  FormSheet,
  type FormSpec,
  confirmAction,
  Kicker,
  Loading,
  ThemeProvider,
  ThemeToggle,
  useTheme,
} from "./ui";

type AccessRef = Pick<Access, "id" | "role" | "studentId">;
const sameAccess = (a: Access, b?: AccessRef | null) =>
  !!b && a.id === b.id && a.studentId === b.studentId && a.role === b.role;

function Application() {
  const { colors, styles } = useTheme();
  const [session, setSession] = useState<Session | null>(null),
    [boot, setBoot] = useState(true),
    [access, setAccess] = useState<Access[]>([]),
    [active, setActive] = useState<Access | null>(null),
    [error, setError] = useState(""),
    [reset, setReset] = useState(false),
    [invite, setInvite] = useState<string | null>(null),
    [form, setForm] = useState<FormSpec | null>(null),
    [switching, setSwitching] = useState(false),
    // Bildirimden açılacak yer. Bildirim başka bir görünüme (ör. velinin
    // ikinci çocuğu) aitse önce o görünüme geçilir.
    [focus, setFocus] = useState<NoticeFocus | null>(null);
  const openNotice = (target: NoticeTarget) => {
    const fits = (a: Access) =>
      a.id === target.workspaceId &&
      (a.role === "OWNER" || a.studentId === target.studentId);
    const next =
      (active && fits(active) ? active : null) ||
      access.find((a) => fits(a) && a.role === "OWNER") ||
      access.find(fits);
    if (!next) {
      setError("Bu bildirimin ait olduğu alana artık erişiminiz yok.");
      return;
    }
    setActive(next);
    setFocus({ ...target, at: Date.now() });
  };
  // `prefer` opens a given view, such as an invitation just accepted;
  // otherwise the current view stays selected.
  const load = useCallback(async (prefer?: AccessRef) => {
    try {
      const r = await request<{ data: Access[] }>("/access");
      setAccess(r.data);
      setActive(
        (old) =>
          r.data.find((a) => sameAccess(a, prefer)) ||
          r.data.find((a) => sameAccess(a, old)) ||
          r.data[0] ||
          null,
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBoot(false);
    }
  }, []);
  useEffect(() => {
    if (!supabase) {
      setBoot(false);
      return;
    }
    let alive = true;
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (alive) {
          setSession(data.session);
          if (!data.session) setBoot(false);
        }
      })
      .catch(() => {
        if (alive) setBoot(false);
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      if (!alive) return;
      setSession((previous) =>
        previous?.access_token === next?.access_token ? previous : next,
      );
      if (event === "PASSWORD_RECOVERY") setReset(true);
      if (!next) {
        setAccess([]);
        setActive(null);
        setBoot(false);
      }
    });
    const stop = watchRefresh();
    const handle = async (url: string) => {
      try {
        // Expo Go delivers the same routes as exp://<host>/--/<path>, so the
        // link is matched on its trailing segments rather than on the scheme.
        const parsed = Linking.parse(url);
        const segments = [parsed.hostname || "", parsed.path || ""]
          .join("/")
          .split("/")
          .filter((s) => s && s !== "--");
        const token = segments.at(-1);
        if (
          segments.at(-2) === "invite" &&
          token &&
          /^[a-f0-9]{64}$/.test(token)
        ) {
          setInvite(token);
          return;
        }
        const route = authRoute(url);
        if (route && (await completeAuthLink(url)) && route === "recovery")
          setReset(true);
      } catch {
        Alert.alert(
          "Bağlantı açılamadı",
          "Bağlantının süresi dolmuş olabilir. Yeniden giriş yapın veya yeni bağlantı isteyin.",
        );
      }
    };
    void Linking.getInitialURL().then((u) => {
      if (u) void handle(u);
    });
    const deep = Linking.addEventListener("url", ({ url }) => void handle(url));
    return () => {
      alive = false;
      subscription.unsubscribe();
      stop();
      deep.remove();
    };
  }, []);
  useEffect(() => {
    if (session) void load();
  }, [session?.user.id, load]);
  async function signout() {
    try {
      const { error } = await supabase!.auth.signOut();
      if (error) throw error;
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const accountForm = () =>
    setForm({
      title: "Davet kabul et",
      description:
        "Öğretmeninizin gönderdiği davet bağlantısını buraya yapıştırın.",
      fields: [{ key: "link", label: "Davet bağlantısı", value: invite || "" }],
      submit: async (v) => {
        const token = v.link.match(/([a-f0-9]{64})\/?$/)?.[1];
        if (!token) throw new Error("Geçerli davet bağlantısı girin.");
        const r = await request<{
          data: {
            workspaceId: string;
            role: Access["role"];
            studentId: string;
          };
        }>("/invitations/accept", { token });
        setInvite(null);
        // Go straight to the view just joined; an account that also teaches
        // would otherwise stay in its own workspace.
        await load({
          id: r.data.workspaceId,
          role: r.data.role,
          studentId: r.data.studentId,
        });
        setSwitching(false);
      },
    });
  if (!configured)
    return (
      <SafeAreaView
        style={styles.screen}
        edges={["top", "bottom", "left", "right"]}
      >
        <View style={[styles.body, { flex: 1, justifyContent: "center" }]}>
          <Brand />
          <Text style={styles.title}>Uygulamayı bağlayın.</Text>
          <Text style={styles.text}>
            Mobil uygulamanın bağlantı ayarları henüz tamamlanmamış. Kurulum
            kılavuzundaki mobil ortam değişkenlerini ekleyip uygulamayı yeniden
            başlatın.
          </Text>
        </View>
      </SafeAreaView>
    );
  if (boot) return <Loading />;
  if (!session) return <AuthScreen />;
  if (reset) return <AuthScreen reset onDone={() => setReset(false)} />;
  if (!active || switching || invite)
    return (
      <SafeAreaView
        style={styles.screen}
        edges={["top", "bottom", "left", "right"]}
      >
        <ScrollView contentContainerStyle={styles.body}>
          <Brand />
          <View style={{ gap: 6, marginTop: 8 }}>
            <Kicker>Hesabınız</Kicker>
            <Text style={styles.title}>Çalışma alanınız</Text>
            <View style={[styles.row, { gap: 6 }]}>
              <Ionicons
                name="mail-outline"
                size={14}
                color={colors.muted}
              />
              <Text style={styles.muted}>{session.user.email}</Text>
            </View>
          </View>
          <ErrorText message={error} />
          {error && (
            <Button secondary icon="refresh-outline" onPress={() => void load()}>
              Yeniden dene
            </Button>
          )}
          {!access.length && !error && (
            <EmptyState
              icon="briefcase-outline"
              title="Henüz bir çalışma alanınız yok"
              description="Öğretmenseniz kendi alanınızı oluşturun, öğrenci veya veliyseniz aldığınız daveti kabul edin."
            />
          )}
          {access.map((a) => (
            <Card
              key={a.id + ":" + a.role + ":" + a.studentId}
              onPress={() => {
                setActive(a);
                setFocus(null);
                setSwitching(false);
                setInvite(null);
              }}
            >
              <View style={[styles.row, { flexWrap: "nowrap", gap: 12 }]}>
                <Avatar name={a.studentName || a.name} size={44} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={styles.h2} numberOfLines={1}>
                    {a.name}
                  </Text>
                  <Text style={styles.muted} numberOfLines={1}>
                    {a.studentName || "Öğretmen hesabı"}
                  </Text>
                  <View style={{ marginTop: 3 }}>
                    <Badge tone={a.role === "OWNER" ? "info" : "neutral"}>
                      {a.role === "GUARDIAN"
                        ? "Veli"
                        : a.role === "STUDENT"
                          ? "Öğrenci"
                          : "Öğretmen"}
                    </Badge>
                  </View>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.faint}
                />
              </View>
            </Card>
          ))}
          {!access.some((a) => a.role === "OWNER") && (
            <Button
              icon="add"
              onPress={() =>
                setForm({
                  title: "Öğretmen çalışma alanı",
                  fields: [{ key: "name", label: "Çalışma alanı adı" }],
                  submit: async (v) => {
                    await request("/workspaces", { name: v.name });
                    await load();
                    setSwitching(false);
                  },
                })
              }
            >
              Öğretmen çalışma alanı oluştur
            </Button>
          )}
          <Button secondary icon="mail-open-outline" onPress={accountForm}>
            Davet kabul et
          </Button>
          <View style={{ gap: 8, marginTop: 8 }}>
            <Kicker muted>Görünüm</Kicker>
            <ThemeToggle />
          </View>
          <Button
            variant="ghost"
            icon="log-out-outline"
            onPress={() =>
              confirmAction(
                "Hesabınızdan çıkılsın mı?",
                "Oturumunuz kapanacak ve tekrar giriş yapmanız gerekecek.",
                signout,
                setError,
              )
            }
          >
            Çıkış yap
          </Button>
        </ScrollView>
        <FormSheet form={form} onClose={() => setForm(null)} />
      </SafeAreaView>
    );
  const select = () => setSwitching(true),
    key = [active.id, active.studentId, active.role].join(":");
  return active.role === "OWNER" ? (
    <TeacherScreen
      key={key}
      access={active}
      onAccount={select}
      focus={focus}
      onNotice={openNotice}
    />
  ) : (
    <PortalScreen
      key={key}
      access={active}
      onAccount={select}
      focus={focus}
      onNotice={openNotice}
    />
  );
}
// StatusBar temayla ters çalışır: koyu zeminde açık simgeler gerekir. Sabit
// "dark" olduğu için koyu temada üst çubuk okunmuyordu.
function Shell() {
  const { scheme, colors } = useTheme();
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <Application />
      </View>
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Shell />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
