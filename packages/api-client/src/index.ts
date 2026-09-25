import type { Command } from "../../contracts/src/validation.js";
import type { WorkspaceData } from "../../contracts/src/types.js";
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
    } = {},
  ): Promise<T> {
    if (!path.startsWith("/v1/")) throw new Error("Unsupported API path");
    const token = await this.options.getToken();
    if (!token) throw new ApiError(401, t("common.signInRequired"));
    const res = await (this.options.fetch || fetch)(
      this.options.baseUrl.replace(/\/$/, "") + path,
      {
        method: init.method || "GET",
        cache: "no-store",
        signal: init.signal,
        headers: {
          Authorization: `Bearer ${token}`,
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
