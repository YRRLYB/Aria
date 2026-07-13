const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function serializeError(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (value && typeof value === "object") {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }
  }
  return value;
}

function stringifyDetails(details) {
  if (details == null) return "";
  try {
    return ` ${JSON.stringify(details)}`;
  } catch {
    return ` ${String(details)}`;
  }
}

function createLogger(app) {
  function logDir() {
    const baseDir = app.isReady() ? app.getPath("userData") : path.join(app.getPath("appData"), "Aria");
    return path.join(baseDir, "logs");
  }

  function writeLog(fileName, message, details) {
    try {
      const dir = logDir();
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, fileName), `[${new Date().toISOString()}] ${message}${stringifyDetails(details)}\n`, "utf8");
    } catch {
      // Logging should never become a reason for the app to exit.
    }
  }

  function writeRuntimeSnapshot(fileName, reason, details) {
    const memory = process.memoryUsage();
    writeLog(fileName, reason, {
      ...details,
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
      uptime: Math.round(process.uptime()),
      rssMb: Math.round(memory.rss / 1024 / 1024),
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
      freeMemMb: Math.round(os.freemem() / 1024 / 1024),
    });
  }

  function attachProcessHandlers(fileName = "desktop.log") {
    process.on("uncaughtException", (error) => {
      writeRuntimeSnapshot(fileName, "uncaughtException", { error: serializeError(error) });
    });

    process.on("unhandledRejection", (reason) => {
      writeRuntimeSnapshot(fileName, "unhandledRejection", { reason: serializeError(reason) });
    });
  }

  function logRendererPayload(payload) {
    const level = typeof payload?.level === "string" ? payload.level : "info";
    const source = typeof payload?.source === "string" ? payload.source : "renderer";
    const message =
      typeof payload?.message === "string"
        ? payload.message
        : payload?.message == null
          ? "(empty renderer log)"
          : String(payload.message);
    writeLog("renderer.log", `${level} ${source}: ${message}`, {
      stack: payload?.stack,
      filename: payload?.filename,
      line: payload?.line,
      column: payload?.column,
      context: payload?.context,
    });
  }

  return {
    attachProcessHandlers,
    logDir,
    logRendererPayload,
    serializeError,
    writeLog,
    writeRuntimeSnapshot,
  };
}

module.exports = {
  createLogger,
  serializeError,
};
