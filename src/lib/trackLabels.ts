import type { Track } from "@/data/music";

export const sourceLabel: Record<Track["source"], string> = {
  local: "本地",
  cloud: "云盘",
  netease: "网易云",
};
