import { Inbox } from "../LearningScreen";
import { type TeacherCtx } from "./use-teacher-screen";

export function InboxSection({ ctx }: Readonly<{ ctx: TeacherCtx }>) {
  const { access, onNotice, setUnread } = ctx;
  return (
    <Inbox workspaceId={access.id} onUnread={setUnread} onOpen={onNotice} />
  );
}
