import { cn } from "@/lib/utils";
// aria-icons:用户的自制按钮套件(repo 根目录 aria-icons/*.svg)。
// 通过 Vite ?raw 在构建期内联进 bundle,运行时零请求;SVG 全部基于
// currentColor,主题/深浅色自动适配。`--aria-dot` / `--aria-glint` 变量
// 保留套件默认(currentColor / 白),供后续主题定制。
import playSvg from "../../../aria-icons/play.svg?raw";
import pauseSvg from "../../../aria-icons/pause.svg?raw";
import prevSvg from "../../../aria-icons/prev.svg?raw";
import nextSvg from "../../../aria-icons/next.svg?raw";
import heartSvg from "../../../aria-icons/heart.svg?raw";
import heartFillSvg from "../../../aria-icons/heart-fill.svg?raw";
import volumeSvg from "../../../aria-icons/volume.svg?raw";
import volumeLowSvg from "../../../aria-icons/volume-low.svg?raw";
import volumeMuteSvg from "../../../aria-icons/volume-mute.svg?raw";
import shuffleSvg from "../../../aria-icons/shuffle.svg?raw";
import repeatSvg from "../../../aria-icons/repeat.svg?raw";
import repeatOneSvg from "../../../aria-icons/repeat-one.svg?raw";
import queueSvg from "../../../aria-icons/queue.svg?raw";
import lyricsSvg from "../../../aria-icons/lyrics.svg?raw";
import immersiveSvg from "../../../aria-icons/immersive.svg?raw";
import slidersSvg from "../../../aria-icons/sliders.svg?raw";
import playingSvg from "../../../aria-icons/playing.svg?raw";

export type AriaIconName =
  | "play"
  | "pause"
  | "prev"
  | "next"
  | "heart"
  | "heart-fill"
  | "volume"
  | "volume-low"
  | "volume-mute"
  | "shuffle"
  | "repeat"
  | "repeat-one"
  | "queue"
  | "lyrics"
  | "immersive"
  | "sliders"
  | "playing";

const ICONS: Record<AriaIconName, string> = {
  play: playSvg,
  pause: pauseSvg,
  prev: prevSvg,
  next: nextSvg,
  heart: heartSvg,
  "heart-fill": heartFillSvg,
  volume: volumeSvg,
  "volume-low": volumeLowSvg,
  "volume-mute": volumeMuteSvg,
  shuffle: shuffleSvg,
  repeat: repeatSvg,
  "repeat-one": repeatOneSvg,
  queue: queueSvg,
  lyrics: lyricsSvg,
  immersive: immersiveSvg,
  sliders: slidersSvg,
  playing: playingSvg,
};

/** aria-icons 套件图标:去掉固定宽高,尺寸交给 className,颜色跟随 currentColor。 */
export function AriaIcon({ name, className }: { name: AriaIconName; className?: string }) {
  const markup = (ICONS[name] ?? "")
    .replace(/width="\d+" height="\d+" /, "")
    .replace(/style="fill:var\(--aria-dot,currentColor\)"/g, 'style="fill:var(--aria-dot,currentColor)"');
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex items-center justify-center [&>svg]:size-full", className)}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

/** 音量档位选择:静音/低/正常 三态。 */
export function ariaVolumeIcon(volume: number, muted: boolean): AriaIconName {
  if (muted || volume <= 0) return "volume-mute";
  if (volume < 40) return "volume-low";
  return "volume";
}
