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
import { DirectoryScreen, type DirectoryTab } from "./DirectoryScreen";
import { t, type NoticeTarget } from "@derslik/contracts";
import { LanguagePicker, LocaleProvider } from "./i18n";
import { Ionicons } from "@expo/vector-icons";
import {
  Avatar,
  Badge,
  Brand,
  Button,
  Card,
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
    // Without a Supabase client there is no session to restore.
    [boot, setBoot] = useState(supabase !== null),
    [access, setAccess] = useState<Access[]>([]),
    [active, setActive] = useState<Access | null>(null),
    [error, setError] = useState(""),
    [reset, setReset] = useState(false),
    [invite, setInvite] = useState<string | null>(null),
    [form, setForm] = useState<FormSpec | null>(null),
    [switching, setSwitching] = useState(false),
    // Bildirimden açılacak yer. Bildirim başka bir görünüme (ör. velinin
    // ikinci çocuğu) aitse önce o görünüme geçilir.
    [focus, setFocus] = useState<NoticeFocus | null>(null),
    // Öğretmen vitrini (öğretmen bul / isteklerim); açıkken tüm ekranı alır.
    [directory, setDirectory] = useState<{
      tab: DirectoryTab;
      at: number;
    } | null>(null);
  const openDirectory = (tab: DirectoryTab = "teachers") =>
    setDirectory({ tab, at: Date.now() });
  // Kabul edilen istekten sonra o öğretmenin öğrenci görünümü açılır. Bağlantı
  // yeni kurulduğu için erişim listesi önce yenilenir.
  const openWorkspace = async (workspaceId: string) => {
    try {
      const r = await request<{ data: Access[] }>("/access");
      setAccess(r.data);
      const next = r.data.find(
        (a) => a.id === workspaceId && a.role !== "OWNER",
      );
      if (!next) {
        setError(t("conn.noticeNoAccess"));
        return;
      }
      setActive(next);
      setFocus(null);
      setDirectory(null);
      setSwitching(false);
      setInvite(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const openNotice = (target: NoticeTarget) => {
    // Öğrencinin ders isteği yanıtı: kabul edildiyse o öğretmenin dersleri,
    // edilmediyse isteklerim listesi.
    if (target.section === "myRequests") {
      if (target.studentId) void openWorkspace(target.workspaceId);
      else openDirectory("requests");
      return;
    }
    const fits = (a: Access) =>
      a.id === target.workspaceId &&
      (a.role === "OWNER" || a.studentId === target.studentId);
    const next =
      (active && fits(active) ? active : null) ||
      access.find((a) => fits(a) && a.role === "OWNER") ||
      access.find(fits);
    if (!next) {
      setError(t("conn.noticeNoAccess"));
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
    if (!supabase) return;
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
        Alert.alert(t("mobile.linkFailedTitle"), t("mobile.linkFailedBody"));
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loader sets state only after its request resolves.
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
  const createWorkspace = () =>
    setForm({
      title: t("mobile.teacherWorkspace"),
      fields: [{ key: "name", label: t("conn.workspaceName") }],
      submit: async (v) => {
        await request("/workspaces", { name: v.name });
        await load();
        setSwitching(false);
      },
    });
  const accountForm = () =>
    setForm({
      title: t("mobile.acceptInvite"),
      description: t("mobile.pasteInvite"),
      fields: [
        { key: "link", label: t("mobile.inviteLink"), value: invite || "" },
      ],
      submit: async (v) => {
        const token = v.link.match(/([a-f0-9]{64})\/?$/)?.[1];
        if (!token) throw new Error(t("mobile.inviteInvalid"));
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
          <Text style={styles.title}>{t("mobile.setupTitle")}</Text>
          <Text style={styles.text}>{t("mobile.setupBody")}</Text>
        </View>
      </SafeAreaView>
    );
  if (boot) return <Loading />;
  if (!session) return <AuthScreen />;
  if (reset) return <AuthScreen reset onDone={() => setReset(false)} />;
  if (directory)
    return (
      <DirectoryScreen
        key={directory.at}
        tab={directory.tab}
        onBack={() => {
          setDirectory(null);
          if (!active) return;
          setSwitching(true);
        }}
        onOpenWorkspace={(ws) => void openWorkspace(ws)}
      />
    );
  if (!active || switching || invite)
    return (
      <SafeAreaView
        style={styles.screen}
        edges={["top", "bottom", "left", "right"]}
      >
        <ScrollView contentContainerStyle={styles.body}>
          <Brand />
          <View style={{ gap: 6, marginTop: 8 }}>
            <Kicker>{t("mobile.yourAccount")}</Kicker>
            <Text style={styles.title}>{t("mobile.yourWorkspace")}</Text>
            <View style={[styles.row, { gap: 6 }]}>
              <Ionicons name="mail-outline" size={14} color={colors.muted} />
              <Text style={styles.muted}>{session.user.email}</Text>
            </View>
          </View>
          <ErrorText message={error} />
          {error && (
            <Button
              secondary
              icon="refresh-outline"
              onPress={() => void load()}
            >
              {t("common.retry")}
            </Button>
          )}
          {/* Hesabı olmayan kişi yolunu seçer: öğretmen olarak başlar ya da
              vitrinden öğretmen arar (web'deki seçim kartı). */}
          {!access.length && !error && (
            <View style={{ gap: 10 }}>
              <Text style={styles.h2}>{t("dir.welcomeTitle")}</Text>
              <Text style={styles.muted}>{t("dir.welcomeText")}</Text>
              {[
                {
                  icon: "easel-outline" as const,
                  title: t("dir.imTeacher"),
                  text: t("dir.imTeacherText"),
                  onPress: () => createWorkspace(),
                },
                {
                  icon: "search-outline" as const,
                  title: t("dir.imStudent"),
                  text: t("dir.imStudentText"),
                  onPress: () => openDirectory(),
                },
              ].map((c) => (
                <Card key={c.title} onPress={c.onPress}>
                  <View style={[styles.row, { flexWrap: "nowrap", gap: 12 }]}>
                    <Ionicons name={c.icon} size={24} color={colors.brand} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.h2}>{c.title}</Text>
                      <Text style={styles.muted}>{c.text}</Text>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={colors.faint}
                    />
                  </View>
                </Card>
              ))}
              <Text style={styles.caption}>{t("dir.haveInvite")}</Text>
            </View>
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
                    {a.studentName || t("ws.teacherAccount")}
                  </Text>
                  <View style={{ marginTop: 3 }}>
                    <Badge tone={a.role === "OWNER" ? "info" : "neutral"}>
                      {t(`roles.${a.role}`)}
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
          {!!access.length && !access.some((a) => a.role === "OWNER") && (
            <Button icon="add" onPress={createWorkspace}>
              {t("conn.createWorkspace")}
            </Button>
          )}
          {!!access.length && (
            <Button
              secondary
              icon="search-outline"
              onPress={() => openDirectory()}
            >
              {t("nav.findTeacher")}
            </Button>
          )}
          <Button secondary icon="mail-open-outline" onPress={accountForm}>
            {t("mobile.acceptInvite")}
          </Button>
          <View style={{ gap: 8, marginTop: 8 }}>
            <Kicker muted>{t("common.appearance")}</Kicker>
            <ThemeToggle />
          </View>
          <View style={{ gap: 8 }}>
            <Kicker muted>{t("common.language")}</Kicker>
            <LanguagePicker />
          </View>
          <Button
            variant="ghost"
            icon="log-out-outline"
            onPress={() =>
              confirmAction(
                t("ws.signOutTitle"),
                t("portal.signOutBody"),
                signout,
                setError,
              )
            }
          >
            {t("common.signOut")}
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
      onDiscover={() => openDirectory()}
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
        <LocaleProvider>
          <Shell />
        </LocaleProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
