import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LocalMetadataOverride } from "../src/lib/localMetadata";
import { dataDir } from "./utils/paths";

type UndoEntry = {
  id: string;
  tracks: Record<string, { before?: LocalMetadataOverride; after: LocalMetadataOverride; previousBinding?: string; appliedBinding?: string }>;
};
type MetadataState = { overrides: Record<string, LocalMetadataOverride>; undo: UndoEntry[] };

/** One small journal, persisted atomically. Original audio files and tags are
 * never rewritten, so a match can be corrected or undone without re-scanning. */
export class LocalMetadataStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: string) {}

  async read(): Promise<MetadataState> {
    await this.pending.catch(() => undefined);
    return this.readFile();
  }

  private async readFile(): Promise<MetadataState> {
    try {
      const parsed = JSON.parse(await readFile(path.join(this.directory, "local-metadata.json"), "utf8"));
      return { overrides: parsed.overrides ?? {}, undo: parsed.undo ?? [] };
    } catch {
      return { overrides: {}, undo: [] };
    }
  }

  private change<T>(operation: (state: MetadataState) => T): Promise<T> {
    const next = this.pending.catch(() => undefined).then(async () => {
      const state = await this.readFile();
      const result = operation(state);
      await mkdir(this.directory, { recursive: true });
      const target = path.join(this.directory, "local-metadata.json");
      const temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(state), "utf8");
      await rename(temporary, target);
      return result;
    });
    this.pending = next;
    return next;
  }

  apply(overrides: Record<string, LocalMetadataOverride>, bindings: Record<string, string>) {
    return this.change((state) => {
      const undo: UndoEntry = { id: randomUUID(), tracks: {} };
      for (const [trackId, override] of Object.entries(overrides)) {
        const after = { ...state.overrides[trackId], ...override };
        undo.tracks[trackId] = { before: state.overrides[trackId], after, previousBinding: bindings[trackId], appliedBinding: override.lyrics?.length ? override.candidateId : bindings[trackId] };
        state.overrides[trackId] = after;
      }
      state.undo.push(undo);
      state.undo = state.undo.slice(-20);
      return undo.id;
    });
  }

  undo(undoId: string) {
    return this.change((state) => {
      const entry = state.undo.find((item) => item.id === undoId);
      if (!entry) return null;
      const restored: Record<string, { previousBinding?: string; appliedBinding?: string }> = {};
      const skipped: string[] = [];
      for (const [trackId, snapshot] of Object.entries(entry.tracks)) {
        // Never undo a more recent correction made after this batch.
        if (JSON.stringify(state.overrides[trackId]) !== JSON.stringify(snapshot.after)) {
          skipped.push(trackId);
          continue;
        }
        if (snapshot.before) state.overrides[trackId] = snapshot.before;
        else delete state.overrides[trackId];
        restored[trackId] = { previousBinding: snapshot.previousBinding, appliedBinding: snapshot.appliedBinding };
      }
      state.undo = state.undo.filter((item) => item.id !== undoId);
      return { restored, skipped };
    });
  }
}

export const localMetadataStore = new LocalMetadataStore(dataDir);
