"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { maxBoardPages, t } from "@derslik/contracts";
import { backend } from "@/lib/client";

async function pdfLibrary() {
  const library = await import("pdfjs-dist");
  library.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  return library;
}

/** Parse before reserving storage; encrypted, malformed and oversized PDFs never upload. */
export async function readBoardPdf(file: File) {
  if (file.size === 0 || file.size > 10 * 1024 * 1024 || !file.name.toLowerCase().endsWith(".pdf"))
    throw new Error(t("liveLesson.pdfLimit"));
  const library = await pdfLibrary();
  const loading = library.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  loading.onPassword = () => { void loading.destroy(); };
  try {
    const pdf = await loading.promise;
    if (pdf.numPages > maxBoardPages) throw new Error(t("liveLesson.pdfLimit"));
    return pdf.numPages;
  } finally { await loading.destroy(); }
}

export function useBoardPdf(base: string, documentId: string | null, retry: number) {
  const [state, setState] = useState<{ key: string; pdf?: PDFDocumentProxy; error?: string }>({ key: "" });
  const key = `${base}:${documentId}:${retry}`;
  useEffect(() => {
    if (!documentId) return;
    let active = true;
    const controller = new AbortController();
    let loading: ReturnType<Awaited<ReturnType<typeof pdfLibrary>>["getDocument"]> | undefined;
    async function load() {
      try {
        const { data } = await backend<{ data: { url: string } }>(`${base}/documents/${documentId}`);
        const response = await fetch(data.url, { signal: controller.signal });
        if (!response.ok) throw new Error("PDF download failed");
        const bytes = new Uint8Array(await response.arrayBuffer());
        const library = await pdfLibrary();
        if (!active) return;
        // Retain all bytes: later pages remain available after the signed URL expires.
        loading = library.getDocument({ data: bytes });
        loading.onPassword = () => { void loading?.destroy(); };
        const pdf = await loading.promise;
        if (pdf.numPages < 1 || pdf.numPages > maxBoardPages) throw new Error("PDF page limit exceeded");
        if (active) setState({ key, pdf });
      } catch {
        void loading?.destroy();
        if (active) setState({ key, error: t("liveLesson.pdfError") });
      }
    }
    void load();
    return () => { active = false; controller.abort(); void loading?.destroy(); };
  }, [base, documentId, key]);
  return state.key === key && !state.pdf?.loadingTask.destroyed ? state : { key };
}

export function useBoardPdfPage(pdf: PDFDocumentProxy | undefined, page: number) {
  const [state, setState] = useState<{ pdf?: PDFDocumentProxy; number: number; page?: PDFPageProxy; error?: string }>({ number: 0 });
  useEffect(() => {
    const document = pdf;
    if (!document || document.loadingTask.destroyed) return;
    let active = true;
    async function load(current: PDFDocumentProxy) {
      try {
        const next = await current.getPage(page);
        if (active) setState({ pdf: current, number: page, page: next });
      } catch {
        if (active) setState({ pdf: current, number: page, error: t("liveLesson.pdfError") });
      }
    }
    void load(document);
    return () => { active = false; };
  }, [pdf, page]);
  return state.pdf === pdf && state.number === page && !pdf?.loadingTask.destroyed ? state : { number: page };
}

export function BoardPdfCanvas({ page, onReady, onError }: Readonly<{
  page: PDFPageProxy; onReady: (page: PDFPageProxy) => void; onError: () => void;
}>) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true, task: RenderTask | undefined;
    async function render() {
      const element = canvas.current;
      if (!element) return;
      try {
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, 1600 / Math.max(base.width, base.height)) });
        element.width = viewport.width; element.height = viewport.height;
        task = page.render({ canvas: element, viewport, annotationMode: 0 });
        await task.promise;
        if (active) onReady(page);
      } catch { if (active) onError(); }
    }
    void render();
    return () => { active = false; task?.cancel(); };
  }, [page, onReady, onError]);
  return <canvas ref={canvas} className="block size-full" aria-label={t("liveLesson.pdfPage")} />;
}
