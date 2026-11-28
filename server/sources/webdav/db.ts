import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDir } from "../../utils/paths";

export type WebdavTrackRow = {
  id: string;
  instanceId: string;
  remotePath: string;
  etag: string;
  fileSize: number;
  title: string;
  artist: string | null;
  album: string | null;
  durationMs: number;
  sampleRate: number | null;
  bitDepth: number | null;
  bitrateKbps: number | null;
  format: string | null;
  lyricPath: string | null;
  coverPath: string | null;
  updatedAt: number;
};

type RawSqlRow = {
  id: string;
  instance_id: string;
  remote_path: string;
  etag: string;
  file_size: number;
  title: string;
  artist: string | null;
  album: string | null;
  duration_ms: number;
  sample_rate: number | null;
  bit_depth: number | null;
  bitrate_kbps: number | null;
  format: string | null;
  lyric_path: string | null;
  cover_path: string | null;
  updated_at: number;
};

function mapRow(raw: RawSqlRow): WebdavTrackRow {
  return {
    id: String(raw.id),
    instanceId: String(raw.instance_id),
    remotePath: String(raw.remote_path),
    etag: String(raw.etag),
    fileSize: Number(raw.file_size) || 0,
    title: String(raw.title),
    artist: raw.artist ?? null,
    album: raw.album ?? null,
    durationMs: Number(raw.duration_ms) || 0,
    sampleRate: raw.sample_rate != null ? Number(raw.sample_rate) : null,
    bitDepth: raw.bit_depth != null ? Number(raw.bit_depth) : null,
    bitrateKbps: raw.bitrate_kbps != null ? Number(raw.bitrate_kbps) : null,
    format: raw.format ?? null,
    lyricPath: raw.lyric_path ?? null,
    coverPath: raw.cover_path ?? null,
    updatedAt: Number(raw.updated_at) || 0,
  };
}

export class WebdavIndexDb {
  private readonly db: DatabaseSync;

  constructor(dbPath = path.join(dataDir, "webdav-index.sqlite")) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS webdav_tracks (
        id            TEXT PRIMARY KEY,
        instance_id   TEXT NOT NULL,
        remote_path   TEXT NOT NULL,
        etag          TEXT NOT NULL,
        file_size     INTEGER NOT NULL,
        title         TEXT NOT NULL,
        artist        TEXT,
        album         TEXT,
        duration_ms   INTEGER DEFAULT 0,
        sample_rate   INTEGER,
        bit_depth     INTEGER,
        bitrate_kbps  INTEGER,
        format        TEXT,
        lyric_path    TEXT,
        cover_path    TEXT,
        updated_at    INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_webdav_instance_path
        ON webdav_tracks (instance_id, remote_path);
    `);
  }

  getExistingEtags(instanceId: string): Map<string, { id: string; etag: string; fileSize: number }> {
    const stmt = this.db.prepare(
      "SELECT id, remote_path, etag, file_size FROM webdav_tracks WHERE instance_id = ?",
    );
    const rows = stmt.all(instanceId) as Array<{ id: string; remote_path: string; etag: string; file_size: number }>;
    const map = new Map<string, { id: string; etag: string; fileSize: number }>();
    for (const row of rows) {
      map.set(row.remote_path, { id: row.id, etag: row.etag, fileSize: Number(row.file_size) || 0 });
    }
    return map;
  }

  upsertTracks(tracks: WebdavTrackRow[]): void {
    if (!tracks.length) return;
    const stmt = this.db.prepare(`
      INSERT INTO webdav_tracks (
        id, instance_id, remote_path, etag, file_size, title, artist, album,
        duration_ms, sample_rate, bit_depth, bitrate_kbps, format, lyric_path, cover_path, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        etag = excluded.etag,
        file_size = excluded.file_size,
        title = excluded.title,
        artist = excluded.artist,
        album = excluded.album,
        duration_ms = excluded.duration_ms,
        sample_rate = excluded.sample_rate,
        bit_depth = excluded.bit_depth,
        bitrate_kbps = excluded.bitrate_kbps,
        format = excluded.format,
        lyric_path = excluded.lyric_path,
        cover_path = excluded.cover_path,
        updated_at = excluded.updated_at
    `);
    this.db.exec("BEGIN");
    try {
      for (const t of tracks) {
        stmt.run(
          t.id,
          t.instanceId,
          t.remotePath,
          t.etag,
          t.fileSize,
          t.title,
          t.artist,
          t.album,
          t.durationMs,
          t.sampleRate,
          t.bitDepth,
          t.bitrateKbps,
          t.format,
          t.lyricPath,
          t.coverPath,
          t.updatedAt,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  pruneMissingPaths(instanceId: string, keepRemotePaths: Set<string>): number {
    const existing = this.getExistingEtags(instanceId);
    const toDelete: string[] = [];
    for (const [remotePath, entry] of existing) {
      if (!keepRemotePaths.has(remotePath)) toDelete.push(entry.id);
    }
    if (!toDelete.length) return 0;
    const stmt = this.db.prepare("DELETE FROM webdav_tracks WHERE id = ?");
    this.db.exec("BEGIN");
    try {
      for (const id of toDelete) stmt.run(id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return toDelete.length;
  }

  listTracks(instanceId?: string, limit = 1000, offset = 0): WebdavTrackRow[] {
    if (instanceId) {
      const stmt = this.db.prepare(
        "SELECT * FROM webdav_tracks WHERE instance_id = ? ORDER BY updated_at DESC, remote_path ASC LIMIT ? OFFSET ?",
      );
      return (stmt.all(instanceId, limit, offset) as RawSqlRow[]).map(mapRow);
    }
    const stmt = this.db.prepare(
      "SELECT * FROM webdav_tracks ORDER BY updated_at DESC, remote_path ASC LIMIT ? OFFSET ?",
    );
    return (stmt.all(limit, offset) as RawSqlRow[]).map(mapRow);
  }

  searchTracks(query: string, limit = 24, offset = 0, instanceIds?: string[]): WebdavTrackRow[] {
    const like = `%${query.trim()}%`;
    if (instanceIds && !instanceIds.length) return [];
    if (instanceIds?.length) {
      const placeholders = instanceIds.map(() => "?").join(", ");
      const stmt = this.db.prepare(`
        SELECT * FROM webdav_tracks
        WHERE instance_id IN (${placeholders})
          AND (title LIKE ? OR COALESCE(artist, '') LIKE ? OR COALESCE(album, '') LIKE ? OR remote_path LIKE ?)
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `);
      return (stmt.all(...instanceIds, like, like, like, like, limit, offset) as RawSqlRow[]).map(mapRow);
    }
    const stmt = this.db.prepare(`
      SELECT * FROM webdav_tracks
      WHERE title LIKE ? OR COALESCE(artist, '') LIKE ? OR COALESCE(album, '') LIKE ? OR remote_path LIKE ?
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `);
    return (stmt.all(like, like, like, like, limit, offset) as RawSqlRow[]).map(mapRow);
  }

  getTrackById(id: string): WebdavTrackRow | null {
    const row = this.db.prepare("SELECT * FROM webdav_tracks WHERE id = ?").get(id) as RawSqlRow | undefined;
    return row ? mapRow(row) : null;
  }

  countByInstance(instanceId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS cnt FROM webdav_tracks WHERE instance_id = ?")
      .get(instanceId) as { cnt: number } | undefined;
    return Number(row?.cnt ?? 0);
  }

  deleteInstanceTracks(instanceId: string): void {
    this.db.prepare("DELETE FROM webdav_tracks WHERE instance_id = ?").run(instanceId);
  }

  close(): void {
    this.db.close();
  }
}

let defaultDb: WebdavIndexDb | null = null;

export function getWebdavIndexDb(): WebdavIndexDb {
  if (!defaultDb) {
    defaultDb = new WebdavIndexDb();
  }
  return defaultDb;
}
