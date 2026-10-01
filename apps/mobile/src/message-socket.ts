import { useEffect, useRef, useSyncExternalStore } from "react";
import { AppState, type AppStateStatus } from "react-native";
import {
  ApiError,
  MessageSocket,
  type MessageSocketEvent,
} from "@derslik/api-client";
import { configuration, request, supabase } from "./core";

// Uygulama başına tek soket: ekranlardan biri dinlerken ve uygulama ön
// plandayken açık kalır. Arka planda işletim sistemi bağlantıyı zaten keser;
// soket kapanır, uygulamaya dönünce yeniden kurulur ve ekranlar bir kez
// yenilenir (`resync`). Bilet API'den, oturum belirteciyle alınır.

/** API adresinden soket adresi: http → ws, https → wss. */
function socketUrl() {
  try {
    const url = new URL("/v1/socket", configuration.api);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.href;
  } catch {
    return null;
  }
}

async function ticket() {
  const url = socketUrl();
  if (!url || !supabase) return null;
  if (!(await supabase.auth.getSession()).data.session) return null;
  try {
    const r = await request<{ data: { ticket: string } }>("/socket/ticket", {});
    return { ticket: r.data.ticket, url };
  } catch (e) {
    // Oturum geçersiz: uzun aralıkla denenir. Diğer hatalar geçicidir.
    if (e instanceof ApiError && (e.status === 401 || e.status === 403))
      return null;
    throw e;
  }
}

let socket: MessageSocket | null = null;
let users = 0;
const foreground = (state: AppStateStatus) =>
  state !== "background" && state !== "inactive";
let active = foreground(AppState.currentState);

function sync() {
  if (!socket) return;
  if (users > 0 && active) socket.start();
  else socket.stop();
}

function instance() {
  if (!socket) {
    socket = new MessageSocket({ ticket });
    AppState.addEventListener("change", (state) => {
      active = foreground(state);
      sync();
    });
  }
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
    sync();
    return () => {
      off();
      users -= 1;
      sync();
    };
  }, [enabled]);
}

const subscribeLive = (change: () => void) => instance().onLive(change);
const live = () => socket?.live ?? false;

/** Soket bağlıyken true: yoklama seyrekleşir, olaylar anında gelir. */
export function useSocketLive() {
  return useSyncExternalStore(subscribeLive, live, () => false);
}
