import path from "node:path";

export const dataDir = path.resolve(process.env.ARIA_DATA_DIR || path.join(process.cwd(), ".musicbox"));
export const cacheDir = path.join(dataDir, "cache");
