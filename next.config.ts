import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  // Prisma ships a native query-engine binary that can't be bundled into a
  // JS chunk — it must stay a normal Node `require()` resolved from
  // node_modules at runtime. This is Prisma's own documented config for
  // Next.js standalone builds; without it, the bundler may try to
  // externalize it in an unpredictable, internally-hashed way instead
  // (which is what produced "Cannot find module '@prisma/client-<hash>'").
  //
  // fyers-api-v3's WebSocket module (HSM/datasocket.min.js) has the exact
  // same problem for a different reason: it's a minified/obfuscated file
  // that internally `require()`s a sibling file (../HSM_Package/hslib.js)
  // by relative path. Next's bundler doesn't preserve that folder
  // structure when it tries to trace/bundle the package, which breaks the
  // relative require ("Cannot find module '../HSM_Package/hslib.js'" at
  // build time). Listing it here tells Next to leave the whole package
  // alone and copy it wholesale instead of bundling it, so its internal
  // file layout stays intact.
  serverExternalPackages: ["@prisma/client", ".prisma/client", "fyers-api-v3"],
};

export default nextConfig;
