"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type LearningData,
  type PortalData,
  type Video,
  type Material,
  type FileReservation,
  type InvitationResult,
  type MediaCapabilities,
  type SignedUrl,
} from "@derslik/api-client";
import { dateKey, t, type StudentAccessList } from "@derslik/contracts";
import { backend } from "@/lib/client";
import { RefreshCw } from "lucide-react";
import {
  Field,
  FormSpec,
  empty,
  Confirmation,
  learningTabs,
  IconAction,
  type LearningTab,
  type LearningTabInfo,
} from "./shared";

export type LearningPanelProps = {
  workspaceId: string;
  studentId: string;
  studentName?: string;
  studentPhone?: string;
  role?: "OWNER" | "STUDENT" | "GUARDIAN";
  view?: LearningTab;
  /** İzin verilen sekmeler değiştikçe çağrılır; portalın sol menüsü bunları
   *  listeler. */
  onTabs?: (tabs: LearningTabInfo[]) => void;
  /** Açılışta seçili gelecek sekme (öğrenci panelindeki kısayollar için). */
  initialTab?: string;
  /** Açılışta davet formu doğrudan açılsın mı. */
  autoInvite?: boolean;
  /** Bildirimden gelinen kayıt: görünür olunca kaydırılıp kısa süre
   *  vurgulanır. `at` her tıklamada değişir. */
  focus?: { id: string | null; at: number };
};

/** LearningPanel'in durumu ve işlemleri; sekmeler bunu `ctx` olarak alır. */
export function useLearningPanel({
  workspaceId,
  studentId,
  studentName,
  studentPhone,
  role = "OWNER",
  view,
  onTabs,
  initialTab,
  autoInvite = false,
  focus,
}: LearningPanelProps) {
  const owner = role === "OWNER",
    student = role === "STUDENT";
  const [capabilities, setCapabilities] = useState<{
    files: boolean;
    videos: boolean;
  } | null>(null);
  const [data, setData] = useState<LearningData | PortalData>(empty),
    [loading, setLoading] = useState(true),
    [confirmation, setConfirmation] = useState<Confirmation | null>(null),
    [error, setError] = useState(""),
    [selectedTab, setTab] = useState(view ?? initialTab ?? "assignments"),
    [shownView, setShownView] = useState(view),
    // Davet kısayolu formu ilk render'da açar; effect ile açmak fazladan bir
    // render turu ve yanıp sönme demek olurdu.
    [form, setForm] = useState<FormSpec | null>(() =>
      autoInvite ? inviteSpec() : null,
    ),
    [activeVideo, setActiveVideo] = useState<Video | null>(null),
    [filePreview, setFilePreview] = useState<{
      file: Material;
      url: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<number | null>(null),
    [access, setAccess] = useState<StudentAccessList | null>(null),
    // Davet sonucu: bağlantı + e-postanın gerçekten gidip gitmediği.
    [invite, setInvite] = useState<{
      url: string;
      email: string;
      emailed: boolean;
    } | null>(null);
  // Follow the `view` prop when the parent changes it (adjusting state during
  // render instead of in an effect avoids a second render pass).
  if (view !== shownView) {
    setShownView(view);
    if (view) setTab(view);
  }
  // Aynı bildirim ikinci kez kaydırmasın diye işlenen tıklamanın zamanı.
  const focused = useRef(0),
    focusId = focus?.id,
    focusAt = focus?.at ?? 0;
  useEffect(() => {
    if (loading || !focusId || focused.current === focusAt) return;
    const el = document.querySelector<HTMLElement>(
      `[data-notice-target="${CSS.escape(focusId)}"]`,
    );
    if (!el) return;
    focused.current = focusAt;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.dataset.highlight = "true";
    const timer = setTimeout(() => delete el.dataset.highlight, 2400);
    return () => clearTimeout(timer);
  }, [loading, focusId, focusAt, selectedTab]);
  const uploadSession = useRef<{
    fingerprint: string;
    id: string;
    url: string;
  } | null>(null);
  // Yarım kalan video yüklemesi aynı dosyayla sürdürülür; sekme bileşeni
  // ref'i doğrudan değiştirmesin diye okuma ve yazma buradan geçer.
  type UploadSession = typeof uploadSession.current;
  const getUploadSession = () => uploadSession.current;
  const setUploadSession = (next: UploadSession) => {
    uploadSession.current = next;
  };
  const base = owner
      ? `/workspaces/${workspaceId}/students/${studentId}/learning`
      : `/portal/${workspaceId}/${studentId}`,
    media = `/media/${workspaceId}/${studentId}`;
  const reload = useCallback(async () => {
    try {
      const [result, status] = await Promise.all([
        backend<LearningData | PortalData>(base),
        backend<MediaCapabilities>("/media/capabilities").catch(() => ({
          files: false,
          videos: false,
        })),
      ]);
      setData(result);
      setCapabilities(status);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [base]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the loader sets state only after its request resolves.
    void reload();
  }, [reload]);
  const permissions = owner
    ? ["lessons", "assignments", "videos", "notes", "payments"]
    : (data as PortalData).permissions || [];
  async function action(command: unknown) {
    await backend(owner ? base : base + "/actions", command);
    await reload();
  }
  function simple(
    title: string,
    fields: Field[],
    convert: (v: Record<string, string>) => unknown,
  ) {
    setForm({
      title,
      fields,
      submit: async (v) => {
        await action(convert(v));
      },
    });
  }
  async function accessReload() {
    try {
      setAccess(
        await backend<StudentAccessList>(
          `/workspaces/${workspaceId}/students/${studentId}/access`,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function attach(assignmentId: string | null, file: File) {
    if (!capabilities?.files) {
      setError(t("learn.uploadUnavailable"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { data: r } = await backend<{ data: FileReservation }>(
        media + "/files",
        {
          assignmentId,
          purpose: owner
            ? assignmentId
              ? "ASSIGNMENT"
              : "RESOURCE"
            : "SUBMISSION",
          name: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        },
      );
      if (r.uploadUrl) {
        const uploaded = await fetch(r.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type, "x-upsert": "false" },
          body: file,
        });
        if (!uploaded.ok && uploaded.status !== 409)
          throw new Error(t("learn.uploadFailed"));
      }
      await backend(media + `/files/${r.id}/finish`, {});
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  /** Davet formunun tanımı; hem sekmedeki düğme hem de öğrenci panelindeki
   *  kısayol aynı formu açsın diye tek yerde duruyor. */
  function inviteSpec(): FormSpec {
    return {
      title: t("learn.inviteTitle"),
      fields: [
        { name: "email", label: t("learn.inviteEmail"), type: "email" },
        {
          name: "role",
          label: t("learn.accountType"),
          value: "STUDENT",
          options: [
            { value: "STUDENT", label: t("roles.STUDENT") },
            { value: "GUARDIAN", label: t("roles.GUARDIAN") },
          ],
        },
        {
          name: "payments",
          label: t("learn.paymentInfo"),
          value: "no",
          options: [
            { value: "no", label: t("learn.paymentHidden") },
            { value: "yes", label: t("learn.paymentVisible") },
          ],
        },
      ],
      submit: async (v) => {
        const r = await backend<{ data: InvitationResult }>(
          `/workspaces/${workspaceId}/students/${studentId}/invitations`,
          {
            email: v.email,
            role: v.role,
            permissions: [
              "lessons",
              "assignments",
              "videos",
              "notes",
              ...(v.payments === "yes" ? ["payments"] : []),
            ],
          },
        );
        setInvite({
          url: r.data.url,
          email: v.email,
          emailed: Boolean(r.data.emailed),
        });
        await accessReload();
      },
    };
  }
  async function openPreview(file: Material) {
    setBusy(true);
    try {
      // inline=1: imzalı bağlantı indirme yerine satır içi gösterim için gelsin.
      const r = await backend<{ data: SignedUrl }>(
        media + `/files/${file.id}/download?inline=1`,
      );
      setFilePreview({ file, url: r.data.url });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function download(file: Material) {
    try {
      const r = await backend<{ data: SignedUrl }>(
        media + `/files/${file.id}/download`,
      );
      window.location.assign(r.data.url);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function remove(file: Material) {
    setConfirmation({
      title: t("learn.deleteFileTitle"),
      description: t("learn.deleteFileBody", { name: file.name }),
      action: t("common.delete"),
      perform: () => removeNow(file),
    });
  }
  async function removeNow(file: Material) {
    setBusy(true);
    try {
      await backend(media + `/files/${file.id}/delete`, {});
      await reload();
    } catch (e) {
      await reload();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const permissionKey = permissions.join(",");
  const tabs = useMemo(
    () => learningTabs(permissionKey.split(","), owner),
    [owner, permissionKey],
  );
  // Fall back to the first permitted tab when the selected one is not allowed.
  const tab = tabs.some((x) => x.id === selectedTab)
    ? selectedTab
    : (tabs[0]?.id ?? selectedTab);
  useEffect(() => {
    onTabs?.(tabs);
  }, [onTabs, tabs]);
  const today = dateKey();
  const refresh = (
    <IconAction
      outline
      label={t("learn.refresh")}
      icon={<RefreshCw />}
      onClick={() => void reload()}
    />
  );
  return {
    workspaceId,
    studentId,
    studentName,
    studentPhone,
    role,
    view,
    onTabs,
    initialTab,
    autoInvite,
    focus,
    owner,
    student,
    capabilities,
    setCapabilities,
    data,
    setData,
    loading,
    setLoading,
    confirmation,
    setConfirmation,
    error,
    setError,
    selectedTab,
    setTab,
    shownView,
    setShownView,
    form,
    setForm,
    activeVideo,
    setActiveVideo,
    filePreview,
    setFilePreview,
    busy,
    setBusy,
    progress,
    setProgress,
    access,
    setAccess,
    invite,
    setInvite,
    focused,
    focusId,
    focusAt,
    getUploadSession,
    setUploadSession,
    base,
    media,
    reload,
    permissions,
    action,
    simple,
    accessReload,
    attach,
    inviteSpec,
    openPreview,
    download,
    remove,
    removeNow,
    permissionKey,
    tabs,
    tab,
    today,
    refresh,
  };
}
export type LearningCtx = ReturnType<typeof useLearningPanel>;
