import { t } from "@derslik/contracts";

/** Expo Go's picker cache sits outside FileSystem's scoped directory; the
 * network blob reader can still read that URI without copying the file. */
export async function readFileBytes(uri: string) {
  const blob = await (await fetch(uri)).blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t("ml.readFailed")));
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error(t("ml.readFailed")));
    };
    reader.readAsDataURL(blob);
  });
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.codePointAt(i) ?? 0;
  return bytes;
}
