// Constant-dB audio-tapered volume mapping aligned with Windows Core Audio
// Audio-Tapered Volume Controls (dB = 20 * log10(gain)): every 1% slider
// step moves perceived loudness by an equal 0.40 dB increment from -40 dB to 0 dB,
// eliminating the steep low-end cliff at v = 1 -> 2 and unifying WebAudio,
// standalone <video>, and mpv (cubic softvol) output levels.

export const MIN_VOLUME_DB = -40;

export function clampUiVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.max(0, Math.min(100, volume));
}

export function uiVolumeToDb(volume: number): number {
  const clamped = clampUiVolume(volume);
  if (clamped <= 0) return Number.NEGATIVE_INFINITY;
  if (clamped >= 100) return 0;
  return MIN_VOLUME_DB * (1 - clamped / 100);
}

export function uiVolumeToLinearGain(volume: number): number {
  const clamped = clampUiVolume(volume);
  if (clamped <= 0) return 0;
  if (clamped >= 100) return 1;
  return 10 ** (uiVolumeToDb(clamped) / 20);
}

export function uiVolumeToMpvVolume(volume: number): number {
  const gain = uiVolumeToLinearGain(volume);
  if (gain <= 0) return 0;
  if (gain >= 1) return 100;
  return Math.min(100, Math.max(0, 100 * Math.cbrt(gain)));
}

export function uiVolumeToSpectrumScale(volume: number): number {
  const clamped = clampUiVolume(volume);
  if (clamped <= 0) return 0;
  return 0.14 + 0.86 * (clamped / 100);
}
