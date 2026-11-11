import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  // All pages show per-user, permission-scoped data, so rendering is fully
  // dynamic (Cache Components disabled). Nothing customer-specific is cached.
  poweredByHeader: false,
  serverExternalPackages: ["exceljs", "jspdf", "jspdf-autotable"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Survey links carry a secret token: never leak it via Referer, never cache.
      { source: "/survey/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store" }] },
      { source: "/s/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store" }] },
      // Offer opt-out links carry a secret token too.
      { source: "/u/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "no-store" }] },
    ];
  },
  // Short survey links in the SMS (/s/<token>) show the survey page without a redirect.
  async rewrites() {
    return [{ source: "/s/:token", destination: "/survey/:token" }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
