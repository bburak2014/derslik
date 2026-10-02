import { RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ShowcaseView } from "./DirectoryScreen";
import {
  Avatar,
  Button,
  EmptyState,
  ErrorText,
  FormSheet,
  Kicker,
  Loading,
  Picker,
  Segmented,
} from "./ui";
import { LearningScreen, type TeachingView } from "./LearningScreen";
import { compareText, t } from "@derslik/contracts";
import { StudentFile } from "./teacher/student-file";
import { Overview } from "./teacher/overview";
import { StudentList } from "./teacher/student-list";
import { CalendarSection } from "./teacher/calendar";
import { PaymentsSection } from "./teacher/payments";
import { InboxSection } from "./teacher/inbox";
import { Conversation, ThreadList } from "./messages";
import {
  useTeacherScreen,
  type TeacherCtx,
  type TeacherScreenProps,
} from "./teacher/use-teacher-screen";

export function TeacherScreen(props: Readonly<TeacherScreenProps>) {
  const ctx = useTeacherScreen(props);
  const {
    data,
    access,
    onAccount,
    colors,
    styles,
    loading,
    refreshing,
    setRefreshing,
    error,
    tab,
    teachingView,
    setTeachingView,
    teachingStudent,
    setTeachingStudent,
    learning,
    setLearning,
    form,
    setForm,
    teachingFocus,
    setTeachingFocus,
    learningFocus,
    setLearningFocus,
    setRequests,
    showcaseFocus,
    messages,
    setNoticeTick,
    load,
    student,
    title,
    header,
    tabBar,
  } = ctx;
  if (loading) return <Loading />;
  if (learning && student)
    return (
      <LearningScreen
        access={access}
        studentId={student.id}
        studentName={student.name}
        onBack={() => {
          setLearning(false);
          setLearningFocus(null);
        }}
        focus={learningFocus}
      />
    );
  // Öğretim ekranı: webde sol menüdeki Ödevler / PDF ve dosyalar / Ders
  // videoları başlıklarının karşılığı. Mobilde alt çubukta tek sekme, içinde
  // öğrenci seçici ve bölüm segmenti var.
  if (tab === "showcase" && !student)
    return (
      <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
        {header}
        <ShowcaseView
          workspaceId={access.id}
          onPending={setRequests}
          onAccepted={() => void load()}
          focus={showcaseFocus}
        />
        {tabBar}
      </SafeAreaView>
    );
  // Mesajlar: liste başlık ve alt çubukla, açık yazışma tüm ekranı alır (yazma
  // alanı klavyenin üstünde durur). Paylaşılan ScrollView'ın içinde değil.
  if (tab === "messages" && !student)
    return (
      <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
        {messages.open ? (
          <Conversation
            key={messages.open}
            path={`/workspaces/${access.id}/messages`}
            linkId={messages.open}
            initial={messages.threads?.find((x) => x.linkId === messages.open)}
            onBack={() => messages.setOpen(null)}
            onUpdate={messages.patch}
            onRead={() => setNoticeTick((n) => n + 1)}
          />
        ) : (
          <>
            {header}
            <ThreadList
              messages={messages}
              viewer="OWNER"
              kicker={access.name}
            />
            {tabBar}
          </>
        )}
      </SafeAreaView>
    );
  if (tab === "teaching") {
    const roster = [...data.students].sort(
      (a, b) =>
        Number(b.active) - Number(a.active) || compareText(a.name, b.name),
    );
    const chosen = roster.find((x) => x.id === teachingStudent) || roster[0];
    return (
      <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
        {header}
        {!chosen ? (
          <View style={styles.body}>
            <EmptyState
              icon="people-outline"
              title={t("hub.emptyTitle")}
              description={t("mt.teachingEmpty")}
            />
          </View>
        ) : (
          <>
            <View style={{ paddingHorizontal: 20, paddingTop: 16, gap: 10 }}>
              <Picker
                label={t("common.student")}
                value={chosen.id}
                onChange={(id) => {
                  setTeachingStudent(id);
                  setTeachingFocus(null);
                }}
                options={roster.map((x) => ({
                  value: x.id,
                  label: x.name + (x.active ? "" : " · " + t("hub.archived")),
                  hint: x.subject,
                }))}
              />
              <Segmented
                label={t("mt.section")}
                value={teachingView}
                onChange={(value) => {
                  setTeachingView(value as TeachingView);
                  setTeachingFocus(null);
                }}
                options={[
                  {
                    value: "assignments",
                    label: t("nav.assignments"),
                    icon: "clipboard-outline",
                  },
                  { value: "files", label: "PDF", icon: "document-outline" },
                  {
                    value: "videos",
                    label: t("mt.videos"),
                    icon: "videocam-outline",
                  },
                ]}
              />
            </View>
            <LearningScreen
              key={chosen.id + ":" + teachingView}
              access={access}
              studentId={chosen.id}
              studentName={chosen.name}
              onBack={onAccount}
              view={teachingView}
              focus={teachingFocus}
            />
          </>
        )}
        {tabBar}
        <FormSheet form={form} onClose={() => setForm(null)} />
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      {header}
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.brand}
            colors={[colors.brand]}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        {student ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Avatar name={student.name} size={56} />
            <View style={{ flex: 1, gap: 4 }}>
              <Kicker>{t("mt.studentFile")}</Kicker>
              <Text style={styles.title} numberOfLines={2}>
                {student.name}
              </Text>
            </View>
          </View>
        ) : (
          <View style={{ gap: 6 }}>
            <Kicker>{access.name}</Kicker>
            <Text style={styles.title}>{title}</Text>
          </View>
        )}
        <ErrorText message={error} />
        {!!error && (
          <Button
            secondary
            icon="refresh-outline"
            style={{ alignSelf: "flex-start" }}
            onPress={() => void load()}
          >
            {t("common.retry")}
          </Button>
        )}
        <TabBody ctx={ctx} />
      </ScrollView>
      {tabBar}
      <FormSheet form={form} onClose={() => setForm(null)} />
    </SafeAreaView>
  );
}

function TabBody({ ctx }: Readonly<{ ctx: TeacherCtx }>) {
  if (ctx.student) return <StudentFile ctx={ctx} />;
  if (ctx.tab === "overview") return <Overview ctx={ctx} />;
  if (ctx.tab === "students") return <StudentList ctx={ctx} />;
  if (ctx.tab === "calendar") return <CalendarSection ctx={ctx} />;
  if (ctx.tab === "payments") return <PaymentsSection ctx={ctx} />;
  return <InboxSection ctx={ctx} />;
}
