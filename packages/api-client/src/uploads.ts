import { t } from "../../contracts/src/i18n/index.ts";
export type UploadSource = {
  size: number;
  slice: (start: number, end: number) => BodyInit | Promise<BodyInit>;
};
/** Continue from the server's confirmed offset. Keeps memory bounded to one chunk. */
export async function uploadTus(
  url: string,
  source: UploadSource,
  {
    fetch: fetcher = fetch,
    signal,
    onProgress = () => {},
  }: {
    fetch?: typeof fetch;
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
  } = {},
) {
  const headers = { "Tus-Resumable": "1.0.0" };
  const head = await fetcher(url, { method: "HEAD", headers, signal });
  if (!head.ok) throw new Error(t("upload.linkUnreachable"));
  let offset = Number(head.headers.get("Upload-Offset"));
  if (
    !head.headers.has("Upload-Offset") ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > source.size
  )
    throw new Error(t("upload.offsetInvalid"));
  while (offset < source.size) {
    const end = Math.min(offset + 8 * 1024 * 1024, source.size);
    const response = await fetcher(url, {
      method: "PATCH",
      headers: {
        ...headers,
        "Upload-Offset": String(offset),
        "Content-Type": "application/offset+octet-stream",
      },
      body: await source.slice(offset, end),
      signal,
    });
    if (!response.ok) throw new Error(t("upload.interrupted"));
    const next = Number(response.headers.get("Upload-Offset"));
    if (next !== end) throw new Error(t("upload.chunkFailed"));
    offset = next;
    onProgress(offset / source.size);
  }
}
