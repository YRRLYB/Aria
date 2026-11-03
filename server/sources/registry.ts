import type { MusicSource, SourceId, SourceManifest } from "./contract";
import { SourceError } from "./contract";
import { neteaseManifest } from "./netease/manifest";
import { qqManifest } from "./qq/manifest";

/**
 * Built-in source registry. Manifests are plain data imported at startup;
 * source implementations load through dynamic import on first use, so an
 * unused source's client never runs and issues no requests.
 */
const manifests: Partial<Record<SourceId, SourceManifest>> = {
  netease: neteaseManifest,
  qq: qqManifest,
};

const loaders: Partial<Record<SourceId, () => Promise<MusicSource>>> = {
  netease: () => import("./netease/source").then((module) => module.neteaseSource),
  qq: () => import("./qq/source").then((module) => module.qqSource),
};

const instances = new Map<SourceId, MusicSource>();

export function listSourceManifests(): SourceManifest[] {
  return Object.keys(loaders)
    .sort()
    .map((id) => manifests[id as SourceId])
    .filter((manifest): manifest is SourceManifest => Boolean(manifest));
}

export async function getSource(id: string): Promise<MusicSource> {
  const sourceId = (isRegisteredSource(id) ? id : null) as SourceId | null;
  if (!sourceId || !loaders[sourceId]) {
    throw new SourceError("UNAVAILABLE", `未知的播放源: ${id}`);
  }
  let source = instances.get(sourceId);
  if (!source) {
    source = await loaders[sourceId]!();
    instances.set(sourceId, source);
  }
  return source;
}

function isRegisteredSource(id: string): id is SourceId {
  return id in loaders;
}
