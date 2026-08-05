/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['exceljs', 'pdf-parse', '@azure/msal-node', 'imapflow']
  },
  env: {
    NEXT_PUBLIC_DEMO: process.env.NEXT_PUBLIC_DEMO,
  },
};

module.exports = nextConfig;
