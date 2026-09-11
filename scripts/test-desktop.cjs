// Windows integration test using the OS media-session API and the real player.
// npm run build:desktop && node scripts/test-desktop.cjs [--resources release/win-unpacked/resources]
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");

if (process.versions.electron) {
  const { app, BrowserWindow } = require("electron");
  app.setPath("userData", process.env.ARIA_SMOKE_PROFILE);
  const setId = app.setAppUserModelId.bind(app);
  app.setAppUserModelId = () => setId(process.env.ARIA_SMOKE_APP_ID);
  const setDetails = BrowserWindow.prototype.setAppDetails;
  BrowserWindow.prototype.setAppDetails = function (details) {
    return setDetails.call(this, { ...details, appId: process.env.ARIA_SMOKE_APP_ID });
  };
  if (process.env.ARIA_SMOKE_RESOURCES) {
    Object.defineProperty(app, "isPackaged", { value: true });
    Object.defineProperty(process, "resourcesPath", { value: process.env.ARIA_SMOKE_RESOURCES });
  }
  const main = process.env.ARIA_SMOKE_RESOURCES
    ? path.join(process.env.ARIA_SMOKE_RESOURCES, "app.asar", "electron", "main.cjs")
    : path.join(root, "electron", "main.cjs");
  require(main);
} else {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}

async function main() {
  if (process.platform !== "win32") throw new Error("This integration test requires Windows and a WASAPI output device.");
  const http = require("node:http");
  const sharp = require("sharp");
  const run = promisify(execFile);
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  fs.mkdirSync(path.join(root, ".cache"), { recursive: true });
  const testDir = fs.mkdtempSync(path.join(root, ".cache", "desktop-smoke-"));
  const appId = `com.yrrlyb.aria.test.${process.pid}`;
  const covers = await Promise.all(["#b63355", "#3366cc"].map((background) =>
    sharp({ create: { width: 512, height: 512, channels: 3, background } }).png().toBuffer()));
  const wav = Buffer.alloc(44 + 48000 * 4 * 120);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(192000, 28);
  wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let offset = 44; offset < wav.length; offset += 4) {
    const value = Math.round(Math.sin((offset - 44) / 4 * Math.PI * 440 / 48000) * 10);
    wav.writeInt16LE(value, offset); wav.writeInt16LE(value, offset + 2);
  }
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.endsWith(".wav")) {
      const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Number(range[2]) : wav.length - 1;
      res.setHeader("Content-Type", "audio/wav"); res.setHeader("Accept-Ranges", "bytes");
      if (range) { res.statusCode = 206; res.setHeader("Content-Range", `bytes ${start}-${end}/${wav.length}`); }
      res.setHeader("Content-Length", end - start + 1); res.end(wav.subarray(start, end + 1)); return;
    }
    if (/^\/cover-[01]\.png$/.test(url.pathname)) {
      res.setHeader("Content-Type", "image/png"); res.end(covers[Number(url.pathname[7])]); return;
    }
    const file = path.resolve(root, "dist", `.${url.pathname === "/" ? "/index.html" : url.pathname}`);
    if (!file.startsWith(path.join(root, "dist") + path.sep)) { res.statusCode = 404; res.end(); return; }
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png" })[path.extname(file)] || "application/octet-stream");
    const stream = fs.createReadStream(file);
    stream.on("error", () => { res.statusCode = 404; res.end(); }); stream.pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function freePort() {
    const socket = require("node:net").createServer();
    await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve)); return port;
  }
  const debugPort = await freePort();
  const env = { ...process.env, ARIA_SMOKE_PROFILE: path.join(testDir, "profile"), ARIA_SMOKE_APP_ID: appId,
    ARIA_API_PORT: String(await freePort()), ARIA_DEV_SERVER_URL: base };
  delete env.ELECTRON_RUN_AS_NODE;
  const resourceIndex = process.argv.indexOf("--resources");
  if (resourceIndex >= 0) env.ARIA_SMOKE_RESOURCES = path.resolve(process.argv[resourceIndex + 1]);
  const log = fs.openSync(path.join(testDir, "electron.log"), "w");
  const child = spawn(require("electron"), [__filename, `--remote-debugging-port=${debugPort}`], { env, windowsHide: true, stdio: ["ignore", log, log] });
  fs.closeSync(log);
  const exited = new Promise((resolve) => child.once("exit", resolve));
  let ws;
  let requestId = 0;
  const pending = new Map();
  async function evaluate(expression) {
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Renderer command timed out: ${expression.slice(0, 120)}`)); }, 10000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message)));
        else resolve(message.result?.result?.value);
      });
      ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    });
  }
  async function media(command) {
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "windows-media-session.ps1"), "-AppId", appId];
    if (command) args.push("-Command", command);
    const { stdout } = await run("powershell.exe", args, { windowsHide: true, timeout: 15000 });
    return JSON.parse(stdout).filter((session) => session.appId === appId);
  }
  async function card(title, status, artwork = true) {
    let cards;
    for (let attempt = 0; attempt < 16; attempt++) {
      cards = await media();
      if (cards.length === 1 && cards[0].title === title && cards[0].status === status &&
          cards[0].artwork === artwork && cards[0].next && cards[0].previous) return cards[0];
      await delay(250);
    }
    throw new Error(`Expected ${title} ${status} artwork=${artwork}, got ${JSON.stringify(cards)}`);
  }
  async function command(action) {
    const result = await media(action);
    assert.equal(result.length, 1); assert.equal(result[0].commandSuccess, true);
  }
  try {
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
        const page = pages.find((page) => page.type === "page" && page.url !== "about:blank");
        if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
      } catch {}
      if (child.exitCode !== null) throw new Error(`Electron exited: see ${testDir}`);
      await delay(250);
    }
    if (!ws) throw new Error(`Electron did not become ready: see ${testDir}`);
    await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
    ws.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data); const resolve = pending.get(message.id);
      if (resolve) { pending.delete(message.id); resolve(message); }
    });
    // Exercise extraction and the packaged sharp binary through the real API.
    const libraryDir = path.join(testDir, "library"); fs.mkdirSync(libraryDir);
    const embeddedCover = await sharp(covers[0]).resize(3000, 2000, { fit: "fill" }).png().toBuffer();
    const picture = Buffer.concat([Buffer.from([0]), Buffer.from("image/png\0"), Buffer.from([3, 0]), embeddedCover]);
    const frame = Buffer.alloc(10); frame.write("APIC"); frame.writeUInt32BE(picture.length, 4);
    const tag = Buffer.alloc(10); tag.write("ID3"); tag[3] = 3;
    const tagSize = frame.length + picture.length;
    for (let i = 0; i < 4; i++) tag[6 + i] = (tagSize >>> ((3 - i) * 7)) & 127;
    const id3 = Buffer.concat([tag, frame, picture]);
    const chunk = Buffer.alloc(8); chunk.write("id3 "); chunk.writeUInt32LE(id3.length, 4);
    const musicFile = Buffer.concat([wav, chunk, id3, Buffer.alloc(id3.length % 2)]);
    musicFile.writeUInt32LE(musicFile.length - 8, 4);
    fs.writeFileSync(path.join(libraryDir, "cover.wav"), musicFile);
    const apiBase = `http://127.0.0.1:${env.ARIA_API_PORT}`;
    const scanResponse = await fetch(`${apiBase}/api/library/scan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderPath: libraryDir }) });
    assert.equal(scanResponse.ok, true);
    const scanned = await scanResponse.json();
    assert.equal(scanned.tracks.length, 1); assert.equal(scanned.tracks[0].hasCover, true);
    const coverUrl = `${apiBase}/api/library/tracks/${scanned.tracks[0].id}/cover`;
    for (const [suffix, dimensions] of [["", [3000, 2000]], ["?size=320", [320, 213]], ["?size=768", [768, 512]]]) {
      const response = await fetch(coverUrl + suffix); assert.equal(response.ok, true);
      const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
      assert.deepEqual([metadata.width, metadata.height], dimensions);
    }
    console.log("PASS local artwork: embedded extraction, original, 320px and 768px disk cache");
    const tracks = ["One", "Two", "Three"].map((name, index) => ({
      id: `smtc-${index}`, title: `SMTC Test ${name}`, artist: "Aria Test Artist", album: "Aria Test Album", duration: "02:00",
      source: "cloud", quality: "Lossless", streamUrl: `${base}/${index}.wav`, coverUrl: index < 2 ? `${base}/cover-${index}.png` : undefined,
      cover: "#555", accent: "#777", waveform: [], lyrics: [], lyricStatus: "missing",
    }));
    const report = [];
    for (const mode of ["system", "shared", "exclusive", "system"]) {
      const player = { activeTrackId: tracks[0].id, activeTrackSnapshot: tracks[0], playQueueIds: tracks.map((track) => track.id), playQueueSnapshots: tracks, volume: 1, activeView: "home" };
      const settings = { outputMode: mode, sinkId: "default", gaplessEnabled: false, hifiEnabled: true, exclusiveMode: mode === "exclusive" };
      await evaluate(`localStorage.setItem('aria-player-state', ${JSON.stringify(JSON.stringify(player))}); localStorage.setItem('aria-audio-settings', ${JSON.stringify(JSON.stringify(settings))}); setTimeout(() => location.reload(), 100)`);
      await delay(600);
      const first = await card("SMTC Test One", "Paused");
      await evaluate("window.__nativeEvents = []; window.ariaDesktop.nativeAudio.onEvent(event => { window.__nativeEvents.push(event); if(window.__nativeEvents.length > 100) window.__nativeEvents.shift(); })");
      assert.equal(first.artist, "Aria Test Artist"); assert.equal(first.album, "Aria Test Album");
      await command("play"); await card("SMTC Test One", "Playing"); await delay(1200);
      let native = await evaluate("window.ariaDesktop.nativeAudio.getState()");
      if (mode === "system") {
        assert.equal(native.active, false); assert.equal(native.ready, false);
        assert.equal(await evaluate("document.querySelector('audio').paused"), false);
      } else {
        assert.equal(native.active, true); assert.equal(native.paused, false);
        assert.equal(native.exclusive, mode === "exclusive"); assert.equal(native.trackId, "smtc-0"); assert.ok(native.position > 0);
      }
      await command("play"); await card("SMTC Test One", "Playing");
      await command("pause"); await card("SMTC Test One", "Paused");
      await command("pause"); await card("SMTC Test One", "Paused");
      await command("next"); const second = await card("SMTC Test Two", "Playing");
      assert.ok(first.artworkHash); assert.ok(second.artworkHash); assert.notEqual(first.artworkHash, second.artworkHash);
      await command("next"); await card("SMTC Test Three", "Playing", false);
      await command("next"); await card("SMTC Test One", "Playing");
      if (mode !== "system") {
        await delay(500);
        assert.equal(await evaluate("document.querySelector('audio').getAttribute('src')"), null);
      }
      await command("previous"); await card("SMTC Test Three", "Playing", false);
      await evaluate("window.ariaDesktop.minimizeToTray()");
      await command("next"); await card("SMTC Test One", "Playing");
      await command("pause"); await card("SMTC Test One", "Paused");
      native = await evaluate("window.ariaDesktop.nativeAudio.getState()");
      if (mode !== "system") assert.equal(native.paused, true);
      report.push({ mode, metadata: true, artworkChanges: true, missingArtworkCleared: true,
        playPause: true, idempotentCommands: true, nextPrevious: true, backgroundControls: true, native });
      console.log(`PASS ${mode}: metadata, changed/missing artwork, play/pause, queue, background`);
    }
    // Exercise native EOF without issuing a renderer "next" command.
    for (const repeat of [false, true]) {
      const player = { activeTrackId: tracks[0].id, activeTrackSnapshot: tracks[0], playQueueIds: tracks.map((track) => track.id), playQueueSnapshots: tracks, volume: 1, activeView: "home", repeatMode: repeat ? "one" : "all" };
      const settings = { outputMode: "shared", sinkId: "default", gaplessEnabled: !repeat, hifiEnabled: true, exclusiveMode: false };
      await evaluate(`localStorage.setItem('aria-player-state', ${JSON.stringify(JSON.stringify(player))}); localStorage.setItem('aria-audio-settings', ${JSON.stringify(JSON.stringify(settings))}); setTimeout(() => location.reload(), 100)`);
      await delay(600); await card("SMTC Test One", "Paused");
      await command("play"); await card("SMTC Test One", "Playing"); await delay(800);
      await evaluate("window.ariaDesktop.nativeAudio.seek(116)");
      await delay(5500);
      await card(repeat ? "SMTC Test One" : "SMTC Test Two", "Playing");
      const native = await evaluate("window.ariaDesktop.nativeAudio.getState()");
      assert.equal(native.trackId, repeat ? "smtc-0" : "smtc-1"); assert.ok(native.position < 15);
      if (!repeat) assert.ok(native.gaplessGeneration > 0);
      await command("pause");
      report.push({ test: repeat ? "repeat-one" : "gapless-advance", passed: true });
      console.log(`PASS ${repeat ? "repeat-one" : "gapless advance"}: native EOF and media card`);
    }
    fs.writeFileSync(path.join(testDir, "results.json"), JSON.stringify(report, null, 2));
    console.log(`Results: ${testDir}`);
  } catch (error) {
    try {
      const diagnostic = await evaluate("({events:window.__nativeEvents, settings:localStorage.getItem('aria-audio-settings'), player:localStorage.getItem('aria-player-state'), audio:{src:document.querySelector('audio').src, paused:document.querySelector('audio').paused}})");
      fs.writeFileSync(path.join(testDir, "failure.json"), JSON.stringify(diagnostic, null, 2));
      console.error(`Failure details: ${testDir}`);
    } catch {}
    throw error;
  } finally {
    if (ws?.readyState === WebSocket.OPEN) {
      void evaluate("window.ariaDesktop.quitApp()").catch(() => undefined);
      await Promise.race([exited, delay(4000)]); ws.close();
    }
    if (child.exitCode === null) child.kill();
    server.closeAllConnections(); server.close();
  }
}
