"use client";
import { isImageName, t } from "@derslik/contracts";
import { formText } from "@/lib/client";
import { Button } from "@/components/ui/button";
import {
  Download,
  Eye,
  FileText,
  Image as ImageIcon,
  Trash2,
  Upload,
} from "lucide-react";
import { Spinner } from "@/components/derslik/loading";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToneBadge } from "../feedback";
import { type LearningCtx } from "./use-learning-panel";
import {
  GENERAL,
  SectionHeading,
  EmptyNote,
  IconAction,
  UploadAside,
} from "./shared";

export function FilesTab({ ctx }: Readonly<{ ctx: LearningCtx }>) {
  const {
    view,
    owner,
    capabilities,
    data,
    busy,
    attach,
    openPreview,
    download,
    remove,
    refresh,
  } = ctx;
  return (
    <>
      <SectionHeading title={t("nav.files")} description={t("learn.filesText")}>
        {view && refresh}
      </SectionHeading>
      {owner && (
        <div className="upload-layout">
          <Card className="gap-5">
            <CardHeader>
              <CardTitle>{t("learn.uploadFile")}</CardTitle>
              <CardDescription>{t("learn.uploadFileHint")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const values = new FormData(e.currentTarget),
                    file = values.get("file") as File,
                    target = formText(values, "assignmentId");
                  if (file?.size)
                    await attach(
                      target === GENERAL ? null : target || null,
                      file,
                    );
                }}
              >
                <div className="grid gap-2">
                  <Label htmlFor="material-assignment">
                    {t("learn.linkedAssignment")}
                  </Label>
                  <Select name="assignmentId" defaultValue={GENERAL}>
                    <SelectTrigger id="material-assignment" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={GENERAL}>
                        {t("learn.generalMaterial")}
                      </SelectItem>
                      {data.assignments.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="material-file">{t("learn.pdfOrImage")}</Label>
                  <Input
                    id="material-file"
                    name="file"
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    required
                    disabled={busy || !capabilities?.files}
                  />
                  <p className="text-muted-foreground text-xs">
                    {t("learn.fileLimits")}
                  </p>
                </div>
                <Button
                  type="submit"
                  className="justify-self-start"
                  disabled={busy || !capabilities?.files}
                >
                  {busy ? <Spinner /> : <Upload />}
                  {busy ? t("learn.uploading") : t("learn.uploadFile")}
                </Button>
              </form>
            </CardContent>
          </Card>
          <UploadAside kind="files" />
        </div>
      )}
      <ItemGroup className="gap-3">
        {!data.materials.length && (
          <EmptyNote role="listitem" icon={FileText} title={t("learn.noFiles")}>
            {t("learn.noFilesHint")}
          </EmptyNote>
        )}
        {data.materials.map((file) => (
          <Item
            role="listitem"
            variant="outline"
            className="bg-card"
            key={file.id}
          >
            <ItemMedia variant="icon">
              {isImageName(file.name) ? <ImageIcon /> : <FileText />}
            </ItemMedia>
            <ItemContent className="min-w-36">
              <ItemTitle className="max-w-full">
                <span className="truncate">{file.name}</span>
              </ItemTitle>
              <ItemDescription>
                {file.assignment_id
                  ? data.assignments.find((a) => a.id === file.assignment_id)
                      ?.title
                  : t("learn.generalMaterial")}{" "}
                · {Math.ceil(Number(file.size_bytes) / 1024)} KB
              </ItemDescription>
            </ItemContent>
            <ItemActions className="ml-auto gap-1">
              {file.status === "READY" && !file.delete_requested ? (
                <>
                  <IconAction
                    label={t("learn.preview")}
                    icon={<Eye />}
                    disabled={busy}
                    onClick={() => void openPreview(file)}
                  />
                  <IconAction
                    label={t("learn.download")}
                    icon={<Download />}
                    onClick={() => void download(file)}
                  />
                </>
              ) : (
                <ToneBadge tone="warn" className="mr-1">
                  {file.delete_requested
                    ? t("learn.deletePending")
                    : t("learn.uploadIncomplete")}
                </ToneBadge>
              )}
              {owner && (
                <IconAction
                  danger
                  label={
                    file.delete_requested
                      ? t("learn.retryDelete")
                      : t("common.delete")
                  }
                  icon={<Trash2 />}
                  disabled={busy}
                  onClick={() => remove(file)}
                />
              )}
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
    </>
  );
}
