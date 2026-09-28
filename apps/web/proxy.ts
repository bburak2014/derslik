import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "@/lib/server/csp";

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce);
  // Next, sayfayı çizerken nonce'u istekteki CSP başlığından okur.
  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      // /api JSON döner, nonce gerekmez. Proxy'den geçen isteğin gövdesi Next
      // tarafından önce tamamen belleğe alınır; API yolları hariç tutulunca
      // büyük gövde sınırı (readBody) okuma sırasında hemen devreye girer.
      source: "/((?!api/|_next/static|_next/image|favicon.svg).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
