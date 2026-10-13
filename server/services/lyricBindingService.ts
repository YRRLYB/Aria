import { resolveLyricLines } from "../lyrics";
import { updateStore } from "../store";

/** Automatic refreshes use compare-and-set so an older network response
 * cannot rebind a track after a manual choice or batch undo. */
export async function bindLocalLyrics(trackId: string, candidateId: string, expectedBinding?: string | null) {
  const lyrics = await resolveLyricLines(candidateId);
  let accepted = true;
  const store = await updateStore((current) => {
    if (expectedBinding !== undefined && (current.lyricBindings[trackId] ?? null) !== expectedBinding) {
      accepted = false;
      return current;
    }
    return { ...current, lyricBindings: { ...current.lyricBindings, [trackId]: candidateId } };
  });
  return { ok: accepted, accepted, lyricBindings: store.lyricBindings, lyrics: accepted ? lyrics : [] };
}
