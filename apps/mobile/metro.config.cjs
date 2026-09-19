const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const root = path.resolve(__dirname, "../..");
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sep = "[/\\\\]";

// Mobile only bundles its own source plus the two shared workspace packages.
// Watching apps/web and apps/api as well made every Next.js or Nest rebuild
// look like a source change to Metro.
config.watchFolders = [
  path.join(root, "node_modules"),
  __dirname,
  path.join(root, "packages/contracts"),
  path.join(root, "packages/api-client"),
];

// Folders a running development session writes into. Metro's HMR server answers
// *any* change under a watched folder with an "update-start" message, which is
// what paints the blue "Refreshing…" banner on the device — even when the
// resulting bundle delta is empty. Paths are anchored at the repository root so
// that identically named folders inside node_modules (`dist`, `build`, …) stay
// resolvable.
const generated = [
  ".api-build",
  ".next",
  ".vinext",
  ".wrangler",
  ".sites-runtime",
  ".qodo",
  ".openai",
  ".git",
  "coverage",
  "dist",
  "build",
  "apps/web/.next",
  "apps/api/dist",
  "apps/mobile/dist",
];

const previous = config.resolver.blockList || [];
config.resolver.blockList = [
  ...(Array.isArray(previous) ? previous : [previous]),
  ...generated.map(
    (folder) =>
      new RegExp("^" + escape(path.join(root, folder)) + "(?:" + sep + "|$)"),
  ),
  // `.expo` holds Expo's own dev state, including `dev/logs/start.log`, which it
  // appends to on every bundling event and every console line the device
  // prints. Left watched, the app's own logs retrigger the banner in a loop.
  // No published package ships a `.expo` folder, so this is safe at any depth.
  new RegExp("^" + escape(root) + sep + "(?:.*" + sep + ")?\\.expo(?:" + sep + "|$)"),
];

module.exports = config;
