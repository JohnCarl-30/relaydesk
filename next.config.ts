import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "better-sqlite3",
    "@langchain/langgraph",
    "@langchain/core",
    "@opentelemetry/sdk-trace-node",
    "@opentelemetry/sdk-trace-base",
    "@opentelemetry/resources",
    "@opentelemetry/api",
  ],
  async headers() {
    const everywhere = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Strict-Transport-Security", value: "max-age=31536000" },
    ];
    return [
      { source: "/:path*", headers: everywhere },
      // The widget at /embed/* is framed by customers' sites; nothing else should be framed.
      {
        source: "/((?!embed/).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
