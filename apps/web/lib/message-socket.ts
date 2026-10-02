"use client";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { MessageSocket, type MessageSocketEvent } from "@derslik/api-client";

// Sayfa başına tek soket. İlk dinleyici gelince açılır, sonuncusu gidince
// kapanır. Bilet web sunucusundan (oturum çereziyle) alınır; soket
// kurulamıyorsa (ayarlanmamış, oturum yok) mesajlar yoklamayla yenilenir.

let socket: MessageSocket | null = null;
let users = 0;

async function ticket(signal: AbortSignal) {
  const r = await fetch("/api/socket", {
    method: "POST",
    cache: "no-store",
    signal,
    headers: { "Content-Type": "application/json", "X-Derslik-Client": "web" },
    body: "{}",
  });
  // Ayarlanmamış (501) ya da oturum yok (401): soket uzun aralıkla denenir.
  // Diğer hatalar geçicidir: kısa aralıkla yeniden denenir.
  if (r.status === 401 || r.status === 403 || r.status === 501) return null;
  if (!r.ok) throw new Error("socket ticket " + r.status);
  const { data } = (await r.json()) as {
    data?: { ticket?: string; url?: string };
  };
  return data?.ticket && data.url
    ? { ticket: data.ticket, url: data.url }
    : null;
}

function instance() {
  socket ??= new MessageSocket({ ticket });
  return socket;
}

/** Soket olaylarını dinler; `enabled` false iken soket açılmaz. */
export function useMessageEvents(
  handler: (event: MessageSocketEvent) => void,
  enabled = true,
) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (!enabled) return;
    const s = instance();
    const off = s.subscribe((event) => latest.current(event));
    users += 1;
    s.start();
    return () => {
      off();
      users -= 1;
      if (users === 0) s.stop();
    };
  }, [enabled]);
}

const subscribeLive = (change: () => void) => instance().onLive(change);
const live = () => socket?.live ?? false;

/** Soket bağlıyken true: yoklama seyrekleşir, olaylar anında gelir. */
export function useSocketLive() {
  return useSyncExternalStore(subscribeLive, live, () => false);
}
