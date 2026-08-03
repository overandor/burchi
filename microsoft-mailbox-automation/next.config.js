/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['exceljs', 'pdf-parse', '@azure/msal-node']
  },
  env: {
    NEXT_PUBLIC_DEMO: process.env.NEXT_PUBLIC_DEMO,
  },
};

module.exports = nextConfig;
