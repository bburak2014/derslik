import type { FileReservation } from "@derslik/api-client";
import { backend } from "@/lib/client";
import { t } from "@derslik/contracts";
import { readBoardPdf } from "./board-pdf";

/** Keep one reservation across retries, including a lost reserve or PUT response. */
export class BoardPdfUploader {
  private reservation?: { fingerprint: string; key: string; file?: FileReservation; uploaded: boolean; finished: boolean };
  constructor(private readonly base: string) {}

  async upload(file: File) {
    const pageCount = await readBoardPdf(file);
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const fingerprint = `${file.name}:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    if (this.reservation?.fingerprint !== fingerprint)
      this.reservation = { fingerprint, key: crypto.randomUUID(), uploaded: false, finished: false };
    const reservation = this.reservation;
    const parts = this.base.split("/");
    if (parts[1] !== "workspaces" || parts[3] !== "students") throw new Error(t("api.boardTeacherOnly"));
    const media = `/media/${parts[2]}/${parts[4]}/files`;
    if (!reservation.uploaded) {
      const { data } = await backend<{ data: FileReservation }>(media, {
        purpose: "RESOURCE", assignmentId: null, name: file.name, mimeType: "application/pdf", sizeBytes: file.size,
      }, reservation.key);
      reservation.file = data;
      if (data.status === "READY") { reservation.uploaded = true; reservation.finished = true; }
    }
    const record = reservation.file!;
    if (!reservation.uploaded) {
      if (!record.uploadUrl) throw new Error(t("learn.uploadUnavailable"));
      const sent = await fetch(record.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf", "x-upsert": "false" }, body: file });
      if (!sent.ok && sent.status !== 409) throw new Error(t("learn.uploadFailed"));
      reservation.uploaded = true;
    }
    if (!reservation.finished) {
      await backend(`${media}/${record.id}/finish`, {});
      reservation.finished = true;
    }
    return { id: record.id, pageCount };
  }
}
