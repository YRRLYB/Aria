import type { MusicSource, SourceId, SourceManifest } from "./contract";
import { SourceError } from "./contract";
import { neteaseManifest } from "./netease/manifest";
import { qqManifest } from "./qq/manifest";
import { bilibiliManifest } from "./bilibili/manifest";
import { readStore, updateStore } from "../store";
import type { AppStore } from "../types";

/**
 * Built-in source registry. Manifests are plain data imported at startup;
 * source implementations load through dynamic import on first use, so an
 * unused source's client never runs and issues no requests.
 */
const manifests: Partial<Record<SourceId, SourceManifest>> = {
  netease: neteaseManifest,
  qq: qqManifest,
  bilibili: bilibiliManifest,
};

const loaders: Partial<Record<SourceId, () => Promise<MusicSource>>> = {
  netease: () => import("./netease/source").then((module) => module.neteaseSource),
  qq: () => import("./qq/source").then((module) => module.qqSource),
  bilibili: () => import("./bilibili/source").then((module) => module.bilibiliSource),
};

const instances = new Map<SourceId, MusicSource>();

/**
 * Circuit breaker state. A source that keeps failing upstream is taken out of
 * rotation for a short window instead of letting every keystroke in the search
 * box hit a broken provider again (`multi-source-impl` §5).
 */
const FAILURE_THRESHOLD = 3;
const FAILURE_WINDOW_MS = 60_000;
const OPEN_MS = 30_000;
type CircuitState = { failures: number[]; openUntil: number };
const circuits = new Map<SourceId, CircuitState>();

const enabledCacheTtl = 5_000;
let enabledCache: { expiresAt: number; value: Record<string, boolean> } | null = null;

export type SourceRuntimeState = {
  manifest: SourceManifest;
  enabled: boolean;
  /** ms timestamp until which the source is skipped after repeated failures. */
  unavailableUntil: number | null;
};

export function listSourceManifests(): SourceManifest[] {
  return Object.keys(loaders)
    .sort()
    .map((id) => manifests[id as SourceId])
    .filter((manifest): manifest is SourceManifest => Boolean(manifest));
}

/** Enabled flags persisted in the store; defaults to enabled when unset. */
export async function readSourceEnabledMap(): Promise<Record<string, boolean>> {
  if (enabledCache && enabledCache.expiresAt > Date.now()) return enabledCache.value;
  const store = await readStore().catch(() => null);
  const stored = (store as AppStore | null)?.sources ?? {};
  const value: Record<string, boolean> = {};
  for (const id of Object.keys(loaders)) {
    value[id] = stored[id]?.enabled !== false;
  }
  enabledCache = { expiresAt: Date.now() + enabledCacheTtl, value };
  return value;
}

export async function setSourceEnabled(id: string, enabled: boolean) {
  if (!isRegisteredSource(id)) {
    throw new SourceError("UNAVAILABLE", `未知的播放源: ${id}`);
  }
  await updateStore((store) => ({
    ...store,
    sources: {
      ...(store.sources ?? {}),
      [id]: { ...(store.sources?.[id] ?? {}), enabled },
    },
  }));
  enabledCache = null;
  if (enabled) circuits.delete(id as SourceId);
  return listSourceStates();
}

export async function listSourceStates(): Promise<SourceRuntimeState[]> {
  const enabled = await readSourceEnabledMap();
  return listSourceManifests().map((manifest) => {
    const circuit = circuits.get(manifest.id);
    return {
      manifest,
      enabled: enabled[manifest.id] !== false,
      unavailableUntil: circuit && circuit.openUntil > Date.now() ? circuit.openUntil : null,
    };
  });
}

export async function getSource(id: string): Promise<MusicSource> {
  const sourceId = (isRegisteredSource(id) ? id : null) as SourceId | null;
  if (!sourceId || !loaders[sourceId]) {
    throw new SourceError("UNAVAILABLE", `未知的播放源: ${id}`);
  }
  const enabled = await readSourceEnabledMap();
  if (enabled[sourceId] === false) {
    throw new SourceError("UNAVAILABLE", `${id} 播放源已停用`, { source: sourceId });
  }
  const circuit = circuits.get(sourceId);
  if (circuit && circuit.openUntil > Date.now()) {
    throw new SourceError("UNAVAILABLE", `${id} 播放源暂时不可用，请稍后重试`, {
      source: sourceId,
      retryAfterMs: circuit.openUntil - Date.now(),
    });
  }
  let source = instances.get(sourceId);
  if (!source) {
    source = withCircuitBreaker(sourceId, await loaders[sourceId]!());
    instances.set(sourceId, source);
  }
  return source;
}

export function resetSourceCircuit(id?: string) {
  if (id) circuits.delete(id as SourceId);
  else circuits.clear();
}

/**
 * Wraps every method so upstream failures are counted, while user-facing
 * "this track needs a membership" answers are not — those are valid results,
 * not a broken source.
 */
function withCircuitBreaker(sourceId: SourceId, source: MusicSource): MusicSource {
  const breakerCodes = new Set(["UPSTREAM_FAILED", "TIMEOUT", "RATE_LIMITED"]);
  const wrap = (value: unknown) => {
    if (typeof value !== "function") return value;
    const original = value as (...args: unknown[]) => Promise<unknown>;
    return async (...args: unknown[]) => {
      try {
        const result = await original.apply(source, args);
        recordSuccess(sourceId);
        return result;
      } catch (error) {
        if (error instanceof SourceError) {
          if (breakerCodes.has(error.code)) recordFailure(sourceId);
        } else {
          recordFailure(sourceId);
        }
        throw error;
      }
    };
  };
  return new Proxy(source, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property === "manifest") return value;
      return wrap(value);
    },
  }) as MusicSource;
}

function recordSuccess(sourceId: SourceId) {
  const circuit = circuits.get(sourceId);
  if (!circuit) return;
  circuit.failures = [];
  circuit.openUntil = 0;
}

function recordFailure(sourceId: SourceId) {
  const now = Date.now();
  const circuit = circuits.get(sourceId) ?? { failures: [], openUntil: 0 };
  circuit.failures = circuit.failures.filter((at) => now - at < FAILURE_WINDOW_MS);
  circuit.failures.push(now);
  if (circuit.failures.length >= FAILURE_THRESHOLD) {
    circuit.openUntil = now + OPEN_MS;
    circuit.failures = [];
  }
  circuits.set(sourceId, circuit);
}

function isRegisteredSource(id: string): id is SourceId {
  return id in loaders;
}
