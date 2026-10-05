import * as DocumentPicker from "expo-document-picker";
import { fetch as expoFetch } from "expo/fetch";
import * as Crypto from "expo-crypto";
import { t } from "@derslik/contracts";
import type { FileReservation, SignedUrl } from "@derslik/api-client";
import { request } from "./core";
import { readFileBytes } from "./file-bytes";

export type BoardPdfUpload = { id: string; name: string; url: string };
type UploadReservation = { key: string; finishKey: string; file?: FileReservation; uploaded: boolean; finished: boolean };
export type BoardPdfReservations = Map<string, UploadReservation>;

export async function uploadBoardPdf(workspaceId: string, studentId: string, reservations: BoardPdfReservations = new Map()): Promise<BoardPdfUpload | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true, multiple: false });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  if ((asset.size ?? 0) > 10 * 1024 ** 2) throw new Error(t("ml.fileTooLarge"));
  const bytes = await readFileBytes(asset.uri);
  if (bytes.byteLength > 10 * 1024 ** 2) throw new Error(t("ml.fileTooLarge"));
  const base = `/media/${encodeURIComponent(workspaceId)}/${encodeURIComponent(studentId)}/files`;
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  const fingerprint = `${base}:${asset.name}:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  let reserved = reservations.get(fingerprint);
  if (!reserved) {
    reserved = { key: Crypto.randomUUID(), finishKey: Crypto.randomUUID(), uploaded: false, finished: false };
    reservations.set(fingerprint, reserved);
  }
  if (!reserved.uploaded) {
    const reply = await request<{ data: FileReservation }>(base, {
      assignmentId: null, purpose: "RESOURCE", name: asset.name, mimeType: "application/pdf", sizeBytes: bytes.byteLength,
    }, reserved.key);
    reserved.file = reply.data;
    if (reply.data.status === "READY") {
      reserved.uploaded = true;
      reserved.finished = true;
    }
  }
  const file = await completeBoardPdf(base, reserved, bytes);
  const signed = await request<{ data: SignedUrl }>(`${base}/${file.id}/download?inline=1`);
  return { id: file.id, name: asset.name, url: signed.data.url };
}

async function completeBoardPdf(base: string, reserved: UploadReservation, bytes: Uint8Array<ArrayBuffer>) {
  const file = reserved.file;
  if (!file) throw new Error(t("learn.uploadUnavailable"));
  if (!reserved.uploaded) {
    if (!file.uploadUrl) throw new Error(t("learn.uploadUnavailable"));
    const response = await expoFetch(file.uploadUrl, {
      method: "PUT", headers: { "Content-Type": "application/pdf", "x-upsert": "false" }, body: bytes,
    });
    if (!response.ok && response.status !== 409) throw new Error(t("learn.uploadFailed"));
    reserved.uploaded = true;
  }
  if (!reserved.finished) {
    await request(`${base}/${file.id}/finish`, {}, reserved.finishKey);
    reserved.finished = true;
  }
  return file;
}
