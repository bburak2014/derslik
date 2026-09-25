import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { CONFIG, type ApiConfig } from "../config.js";
import { apiText } from "../common/i18n.js";

@Injectable()
export class MediaProviders {
  constructor(@Inject(CONFIG) readonly config: ApiConfig) {}
  streamReady() {
    if (!this.videosConfigured())
      throw new ServiceUnavailableException("api.videoServiceNotConfigured");
  }
  storageReady() {
    if (!this.attachmentsConfigured())
      throw new ServiceUnavailableException("api.storageNotConfigured");
  }
  // Both of these are the single source of truth for "is this feature set up".
  // The limits endpoint used to answer the question with its own, stricter
  // conditions, so it reported uploads as unavailable while they worked.
  attachmentsConfigured() {
    return !!(
      this.config.SUPABASE_SECRET_KEY || this.config.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  videosConfigured() {
    return !!(
      this.config.CLOUDFLARE_ACCOUNT_ID &&
      this.config.CLOUDFLARE_STREAM_TOKEN &&
      (this.config.NODE_ENV !== "production" ||
        this.config.CLOUDFLARE_STREAM_WEBHOOK_SECRET)
    );
  }
  async stream(path: string, init: RequestInit = {}) {
    this.streamReady();
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.config.CLOUDFLARE_ACCOUNT_ID}/stream${path}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${this.config.CLOUDFLARE_STREAM_TOKEN}`,
          ...init.headers,
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (
      !response.ok &&
      !(init.method === "DELETE" && response.status === 404)
    ) {
      const detail = (await response.json().catch(() => null)) as {
        errors?: Array<{ code?: number; message?: string }>;
      } | null;

      console.error("Cloudflare Stream hatası:", {
        status: response.status,
        errors: detail?.errors?.slice(0, 3).map((error) => ({
          code: error.code,
          message: String(error.message || "")
            .replaceAll(this.config.CLOUDFLARE_STREAM_TOKEN!, "[GİZLENDİ]")
            .slice(0, 500),
        })),
      });

      throw new ServiceUnavailableException("api.videoUploadLinkFailed");
    }
    return response;
  }
  storageRoot() {
    return new URL("/storage/v1", this.config.AUTH_ISSUER).href;
  }
  async storage(path: string, init: RequestInit = {}) {
    this.storageReady();
    const key =
      this.config.SUPABASE_SECRET_KEY || this.config.SUPABASE_SERVICE_ROLE_KEY!;
    const response = await fetch(this.storageRoot() + path, {
      ...init,
      headers: {
        ...(!key.startsWith("sb_secret_")
          ? { Authorization: `Bearer ${key}` }
          : {}),
        apikey: key,
        ...init.headers,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new ServiceUnavailableException("api.storageOperationFailed");
    return response;
  }
  async capabilities() {
    const files = this.attachmentsConfigured();
    const videos = this.videosConfigured();
    let fileReady = false;
    if (files) {
      try {
        const bucket = (await (
          await this.storage("/bucket/" + this.config.STORAGE_BUCKET)
        ).json()) as { public?: boolean };
        fileReady = bucket.public === false;
      } catch {
        /* Provider outage or unfinished bucket setup: do not offer uploads. */
      }
    }
    return {
      files: fileReady,
      videos,
      fileMessage: fileReady ? null : apiText("api.fileUploadUnavailable"),
      videoMessage: videos ? null : apiText("api.videoUploadUnavailable"),
    };
  }
  objectPath(key: string) {
    return this.config.STORAGE_BUCKET + "/" + key;
  }
  async uploadFileUrl(key: string) {
    const data = (await (
      await this.storage("/object/upload/sign/" + this.objectPath(key), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-upsert": "false" },
        body: "{}",
      })
    ).json()) as { url: string };
    const url = new URL(this.storageRoot() + data.url);
    if (
      url.origin !== new URL(this.storageRoot()).origin ||
      !url.searchParams.has("token")
    )
      throw new ServiceUnavailableException("api.uploadLinkInvalid");
    return url.href;
  }
  // `&download=` Supabase'e Content-Disposition: attachment verdirir. Tarayıcı
  // içinde önizleme isteyen çağrılar bunu istemez, satır içi gösterim ister.
  async downloadFileUrl(key: string, inline = false) {
    const data = (await (
      await this.storage("/object/sign/" + this.objectPath(key), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: 120 }),
      })
    ).json()) as { signedURL: string };
    return this.storageRoot() + data.signedURL + (inline ? "" : "&download=");
  }
  async fileInfo(key: string) {
    return (
      await this.storage("/object/info/" + this.objectPath(key))
    ).json() as Promise<{
      size?: number;
      content_type?: string;
      metadata?: { size?: number; mimetype?: string };
    }>;
  }
  async fileSignature(key: string) {
    const r = await this.storage(
      "/object/authenticated/" + this.objectPath(key),
      { headers: { Range: "bytes=0-15" } },
    );
    const reader = r.body?.getReader();
    if (!reader) return Buffer.alloc(0);
    try {
      const first = await reader.read();
      return Buffer.from(first.value || []).subarray(0, 16);
    } finally {
      await reader.cancel();
    }
  }
  async deleteFile(key: string) {
    await this.storage("/object/" + this.config.STORAGE_BUCKET, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: [key] }),
    });
  }
}
