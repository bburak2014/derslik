import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { money, lower, t } from "@derslik/contracts";
import { Avatar, Badge, Button, EmptyState, Input, List, ListRow } from "../ui";
import { type TeacherCtx } from "./use-teacher-screen";

export function StudentList({ ctx }: Readonly<{ ctx: TeacherCtx }>) {
  const {
    colors,
    styles,
    data,
    setSelected,
    search,
    setSearch,
    editStudent,
    balance,
  } = ctx;
  return (
    <>
      <Input
        icon="search"
        accessibilityLabel={t("ws.searchStudents")}
        value={search}
        onChangeText={setSearch}
        placeholder={t("mt.searchPlaceholder")}
        autoCorrect={false}
        returnKeyType="search"
      />
      <Button icon="person-add-outline" onPress={() => editStudent()}>
        {t("ws.addStudent")}
      </Button>
      {(() => {
        const found = data.students.filter((s) =>
          lower(`${s.name} ${s.subject}`).includes(lower(search)),
        );
        if (!found.length)
          return (
            <EmptyState
              icon="people-outline"
              title={
                data.students.length
                  ? t("mt.noMatchTitle")
                  : t("record.noStudents")
              }
              description={
                data.students.length
                  ? t("mt.noMatchText")
                  : t("mt.noStudentsText")
              }
            />
          );
        return (
          <List>
            {found.map((s, i) => {
              const open = balance(s.id);
              return (
                <ListRow
                  key={s.id}
                  divider={i > 0}
                  accessibilityLabel={s.name}
                  onPress={() => setSelected(s.id)}
                >
                  <Avatar name={s.name} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.h2} numberOfLines={1}>
                      {s.name}
                    </Text>
                    <Text style={styles.caption} numberOfLines={1}>
                      {[s.subject, s.grade].filter(Boolean).join(" · ")}
                    </Text>
                  </View>
                  {studentBadge(s.active, open)}
                  <Ionicons
                    name="chevron-forward"
                    size={17}
                    color={colors.faint}
                  />
                </ListRow>
              );
            })}
          </List>
        );
      })()}
    </>
  );
}

function studentBadge(active: number, open: number) {
  if (!active) return <Badge>{t("hub.archived")}</Badge>;
  if (open > 0) return <Badge tone="warning">{money(open)}</Badge>;
  return null;
}
