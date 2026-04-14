/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [],
  allowedDevOrigins: ["tablet.vitap.in"],
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
};

export default nextConfig;
