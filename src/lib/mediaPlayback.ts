/** Ignore a superseded play request: changing sources or pausing can reject it later. */
export function requestMediaPlayback(media: Pick<HTMLMediaElement, "play">, onFailure: (error: unknown) => void) {
  let active = true;
  void media.play().catch((error: unknown) => {
    if (!active || (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")) return;
    onFailure(error);
  });
  return () => { active = false; };
}

/** A delayed error skip must still belong to the currently playing track. */
export function createGuardedAdvance(getCurrent: () => { trackId: string; playing: boolean; advance: () => void }, delayMs = 650) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return {
    cancel,
    schedule(failedTrackId: string) {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        const current = getCurrent();
        if (current.playing && current.trackId === failedTrackId) current.advance();
      }, delayMs);
    },
  };
}
