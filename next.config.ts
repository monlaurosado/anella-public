import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";

import {
  assertDeploymentConfiguration,
  getServerActionAllowedOrigins,
  isHostedDeployment,
} from "./src/config/env";

assertDeploymentConfiguration();

const versionPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,127}$/;

function resolveBuildVersion() {
  const githubSha = process.env.GITHUB_SHA?.trim();
  if (githubSha && versionPattern.test(githubSha)) return githubSha;

  try {
    const gitSha = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (versionPattern.test(gitSha)) return gitSha;
  } catch {
    // Archive builds may not include .git; the configured release remains a
    // valid fail-closed fallback for those deployments.
  }

  const configuredVersion = process.env.DEPLOYMENT_VERSION?.trim();
  if (configuredVersion && versionPattern.test(configuredVersion)) {
    return configuredVersion;
  }
  throw new Error("No se pudo determinar la versión inmutable del build");
}

const buildVersion = resolveBuildVersion();
const deploymentId = buildVersion.replace(/[^a-zA-Z0-9_-]/g, "-");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  compress: true,
  deploymentId,
  env: {
    ANELLA_BUILD_VERSION: buildVersion,
  },
  // PDF.js relies on native Node.js resolution for its optional canvas
  // implementation. Keep both packages outside the server bundle so managed
  // runtimes install and resolve the correct platform binary.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
  experimental: {
    // The managed Hostinger node reports many CPUs but enforces a much lower
    // process/thread quota. Keep build concurrency explicit and deterministic.
    cpus: 1,
    webpackBuildWorker: false,
    workerThreads: true,
    serverActions: {
      allowedOrigins: getServerActionAllowedOrigins(),
      bodySizeLimit: "64kb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          ...(isHostedDeployment()
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains",
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
