import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const development = process.env.NODE_ENV !== "production";

// The browser only ever talks to this origin and to Supabase Auth; uploads and
// video playback go straight to Supabase Storage and Cloudflare Stream. Nothing
// else needs to be reachable from a Derslik page.
function connectSources() {
  const sources = new Set(["'self'"]);
  for (const value of [process.env.SUPABASE_URL, process.env.API_BASE_URL]) {
    try {
      if (value) sources.add(new URL(value).origin);
    } catch {
      /* A malformed value simply contributes no source. */
    }
  }
  sources.add("https://*.supabase.co");
  sources.add("https://videodelivery.net");
  sources.add("https://*.cloudflarestream.com");
  if (development) sources.add("ws://localhost:*");
  return [...sources].join(" ");
}

const policy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // Next.js injects inline bootstrap scripts and styles.
  `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https://videodelivery.net https://*.cloudflarestream.com",
  "font-src 'self' data:",
  `connect-src ${connectSources()}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  ...(development ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: policy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  ...(development
    ? []
    : [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
      ]),
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  transpilePackages: ["@derslik/contracts", "@derslik/api-client"],
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
export default nextConfig;
