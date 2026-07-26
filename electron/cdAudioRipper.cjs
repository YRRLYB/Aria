const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

class CdAudioRipper {
  constructor({ app, writeLog }) {
    this.app = app;
    this.writeLog = writeLog;
    this.scriptPath = null;
  }

  cacheDir() {
    return path.join(this.app.getPath("userData"), "cd-cache");
  }

  normalizeDevice(device) {
    const text = String(device ?? "").trim();
    if (!text) return "";
    if (/^[a-z]:$/i.test(text)) return `${text}\\`;
    return text.endsWith("\\") ? text : `${text}\\`;
  }

  parseTrackNumber(value) {
    const match = String(value ?? "").match(/#?(\d+)/);
    if (!match) return null;
    const number = Number(match[1]);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
  }

  async ripTrack({ device, trackNumber }) {
    const normalizedDevice = this.normalizeDevice(device);
    const safeTrackNumber = this.parseTrackNumber(trackNumber);
    if (!normalizedDevice) throw new Error("Audio CD device is missing.");
    if (!safeTrackNumber) throw new Error("Audio CD track number is missing.");

    const outDir = this.cacheDir();
    fs.mkdirSync(outDir, { recursive: true });
    await this.ensureScript();

    const stdout = [];
    const stderr = [];
    await new Promise((resolve, reject) => {
      const child = spawn(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          this.scriptPath,
          "-Drive",
          normalizedDevice,
          "-Track",
          String(safeTrackNumber),
          "-OutDir",
          outDir,
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );

      child.stdout?.on("data", (chunk) => stdout.push(String(chunk)));
      child.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`Audio CD rip failed: ${stderr.join("").trim() || `code=${code} signal=${signal}`}`));
      });
    });

    const output = stdout.join("").trim().split(/\r?\n/).filter(Boolean).at(-1);
    if (!output) throw new Error("Audio CD rip did not return a result.");

    const result = JSON.parse(output);
    if (!result?.path || !fs.existsSync(result.path)) {
      throw new Error("Audio CD rip did not produce a playable WAV file.");
    }
    return result;
  }

  async ensureScript() {
    const dir = this.cacheDir();
    fs.mkdirSync(dir, { recursive: true });
    const scriptPath = path.join(dir, "aria-cd-ripper.ps1");
    const script = this.ripperScript();
    const existing = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, "utf8") : "";
    if (existing !== script) fs.writeFileSync(scriptPath, script, "utf8");
    this.scriptPath = scriptPath;
  }

  ripperScript() {
    return String.raw`param(
  [Parameter(Mandatory = $true)][string]$Drive,
  [Parameter(Mandatory = $true)][int]$Track,
  [Parameter(Mandatory = $true)][string]$OutDir
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$source = @"
using System;
using System.IO;
using System.Security.Cryptography;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public sealed class AriaCdRipResult {
  public string path { get; set; }
  public bool cached { get; set; }
  public int track { get; set; }
  public int startSector { get; set; }
  public int sectorCount { get; set; }
  public double duration { get; set; }
  public int sampleRate { get; set; }
  public int bitsPerSample { get; set; }
  public int channels { get; set; }
  public int bitrate { get; set; }
  public string discId { get; set; }
}

public static class AriaCdRipper {
  const uint GENERIC_READ = 0x80000000;
  const uint FILE_SHARE_READ = 0x00000001;
  const uint FILE_SHARE_WRITE = 0x00000002;
  const uint OPEN_EXISTING = 3;
  const uint IOCTL_CDROM_READ_TOC = 0x00024000;
  const uint IOCTL_CDROM_RAW_READ = 0x0002403E;
  const int CDDA = 2;
  const int RawSectorBytes = 2352;
  const int CookedSectorBytes = 2048;
  const int FramesPerSecond = 75;
  const int SampleRate = 44100;
  const short BitsPerSample = 16;
  const short Channels = 2;

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern SafeFileHandle CreateFile(
    string lpFileName,
    uint dwDesiredAccess,
    uint dwShareMode,
    IntPtr lpSecurityAttributes,
    uint dwCreationDisposition,
    uint dwFlagsAndAttributes,
    IntPtr hTemplateFile
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool DeviceIoControl(
    SafeFileHandle hDevice,
    uint dwIoControlCode,
    IntPtr lpInBuffer,
    int nInBufferSize,
    byte[] lpOutBuffer,
    int nOutBufferSize,
    out int lpBytesReturned,
    IntPtr lpOverlapped
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool DeviceIoControl(
    SafeFileHandle hDevice,
    uint dwIoControlCode,
    byte[] lpInBuffer,
    int nInBufferSize,
    byte[] lpOutBuffer,
    int nOutBufferSize,
    out int lpBytesReturned,
    IntPtr lpOverlapped
  );

  public static AriaCdRipResult Rip(string drive, int track, string outDir) {
    if (track <= 0) throw new ArgumentOutOfRangeException("track");
    Directory.CreateDirectory(outDir);

    string normalizedDrive = NormalizeDrive(drive);
    string devicePath = @"\\.\" + normalizedDrive.TrimEnd('\\');

    using (SafeFileHandle handle = CreateFile(devicePath, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero)) {
      if (handle.IsInvalid) ThrowLastWin32("Unable to open audio CD drive " + devicePath);

      byte[] toc = ReadToc(handle);
      int tocLength = (toc[0] << 8) | toc[1];
      int descriptorCount = Math.Max(0, (tocLength - 2) / 8);
      int totalTocBytes = Math.Min(toc.Length, tocLength + 2);
      string discId = HashBytes(toc, totalTocBytes);

      int trackOffset = -1;
      for (int i = 0; i < descriptorCount; i++) {
        int offset = 4 + i * 8;
        if (toc[offset + 2] == track) {
          trackOffset = offset;
          break;
        }
      }
      if (trackOffset < 0) throw new InvalidOperationException("Track " + track + " was not found in the audio CD TOC.");

      int nextOffset = -1;
      for (int offset = trackOffset + 8; offset < 4 + descriptorCount * 8; offset += 8) {
        int trackNumber = toc[offset + 2];
        if (trackNumber == 0xAA || trackNumber > track) {
          nextOffset = offset;
          break;
        }
      }
      if (nextOffset < 0) throw new InvalidOperationException("Unable to find the end sector for track " + track + ".");

      int startSector = MsfToLba(toc[trackOffset + 5], toc[trackOffset + 6], toc[trackOffset + 7]);
      int endSector = MsfToLba(toc[nextOffset + 5], toc[nextOffset + 6], toc[nextOffset + 7]);
      int sectorCount = endSector - startSector;
      if (startSector < 0 || sectorCount <= 0) {
        throw new InvalidOperationException("Invalid CDDA sector range for track " + track + ".");
      }

      string safeName = "cd-" + discId + "-track-" + track.ToString("00") + ".wav";
      string outputPath = Path.Combine(outDir, safeName);
      long expectedLength = 44L + (long)sectorCount * RawSectorBytes;
      if (File.Exists(outputPath) && new FileInfo(outputPath).Length == expectedLength) {
        return Result(outputPath, true, track, startSector, sectorCount, discId);
      }

      string tempPath = outputPath + ".tmp";
      if (File.Exists(tempPath)) File.Delete(tempPath);
      using (FileStream output = new FileStream(tempPath, FileMode.Create, FileAccess.Write, FileShare.Read)) {
        WriteWavHeader(output, sectorCount);
        CopyRawAudio(handle, output, startSector, sectorCount);
      }

      if (File.Exists(outputPath)) File.Delete(outputPath);
      File.Move(tempPath, outputPath);
      return Result(outputPath, false, track, startSector, sectorCount, discId);
    }
  }

  static AriaCdRipResult Result(string path, bool cached, int track, int startSector, int sectorCount, string discId) {
    return new AriaCdRipResult {
      path = path,
      cached = cached,
      track = track,
      startSector = startSector,
      sectorCount = sectorCount,
      duration = (double)sectorCount / FramesPerSecond,
      sampleRate = SampleRate,
      bitsPerSample = BitsPerSample,
      channels = Channels,
      bitrate = SampleRate * BitsPerSample * Channels,
      discId = discId
    };
  }

  static string NormalizeDrive(string drive) {
    string text = (drive ?? "").Trim();
    if (text.Length == 2 && text[1] == ':') return text + "\\";
    if (text.EndsWith("\\")) return text;
    return text + "\\";
  }

  static byte[] ReadToc(SafeFileHandle handle) {
    byte[] toc = new byte[804];
    int returned;
    if (!DeviceIoControl(handle, IOCTL_CDROM_READ_TOC, IntPtr.Zero, 0, toc, toc.Length, out returned, IntPtr.Zero)) {
      ThrowLastWin32("Unable to read audio CD TOC");
    }
    return toc;
  }

  static void CopyRawAudio(SafeFileHandle handle, Stream output, int startSector, int totalSectors) {
    const int sectorsPerRead = 16;
    byte[] rawReadInfo = new byte[16];
    byte[] buffer = new byte[RawSectorBytes * sectorsPerRead];

    int remaining = totalSectors;
    int sector = startSector;
    while (remaining > 0) {
      int sectors = Math.Min(sectorsPerRead, remaining);
      Array.Clear(rawReadInfo, 0, rawReadInfo.Length);
      BitConverter.GetBytes((long)sector * CookedSectorBytes).CopyTo(rawReadInfo, 0);
      BitConverter.GetBytes((uint)sectors).CopyTo(rawReadInfo, 8);
      BitConverter.GetBytes((int)CDDA).CopyTo(rawReadInfo, 12);

      int returned;
      int bytesToRead = sectors * RawSectorBytes;
      if (!DeviceIoControl(handle, IOCTL_CDROM_RAW_READ, rawReadInfo, rawReadInfo.Length, buffer, bytesToRead, out returned, IntPtr.Zero)) {
        ThrowLastWin32("Unable to raw-read CDDA sector " + sector);
      }
      if (returned < bytesToRead) {
        throw new EndOfStreamException("Short CDDA read at sector " + sector + ".");
      }

      output.Write(buffer, 0, bytesToRead);
      sector += sectors;
      remaining -= sectors;
    }
  }

  static int MsfToLba(byte minute, byte second, byte frame) {
    return ((minute * 60) + second) * FramesPerSecond + frame - 150;
  }

  static void WriteWavHeader(Stream output, int sectorCount) {
    int dataSize = checked(sectorCount * RawSectorBytes);
    int byteRate = SampleRate * Channels * BitsPerSample / 8;
    short blockAlign = (short)(Channels * BitsPerSample / 8);
    using (BinaryWriter writer = new BinaryWriter(output, System.Text.Encoding.ASCII, true)) {
      writer.Write(System.Text.Encoding.ASCII.GetBytes("RIFF"));
      writer.Write(36 + dataSize);
      writer.Write(System.Text.Encoding.ASCII.GetBytes("WAVE"));
      writer.Write(System.Text.Encoding.ASCII.GetBytes("fmt "));
      writer.Write(16);
      writer.Write((short)1);
      writer.Write(Channels);
      writer.Write(SampleRate);
      writer.Write(byteRate);
      writer.Write(blockAlign);
      writer.Write(BitsPerSample);
      writer.Write(System.Text.Encoding.ASCII.GetBytes("data"));
      writer.Write(dataSize);
    }
  }

  static string HashBytes(byte[] bytes, int length) {
    using (SHA1 sha1 = SHA1.Create()) {
      byte[] hash = sha1.ComputeHash(bytes, 0, length);
      return BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
    }
  }

  static void ThrowLastWin32(string message) {
    int error = Marshal.GetLastWin32Error();
    throw new System.ComponentModel.Win32Exception(error, message + " (Win32 " + error + ")");
  }
}
"@

Add-Type -TypeDefinition $source -Language CSharp
$result = [AriaCdRipper]::Rip($Drive, $Track, $OutDir)
$result | ConvertTo-Json -Compress
`;
  }
}

module.exports = { CdAudioRipper };
