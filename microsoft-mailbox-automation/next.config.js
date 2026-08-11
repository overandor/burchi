/** @type {import('next').NextConfig} */

/**
 * Standalone output is required for Docker / long-running Node hosts
 * (Hugging Face Spaces, Fly.io). Netlify and Vercel run the Next.js plugin
 * in serverless mode, where `output: 'standalone'` causes all App Router
 * routes to 404. Use the standard server output on those platforms.
 */
const isNetlify = process.env.NETLIFY === "true";
const isVercel = process.env.VERCEL === "1" || process.env.VERCEL === "true";
const output = isNetlify || isVercel ? undefined : "standalone";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output,
  experimental: {
    serverComponentsExternalPackages: ["exceljs", "pdf-parse", "@azure/msal-node", "imapflow", "better-sqlite3"],
  },
  env: {
    NEXT_PUBLIC_DEMO: process.env.NEXT_PUBLIC_DEMO,
  },
};

module.exports = nextConfig;
