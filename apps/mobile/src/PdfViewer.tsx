import React, { useMemo, useState } from "react";
import { Modal, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { Button, CloseButton, EmptyState, useTheme } from "./ui";
import { t } from "@derslik/contracts";
import { nativePdfJsUrl as PDFJS, pdfScriptJson as scriptJson } from "./pdf-html";

// Android'in tarayıcısında yerleşik PDF görüntüleyici yok; bağlantıyı açmak
// indirme istemine düşüyordu. Burada PDF, pdf.js ile canvas'a çizilerek
// uygulamanın içinde gösteriliyor. Dosyanın kendisi doğrudan Supabase'den
// çekiliyor; CDN'den yalnızca kitaplık geliyor, dosya üçüncü tarafa gitmiyor.
//
// CVE-2024-4367: pdf.js before 4.2.67 can run script embedded in a crafted
// font. 3.x is kept because 4.x ships only as ES modules; the vendor's
// mitigation is isEvalSupported:false, set on getDocument below. The WebView
// also refuses to navigate anywhere, so a hostile file cannot leave the page.
//
// Memory: a small text PDF can have hundreds of pages. Drawing every page at
// the device's pixel ratio kept one full bitmap per page alive (100 A4 pages
// at DPR 3 ≈ 740 MiB). Each page is now an empty box of the page's shape; only
// pages within about a screen of the viewport get a canvas, and a canvas that
// scrolls away is released. Pixel ratio is capped at 2 and one canvas at
// 4 million pixels, like the lesson board viewer.
function buildHtml(url: string, background: string, muted: string) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=4">
<style>
  html,body{margin:0;padding:0;background:${background};}
  .page{position:relative;width:100%;height:0;margin:0 0 10px;background:#fff;}
  .page canvas{position:absolute;top:0;left:0;display:block;width:100%;height:100%;}
  #err{display:none;padding:24px;font:15px -apple-system,Roboto,sans-serif;color:${muted};text-align:center;}
</style></head>
<body>
<div id="pages"></div>
<div id="err">${t("pdf.failed")}</div>
<script src="${PDFJS}/pdf.min.js"></script>
<script>
(function () {
  var RATIO = Math.min(window.devicePixelRatio || 1, 2);
  var MAX_PIXELS = 4000000;
  var announced = false;
  function send(message) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(message);
  }
  function fail(reason) {
    document.getElementById("err").style.display = "block";
    send("error:" + reason);
  }
  // The box keeps the page's shape through its padding, which every WebView
  // supports (CSS aspect-ratio needs Chrome 88 / Safari 15).
  function shape(node, base) {
    node.style.paddingTop = (base.height / base.width) * 100 + "%";
  }
  if (!window.pdfjsLib) return fail("library");
  pdfjsLib.GlobalWorkerOptions.workerSrc = ${scriptJson(PDFJS + "/pdf.worker.min.js")};
  pdfjsLib
    .getDocument({ url: ${scriptJson(url)}, isEvalSupported: false })
    .promise.then(function (pdf) {
      return pdf.getPage(1).then(function (first) {
        var holder = document.getElementById("pages");
        var firstBase = first.getViewport({ scale: 1 });
        var pages = [];
        function draw(entry) {
          if (entry.canvas) return;
          var canvas = document.createElement("canvas");
          entry.canvas = canvas;
          pdf
            .getPage(entry.number)
            .then(function (page) {
              if (entry.canvas !== canvas) return null;
              var base = page.getViewport({ scale: 1 });
              shape(entry.node, base);
              var scale = Math.min(
                (Math.max(window.innerWidth, 1) * RATIO) / base.width,
                Math.sqrt(MAX_PIXELS / (base.width * base.height))
              );
              var viewport = page.getViewport({ scale: scale });
              canvas.width = Math.max(1, Math.floor(viewport.width));
              canvas.height = Math.max(1, Math.floor(viewport.height));
              entry.node.appendChild(canvas);
              entry.task = page.render({
                canvasContext: canvas.getContext("2d"),
                viewport: viewport,
              });
              return entry.task.promise;
            })
            .then(
              function () {
                if (entry.canvas !== canvas) return;
                entry.task = null;
                if (!announced) {
                  announced = true;
                  send("ready");
                }
              },
              function (e) {
                if (entry.canvas !== canvas) return;
                entry.task = null;
                fail(String((e && e.message) || e));
              }
            );
        }
        function release(entry) {
          var canvas = entry.canvas;
          if (!canvas) return;
          entry.canvas = null;
          if (entry.task) entry.task.cancel();
          entry.task = null;
          // A zero-sized canvas gives its bitmap back at once.
          canvas.width = 0;
          canvas.height = 0;
          canvas.remove();
        }
        var observer = new IntersectionObserver(
          function (changes) {
            changes.forEach(function (change) {
              var entry = pages[Number(change.target.dataset.page) - 1];
              if (change.isIntersecting) draw(entry);
              else release(entry);
            });
          },
          { rootMargin: "100% 0px" }
        );
        for (var i = 1; i <= pdf.numPages; i++) {
          var node = document.createElement("div");
          node.className = "page";
          node.dataset.page = String(i);
          shape(node, firstBase);
          holder.appendChild(node);
          pages.push({ number: i, node: node, canvas: null, task: null });
          observer.observe(node);
        }
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
}: Readonly<{
  name: string;
  url: string;
  onClose: () => void;
}>) {
  const { colors, styles, section } = useTheme();
  const [failed, setFailed] = useState(false);
  const html = useMemo(
    () => buildHtml(url, colors.canvas, colors.muted),
    [url, colors.canvas, colors.muted],
  );
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.screen, { flex: 1 }]} edges={["top"]}>
        <View style={section.sheetHeader}>
          <View style={section.fileIcon}>
            <Ionicons
              name="document-text-outline"
              size={19}
              color={colors.brand}
            />
          </View>
          <Text numberOfLines={1} style={[section.sheetTitle, { flex: 1 }]}>
            {name}
          </Text>
          <CloseButton onPress={onClose} />
        </View>
        {failed ? (
          <View style={[styles.body, { gap: 14 }]}>
            <EmptyState
              icon="document-text-outline"
              title={t("pdf.failedTitle")}
              description={t("pdf.failedBody")}
              action={
                <Button
                  secondary
                  size="sm"
                  icon="open-outline"
                  onPress={() => void WebBrowser.openBrowserAsync(url)}
                >
                  {t("pdf.openBrowser")}
                </Button>
              }
            />
          </View>
        ) : (
          <WebView
            originWhitelist={["*"]}
            source={{ html }}
            javaScriptEnabled
            // Only the inline page itself may load; links in a PDF never
            // navigate the viewer.
            onShouldStartLoadWithRequest={(request) =>
              request.url === "about:blank" || request.url.startsWith("data:")
            }
            setSupportMultipleWindows={false}
            onMessage={(event) => {
              if (event.nativeEvent.data.startsWith("error:")) setFailed(true);
            }}
            style={{ flex: 1, backgroundColor: colors.canvas }}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}
