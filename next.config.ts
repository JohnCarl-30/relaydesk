import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "better-sqlite3",
    "@langchain/langgraph",
    "@langchain/core",
    "@huggingface/transformers",
    "onnxruntime-node",
    "@opentelemetry/sdk-trace-node",
    "@opentelemetry/sdk-trace-base",
    "@opentelemetry/resources",
    "@opentelemetry/api",
  ],
};

export default nextConfig;
