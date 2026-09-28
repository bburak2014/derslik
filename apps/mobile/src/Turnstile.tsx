import React, { useMemo } from "react";
import { Platform, View } from "react-native";
import { WebView } from "react-native-webview";
import { getLocale } from "@derslik/contracts";
import { configuration } from "./core";
import { useTheme } from "./ui";

// Cloudflare Turnstile: e-postayla giriş, kayıt ve şifre sıfırlamada
// Supabase'in istediği CAPTCHA belirteci. Widget bir WebView'da çalışır;
// sayfa web sitesinin adresiyle (baseUrl) açılır, çünkü Turnstile yalnızca
// izin verilen alan adlarında belirteç üretir. Site anahtarı yoksa hiç
// çizilmez.
export const captchaEnabled =
  Platform.OS !== "web" &&
  !!configuration.captchaSiteKey &&
  !!configuration.captchaOrigin;

function buildHtml(siteKey: string, theme: "light" | "dark") {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;padding:0;background:transparent;}</style>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer onload="start()"></script>
</head><body><div id="w"></div>
<script>
function send(value){ window.ReactNativeWebView.postMessage(value); }
function start(){
  turnstile.render("#w", {
    sitekey: ${JSON.stringify(siteKey)},
    language: ${JSON.stringify(getLocale())},
    theme: ${JSON.stringify(theme)},
    size: "flexible",
    callback: function (token) { send("token:" + token); },
    "expired-callback": function () { send("expired"); },
    "error-callback": function () { send("error"); }
  });
}
</script></body></html>`;
}

/** Adresin kökeni; önek karşılaştırması "site.example.saldirgan.test" ya da
 *  "site.example@saldirgan.test" gibi adresleri de kabul ederdi. */
function originOf(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/** WebView yalnızca sitenin kendi kökenini ve Cloudflare doğrulamasını açar. */
export function turnstileAllows(url: string, origin: string) {
  return (
    url === "about:blank" ||
    [origin, "https://challenges.cloudflare.com"].includes(originOf(url))
  );
}

/**
 * Belirteç tek kullanımlıktır: her gönderimden sonra `round` artırılır,
 * WebView yeniden kurulur ve yeni belirteç üretilir.
 */
export function Turnstile({
  round,
  onToken,
  onError,
}: {
  round: number;
  onToken: (token: string) => void;
  onError: () => void;
}) {
  const { scheme } = useTheme();
  const html = useMemo(
    () => buildHtml(configuration.captchaSiteKey, scheme),
    [scheme],
  );
  const origin = configuration.captchaOrigin.replace(/\/$/, "");
  return (
    <View style={{ height: 70 }}>
      <WebView
        key={round}
        originWhitelist={["*"]}
        source={{ html, baseUrl: origin + "/" }}
        javaScriptEnabled
        scrollEnabled={false}
        style={{ backgroundColor: "transparent" }}
        setSupportMultipleWindows={false}
        // Yalnızca sayfanın kendisi ve Cloudflare'in doğrulama çerçevesi
        // yüklenir; widget'taki bağlantılar uygulamanın içinde açılmaz.
        onShouldStartLoadWithRequest={(request) =>
          turnstileAllows(request.url, origin)
        }
        onMessage={(event) => {
          const data = event.nativeEvent.data;
          if (data.startsWith("token:")) onToken(data.slice(6));
          else {
            onToken("");
            if (data === "error") onError();
          }
        }}
        onError={() => {
          onToken("");
          onError();
        }}
      />
    </View>
  );
}
