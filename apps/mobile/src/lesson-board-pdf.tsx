import { useEffect, useMemo, useRef } from "react";
import { WebView } from "react-native-webview";
import { nativePdfJsUrl, pdfScriptJson } from "./pdf-html";

export type NativePdfPage = { pageCount: number; aspectRatio: number };

/** One PDF proxy per private file, one bounded canvas per displayed page. */
export function nativeBoardPdfHtml(url: string, pageNumber: number) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fff}canvas{display:block;width:100%;height:100%}</style>
</head><body><canvas id="page"></canvas><script>
window.boardPdfFinished=false;
window.boardPdfRequestedPage=${pdfScriptJson(pageNumber)};
window.boardPdfTimeout=setTimeout(function(){
  window.boardPdfFinished=true;
  if(window.boardPdfAbort)window.boardPdfAbort.abort();
  if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage('{"error":true}');
},20000);
</script><script src="${nativePdfJsUrl}/pdf.min.js"></script><script>
(function(){
  var documentProxy=null,renderTask=null,renderGeneration=0;
  function send(value){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(value));}
  function fail(page){
    if(window.boardPdfFinished||page&&page!==window.boardPdfRequestedPage)return;
    window.boardPdfFinished=true;clearTimeout(window.boardPdfTimeout);send({error:true,pageNumber:page});
  }
  if(window.boardPdfFinished)return;
  if(!window.pdfjsLib)return fail();
  pdfjsLib.GlobalWorkerOptions.workerSrc=${pdfScriptJson(nativePdfJsUrl + "/pdf.worker.min.js")};
  window.renderBoardPdfPage=function(selected){
    window.boardPdfRequestedPage=selected;
    if(!documentProxy)return;
    var generation=++renderGeneration;
    if(renderTask)renderTask.cancel();
    window.boardPdfFinished=false;clearTimeout(window.boardPdfTimeout);
    window.boardPdfTimeout=setTimeout(function(){fail(selected);},20000);
    documentProxy.getPage(selected).then(function(page){
      if(generation!==renderGeneration||selected!==window.boardPdfRequestedPage)return;
      var base=page.getViewport({scale:1});
      var ratio=Math.min(window.devicePixelRatio||1,2);
      var scale=Math.min((Math.max(window.innerWidth,1)*ratio)/base.width,Math.sqrt(4000000/(base.width*base.height)));
      var viewport=page.getViewport({scale:scale});
      var canvas=document.createElement("canvas");canvas.id="page";
      canvas.width=Math.max(1,Math.floor(viewport.width));canvas.height=Math.max(1,Math.floor(viewport.height));
      document.getElementById("page").replaceWith(canvas);
      renderTask=page.render({canvasContext:canvas.getContext("2d"),viewport:viewport});
      return renderTask.promise.then(function(){
        if(generation!==renderGeneration||window.boardPdfFinished||selected!==window.boardPdfRequestedPage)return;
        window.boardPdfFinished=true;clearTimeout(window.boardPdfTimeout);
        send({pageNumber:selected,pageCount:documentProxy.numPages,aspectRatio:base.width/base.height});
      });
    }).catch(function(error){if(generation!==renderGeneration||error&&error.name==="RenderingCancelledException")return;fail(selected);});
  };
  window.boardPdfAbort=new AbortController();
  fetch(${pdfScriptJson(url)},{signal:window.boardPdfAbort.signal}).then(function(response){
    if(!response.ok)throw new Error("download");return response.arrayBuffer();
  }).then(function(bytes){
    if(window.boardPdfFinished)return null;
    if(bytes.byteLength>10485760)throw new Error("file-limit");
    return pdfjsLib.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,enableXfa:false}).promise;
  })
    .then(function(pdf){
      if(!pdf||window.boardPdfFinished)return;
      if(pdf.numPages<1||pdf.numPages>100)throw new Error("page-limit");
      documentProxy=pdf;window.renderBoardPdfPage(window.boardPdfRequestedPage);
    }).catch(function(){fail();});
})();</script></body></html>`;
}

function pageScript(page: number) {
  const requested = pdfScriptJson(page);
  return `if(window.renderBoardPdfPage){window.renderBoardPdfPage(${requested});}else{window.boardPdfRequestedPage=${requested};}true;`;
}

export function NativeBoardPdf({ url, page, onReady, onError }: Readonly<{
  url: string;
  page: number;
  onReady: (page: NativePdfPage) => void;
  onError: () => void;
}>) {
  const html = useMemo(() => nativeBoardPdfHtml(url, 1), [url]);
  const webView = useRef<WebView>(null);
  useEffect(() => { webView.current?.injectJavaScript(pageScript(page)); }, [url, page]);
  return <WebView
    key={url}
    ref={webView}
    originWhitelist={["*"]}
    source={{ html }}
    javaScriptEnabled
    scrollEnabled={false}
    pointerEvents="none"
    setSupportMultipleWindows={false}
    onShouldStartLoadWithRequest={(request) => request.url === "about:blank" || request.url.startsWith("data:")}
    onError={onError}
    onLoadEnd={() => webView.current?.injectJavaScript(pageScript(page))}
    onMessage={(event) => {
      try {
        const data = JSON.parse(event.nativeEvent.data) as Partial<NativePdfPage> & { error?: boolean; pageNumber?: number };
        if (data.pageNumber !== undefined && data.pageNumber !== page) return;
        if (!data.error && data.pageNumber !== page) return;
        if (data.error || !Number.isInteger(data.pageCount) || Number(data.pageCount) < 1 || Number(data.pageCount) > 100 || !Number.isFinite(data.aspectRatio) || Number(data.aspectRatio) < 0.1 || Number(data.aspectRatio) > 10)
          onError();
        else onReady({ pageCount: Number(data.pageCount), aspectRatio: Number(data.aspectRatio) });
      } catch {
        onError();
      }
    }}
    style={{ flex: 1, backgroundColor: "#ffffff" }}
  />;
}
