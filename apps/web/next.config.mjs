/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [],
  allowedDevOrigins: ["admin.vitap.in", "workstation.vitap.in"],
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
};

export default nextConfig;
