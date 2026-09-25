import React, { useMemo, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { Button, useTheme } from "./ui";

// Android'in tarayıcısında yerleşik PDF görüntüleyici yok; bağlantıyı açmak
// indirme istemine düşüyordu. Burada PDF, pdf.js ile canvas'a çizilerek
// uygulamanın içinde gösteriliyor. Dosyanın kendisi doğrudan Supabase'den
// çekiliyor; CDN'den yalnızca kitaplık geliyor, dosya üçüncü tarafa gitmiyor.
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";

function buildHtml(url: string, background: string) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=4">
<style>
  html,body{margin:0;padding:0;background:${background};}
  canvas{display:block;width:100%;margin:0 0 10px;}
  #err{display:none;padding:24px;font:15px -apple-system,Roboto,sans-serif;color:#8698a9;text-align:center;}
</style></head>
<body>
<div id="pages"></div>
<div id="err">Önizleme açılamadı.</div>
<script src="${PDFJS}/pdf.min.js"></script>
<script>
(function () {
  function fail(reason) {
    document.getElementById("err").style.display = "block";
    if (window.ReactNativeWebView)
      window.ReactNativeWebView.postMessage("error:" + reason);
  }
  if (!window.pdfjsLib) return fail("library");
  pdfjsLib.GlobalWorkerOptions.workerSrc = ${JSON.stringify(PDFJS + "/pdf.worker.min.js")};
  pdfjsLib
    .getDocument({ url: ${JSON.stringify(url)} })
    .promise.then(function (pdf) {
      var holder = document.getElementById("pages");
      var ratio = window.devicePixelRatio || 1;
      var chain = Promise.resolve();
      for (var i = 1; i <= pdf.numPages; i++) {
        (function (pageNumber) {
          chain = chain.then(function () {
            return pdf.getPage(pageNumber).then(function (page) {
              var base = page.getViewport({ scale: 1 });
              var scale = (window.innerWidth * ratio) / base.width;
              var viewport = page.getViewport({ scale: scale });
              var canvas = document.createElement("canvas");
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              holder.appendChild(canvas);
              return page.render({
                canvasContext: canvas.getContext("2d"),
                viewport: viewport,
              }).promise;
            });
          });
        })(i);
      }
      return chain.then(function () {
        if (window.ReactNativeWebView)
          window.ReactNativeWebView.postMessage("ready");
      });
    })
    .catch(function (e) {
      fail(String((e && e.message) || e));
    });
})();
</script></body></html>`;
}

export function PdfViewer({
  name,
  url,
  onClose,
}: {
  name: string;
  url: string;
  onClose: () => void;
}) {
  const { colors, styles } = useTheme();
  const [failed, setFailed] = useState(false);
  const html = useMemo(() => buildHtml(url, colors.cream), [url, colors.cream]);
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.screen, { flex: 1 }]} edges={["top"]}>
        <View style={styles.header}>
          <Text numberOfLines={1} style={[styles.h2, { flex: 1 }]}>
            {name}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Kapat"
            onPress={onClose}
            hitSlop={10}
            style={{
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="close" size={22} color={colors.muted} />
          </Pressable>
        </View>
        {failed ? (
          <View style={[styles.body, { gap: 14 }]}>
            <Text style={styles.muted}>
              Bu dosya uygulama içinde açılamadı. Tarayıcıda deneyebilirsiniz.
            </Text>
            <Button
              secondary
              onPress={() => void WebBrowser.openBrowserAsync(url)}
            >
              Tarayıcıda aç
            </Button>
          </View>
        ) : (
          <WebView
            originWhitelist={["*"]}
            source={{ html }}
            javaScriptEnabled
            onMessage={(event) => {
              if (event.nativeEvent.data.startsWith("error:")) setFailed(true);
            }}
            style={{ flex: 1, backgroundColor: colors.cream }}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}
