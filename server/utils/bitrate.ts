// Bitrates are quantized to whole kbps so the same track always renders the
// same badge; sub-kbps jitter (e.g. 1702540 vs 1702980 bps) would otherwise
// flip the display between "1702k" and "1703k".
export function quantizeBitrate(bps: number): number | null {
  if (!Number.isFinite(bps) || bps <= 0) return null;
  return Math.round(bps / 1000) * 1000;
}
