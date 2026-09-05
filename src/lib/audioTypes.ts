export type NativeAudioState = {
  supported: boolean;
  ready: boolean;
  active: boolean;
  trackId: string | null;
  url: string | null;
  position: number;
  duration: number;
  paused: boolean;
  volume: number;
  exclusive: boolean;
  deviceId: string;
  bitrate: number | null;
  gaplessGeneration?: number;
  kind?: string;
};
