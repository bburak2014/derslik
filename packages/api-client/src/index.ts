import type { Command } from "../../contracts/src/validation.js";
import type { WorkspaceData } from "../../contracts/src/types.js";
import type {
  LessonRequest,
  LessonRequestInput,
  MyLessonRequest,
  PublicReview,
  PublicTeacher,
  ReviewInput,
  Showcase,
  TeacherFilter,
  TeacherProfile,
  TeacherProfileInput,
  TeacherRelation,
} from "../../contracts/src/directory.ts";
import { getLocale, t } from "../../contracts/src/i18n/index.ts";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export type Access = {
  id: string;
  name: string;
  role: "OWNER" | "STUDENT" | "GUARDIAN";
  studentId?: string;
  studentName?: string;
};
export class DerslikClient {
  constructor(
    private readonly options: {
      baseUrl: string;
      getToken: () => Promise<string | null>;
      fetch?: typeof fetch;
      /** API iletilerinin dili; verilmezse istemcinin etkin dili. */
      locale?: () => string;
    },
  ) {}
  async request<T>(
    path: string,
    init: {
      method?: string;
      body?: unknown;
      key?: string;
      signal?: AbortSignal;
      /** Vitrin gibi herkese açık uçlar: oturum varsa gönderilir, yoksa da olur. */
      optionalAuth?: boolean;
    } = {},
  ): Promise<T> {
    if (!path.startsWith("/v1/")) throw new Error("Unsupported API path");
    const token = await this.options.getToken();
    if (!token && !init.optionalAuth)
      throw new ApiError(401, t("common.signInRequired"));
    const res = await (this.options.fetch || fetch)(
      this.options.baseUrl.replace(/\/$/, "") + path,
      {
        method: init.method || "GET",
        cache: "no-store",
        signal: init.signal,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
          "Accept-Language": this.options.locale?.() || getLocale(),
          ...(init.key ? { "Idempotency-Key": init.key } : {}),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      },
    );
    const payload = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; requestId?: string };
    };
    if (!res.ok)
      throw new ApiError(
        res.status,
        payload.error?.message || t("common.failed"),
        payload.error?.requestId,
      );
    return payload as T;
  }
  access() {
    return this.request<{ data: Access[] }>("/v1/access");
  }
  createWorkspace(name: string) {
    return this.request<{ data: Access }>("/v1/workspaces", {
      method: "POST",
      body: { name },
    });
  }
  snapshot(ws: string) {
    return this.request<WorkspaceData>(
      `/v1/workspaces/${encodeURIComponent(ws)}/snapshot`,
    );
  }
  command(ws: string, body: Command, key: string) {
    return this.request<{ data: Record<string, unknown>; replayed: boolean }>(
      `/v1/workspaces/${encodeURIComponent(ws)}/commands`,
      { method: "POST", body, key },
    );
  }
  learning(ws: string, student: string) {
    return this.request<LearningData>(
      `/v1/workspaces/${encodeURIComponent(ws)}/students/${encodeURIComponent(student)}/learning`,
    );
  }
  portal(ws: string, student: string) {
    return this.request<PortalData>(
      `/v1/portal/${encodeURIComponent(ws)}/${encodeURIComponent(student)}`,
    );
  }
  // --- Öğretmen vitrini -------------------------------------------------
  teachers(filter: TeacherFilter = {}) {
    return this.request<TeacherPage>("/v1/teachers" + teacherQuery(filter), {
      optionalAuth: true,
    });
  }
  teacher(id: string) {
    return this.request<{ data: PublicTeacher; reviews: PublicReview[] }>(
      `/v1/teachers/${encodeURIComponent(id)}`,
      { optionalAuth: true },
    );
  }
  teacherRelation(id: string) {
    return this.request<{ data: TeacherRelation }>(
      `/v1/teacher-relations/${encodeURIComponent(id)}`,
    );
  }
  sendLessonRequest(id: string, body: LessonRequestInput) {
    return this.request<{ data: LessonRequest }>(
      `/v1/teacher-relations/${encodeURIComponent(id)}/requests`,
      { method: "POST", body },
    );
  }
  saveReview(id: string, body: ReviewInput) {
    return this.request<{ data: PublicReview }>(
      `/v1/teacher-relations/${encodeURIComponent(id)}/review`,
      { method: "PUT", body },
    );
  }
  deleteReview(id: string) {
    return this.request<{ data: unknown }>(
      `/v1/teacher-relations/${encodeURIComponent(id)}/review/delete`,
      { method: "POST", body: {} },
    );
  }
  myLessonRequests() {
    return this.request<{ data: MyLessonRequest[] }>("/v1/requests");
  }
  cancelLessonRequest(id: string) {
    return this.request<{ data: LessonRequest }>(
      `/v1/requests/${encodeURIComponent(id)}/cancel`,
      { method: "POST", body: {} },
    );
  }
  showcase(ws: string) {
    return this.request<{ data: Showcase }>(
      `/v1/workspaces/${encodeURIComponent(ws)}/showcase`,
    );
  }
  saveShowcase(ws: string, body: TeacherProfileInput) {
    return this.request<{ data: TeacherProfile }>(
      `/v1/workspaces/${encodeURIComponent(ws)}/showcase`,
      { method: "PUT", body },
    );
  }
  saveShowcasePhoto(
    ws: string,
    body: { mimeType: "image/jpeg" | "image/png" | "image/webp"; data: string },
  ) {
    return this.request<{ data: { photoVersion: number } }>(
      `/v1/workspaces/${encodeURIComponent(ws)}/showcase/photo`,
      { method: "PUT", body },
    );
  }
  deleteShowcasePhoto(ws: string) {
    return this.request<{ data: unknown }>(
      `/v1/workspaces/${encodeURIComponent(ws)}/showcase/photo/delete`,
      { method: "POST", body: {} },
    );
  }
  decideLessonRequest(
    ws: string,
    id: string,
    decision: "accept" | "decline",
    note = "",
  ) {
    return this.request<{ data: LessonRequest }>(
      `/v1/workspaces/${encodeURIComponent(ws)}/requests/${encodeURIComponent(id)}/${decision}`,
      { method: "POST", body: decision === "decline" ? { note } : {} },
    );
  }
}

export type TeacherPage = {
  data: PublicTeacher[];
  total: number;
  page: number;
  perPage: number;
  cities: string[];
};
/** Boş filtreler adrese yazılmaz; web ve mobil aynı sorguyu üretir. */
export function teacherQuery(filter: TeacherFilter) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter))
    if (value !== undefined && value !== null && value !== "")
      params.set(key, String(value));
  const query = params.toString();
  return query ? "?" + query : "";
}

export type Assignment = {
  id: string;
  student_id: string;
  title: string;
  instructions: string;
  status: "OPEN" | "COMPLETED" | "CANCELLED";
  version: number;
  due_on: string | null;
  created_at: string;
};
export type Submission = {
  id: string;
  assignment_id: string;
  body: string;
  feedback: string;
  status: "SUBMITTED" | "REVIEWED";
  version: number;
  created_at: string;
};
export type SharedNote = {
  id: string;
  body: string;
  audience: "STUDENT" | "BOTH";
  created_at: string;
};
export type Video = {
  id: string;
  lesson_id: string | null;
  title: string;
  status:
    "RESERVED" | "UPLOADING" | "PROCESSING" | "READY" | "FAILED" | "DELETED";
  duration_seconds: number | null;
  delete_requested?: boolean;
  created_at: string;
};
export type VideoQuestion = {
  id: string;
  video_id: string;
  at_seconds: number;
  body: string;
  answer: string;
  resolved: boolean;
  version: number;
  created_at: string;
};
export type Material = {
  id: string;
  assignment_id: string | null;
  delete_requested: boolean;
  purpose: "ASSIGNMENT" | "SUBMISSION" | "RESOURCE";
  name: string;
  status: "PENDING" | "READY";
  size_bytes: string;
  mime_type: string;
};
export type Summary = {
  id: string;
  body: string;
  status: "DRAFT" | "PUBLISHED";
  week_on: string;
  version: number;
};
export type LearningData = {
  lessons: WorkspaceData["lessons"];
  assignments: Assignment[];
  submissions: Submission[];
  notes: SharedNote[];
  videos: Video[];
  questions: VideoQuestion[];
  materials: Material[];
  summaries: Summary[];
  progress: { video_id: string; seconds: number }[];
};
export type PortalData = LearningData & {
  student: { id: string; name: string; subject: string };
  role: "STUDENT" | "GUARDIAN";
  permissions: string[];
  lessons: WorkspaceData["lessons"];
  packages: WorkspaceData["packages"];
  payments: WorkspaceData["payments"];
};
// Media and invitation responses, as the API's `data` field returns them.
export type MediaCapabilities = { files: boolean; videos: boolean };
export type FileReservation = {
  id: string;
  status: string;
  uploadUrl?: string;
  mimeType?: string;
};
export type VideoReservation = {
  id: string;
  status: string;
  uploadUrl: string;
  expiresAt: string;
};
export type SignedUrl = { url: string };
export type VideoPlayback = { url: string; expiresAt: number };
export type InvitationResult = { id: string; url: string; emailed?: boolean };
export { uploadTus, type UploadSource } from "./uploads.ts";
