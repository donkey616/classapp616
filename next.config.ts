import type { NextConfig } from "next";

const databaseStore = process.env.CF_DEPLOY === "1"
  ? "./src/lib/database-store.stub.ts"
  : "./src/lib/database-store.ts";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
    },
  },
  turbopack: {
    resolveAlias: {
      "@hk/database-store": databaseStore,
    },
  },
};

export default nextConfig;
