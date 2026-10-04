import type { BoardPoint, BoardStroke, LessonBoard, LessonBoardCommand } from "../../contracts/src/live-lesson.ts";
import { maxBoardPoints } from "../../contracts/src/live-lesson.ts";
import { t } from "../../contracts/src/i18n/index.ts";

export type LessonBoardState = {
  board: LessonBoard | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
};
type BoardReply = {
  data: LessonBoard | null;
  access?: Pick<LessonBoard, "canEdit" | "canClear">;
};

/** One active lesson at a time; delayed replies cannot revive a closed room. */
export class LessonBoardSession {
  state: LessonBoardState = { board: null, loading: true, saving: false, error: null };
  private generation = 0;
  private active = false;
  private reading = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: {
    load: (revision?: number) => Promise<BoardReply>;
    change: (command: LessonBoardCommand, key: string) => Promise<{ data: LessonBoard }>;
    onChange: (state: LessonBoardState) => void;
    pollMs?: number;
    initial?: LessonBoard;
  }) {}

  start() {
    if (this.active) return;
    this.active = true;
    this.generation++;
    this.reading = false;
    this.state = { board: this.options.initial ?? null, loading: !this.options.initial, saving: false, error: null };
    this.publish({});
    void this.refresh();
  }

  stop() {
    this.active = false;
    this.generation++;
    this.reading = false;
    clearTimeout(this.timer);
  }

  private publish(patch: Partial<LessonBoardState>) {
    this.state = { ...this.state, ...patch };
    this.options.onChange(this.state);
  }

  private accept(reply: BoardReply) {
    const current = this.state.board;
    if (reply.data && (!current || reply.data.revision >= current.revision)) {
      this.publish({ board: reply.data });
    } else if (current && reply.access) {
      this.publish({ board: { ...current, ...reply.access } });
    }
  }

  async refresh() {
    if (!this.active || this.reading) return;
    clearTimeout(this.timer);
    this.reading = true;
    const generation = this.generation;
    try {
      const reply = await this.options.load(this.state.board?.revision);
      if (generation !== this.generation || !this.active) return;
      this.accept(reply);
      this.publish({ loading: false, error: null });
    } catch (error) {
      if (generation === this.generation && this.active)
        this.publish({ loading: false, error: error instanceof Error ? error.message : t("liveLesson.connectionError") });
    } finally {
      if (generation === this.generation && this.active) {
        this.reading = false;
        this.timer = setTimeout(() => void this.refresh(), this.options.pollMs ?? 2000);
      }
    }
  }

  async save(command: LessonBoardCommand, key: string): Promise<boolean> {
    if (!this.active || this.state.saving || !this.state.board?.canEdit) return false;
    const generation = this.generation;
    this.publish({ saving: true, error: null });
    try {
      const reply = await this.options.change(command, key);
      if (generation !== this.generation || !this.active) return false;
      this.accept(reply);
      this.publish({ saving: false, error: null });
      return true;
    } catch (error) {
      if (generation === this.generation && this.active) {
        this.publish({ saving: false, error: error instanceof Error ? error.message : t("liveLesson.connectionError") });
      }
      return false;
    }
  }
}

export function boardPoint(x: number, y: number, width: number, height: number): BoardPoint {
  const unit = (value: number, size: number) =>
    size > 0 && Number.isFinite(value) ? Math.round(Math.min(1, Math.max(0, value / size)) * 1000) / 1000 : 0;
  return { x: unit(x, width), y: unit(y, height) };
}

/** Keep the latest movement while bounding a stroke's payload. */
export function appendBoardPoint(points: BoardPoint[], point: BoardPoint): BoardPoint[] {
  const previous = points.at(-1);
  if (previous && Math.hypot(previous.x - point.x, previous.y - point.y) < 0.002) return points;
  const bounded = points.length >= maxBoardPoints ? points.filter((_, index) => index % 2 === 0) : points;
  return [...bounded, point];
}

export function boardStrokePath(points: BoardPoint[]): string {
  return points.map((point, index) => `${index ? "L" : "M"}${point.x * 1000},${point.y * 600}`).join(" ");
}

export function boardUndoStroke(board: LessonBoard): BoardStroke | undefined {
  return [...board.strokes].reverse().find((stroke) => board.canClear || stroke.authorId === board.viewerId);
}
