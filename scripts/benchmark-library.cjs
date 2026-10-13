// Compare the pre-0.4.2 scans with the actual current implementations.
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { buildSync } = require("esbuild");
const root = path.resolve(__dirname, "..");
const directory = path.join(root, ".cache", "library-benchmark");
fs.mkdirSync(directory, { recursive: true });
for (const name of ["playerPresentation", "localSearch"]) {
  buildSync({ entryPoints: [path.join(root, "src", "lib", name + ".ts")], outfile: path.join(directory, name + ".cjs"), bundle: true, platform: "node", format: "cjs" });
}
const { createCachedQueueSnapshots } = require(path.join(directory, "playerPresentation.cjs"));
const { createLocalTrackSearchIndex, searchLocalTrackIndex } = require(path.join(directory, "localSearch.cjs"));
const tracks = Array.from({ length: 10000 }, (_, i) => ({ id: String(i), title: "Song " + i, artist: "Artist " + i % 80, album: "Album " + i % 500, quality: "Hi-Res", source: "local", duration: "03:20", waveform: [], lyrics: [], lyricStatus: "searchable" }));
const index = createLocalTrackSearchIndex(tracks);
const median = fn => {
  fn();
  const times = Array.from({ length: 7 }, () => { const start = performance.now(); fn(); return performance.now() - start; }).sort((a, b) => a - b);
  return Number(times[3].toFixed(3));
};
const result = {
  note: "Synthetic CPU benchmark; excludes network, startup, disk and audio playback.",
  trackCount: tracks.length,
  queue: {
    beforeMs: median(() => { const unique = tracks.filter((track, i) => tracks.findIndex(item => item.id === track.id) === i); createCachedQueueSnapshots(unique.slice(0, 1200)); }),
    afterMs: median(() => createCachedQueueSnapshots(tracks, 1200)),
  },
  repeatedSearch: {
    queries: 50,
    beforeMs: median(() => { for (let i = 0; i < 50; i++) tracks.filter(track => [track.title, track.artist, track.album, track.quality].join(" ").toLowerCase().includes(("artist " + i).toLowerCase())).slice(0, 60); }),
    afterMs: median(() => { for (let i = 0; i < 50; i++) searchLocalTrackIndex(tracks, index, "artist " + i, 60); }),
  },
};
fs.writeFileSync(path.join(directory, "report.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
