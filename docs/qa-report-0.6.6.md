# Aria 0.6.6 QA 报告

日期：2026-11-10  
环境：Windows 11 / Node 24.15.0 / Electron 43 / x64；macOS 通过 GitHub Actions 双架构构建

## 修复与验证

| 项目 | 修复 | 验证 |
| --- | --- | --- |
| macOS x64 / arm64 安装包 | 不再复用 Windows 的 Electron `node_modules/electron/dist`；macOS 由 electron-builder 按目标架构下载 Electron | CI 矩阵分别使用 `macos-15-intel`（x64）与 `macos-15`（arm64） |
| mpv 架构不匹配 | 两个架构固定使用 `eko5624/mpv-mac` `2026-11-09`（最低 macOS 11），下载校验 SHA256；`beforePack` 按 arch 放置，`afterPack` 校验 Mach-O | x64 / arm64 二进制已用 Mach-O 解析器验证；CI 打包后再次校验 |
| sharp/libvips 跨架构 | 每个架构从 npm 下载 `@img/sharp-darwin-<arch>` 与 `@img/sharp-libvips-darwin-<arch>`，校验 sha512；根 node_modules 不再进包 | Windows 安装包从 164.1 MB 降至 140.6 MB；打包态封面缩略图测试通过 |
| Now Playing 插件 | macOS 构建 x64/arm64 并用 `lipo` 合并 universal；CI 单架构时只构建宿主 slice | `scripts/lib/macho.test.mjs` 覆盖 thin/fat Mach-O 解析 |
| 错误架构静默运行 | `afterPack` 校验 Electron、mpv、libluajit、Now Playing、sharp；运行时 `MpvAudioEngine.isSupported()` 也会读取 mpv slice，不匹配时回落 Web Audio | 架构不匹配会被 `assertMacBinary` 明确抛错 |
| macOS 最低系统 | `minimumSystemVersion` 设为 12.0（Electron 43 限制）；mpv 自身兼容 11+ | `electron-builder.config.cjs` |
| 打包配置 | 迁移到 `electron-builder.config.cjs`，`npmRebuild: false`，显式 `--config` | Windows `dist:beta` 成功；打包态集成测试通过 |

## 自动化

- `npx tsc -b`：通过
- `npm test`：44 个测试文件 / 277 项通过（新增 Mach-O 解析测试）
- Windows 开发态桌面集成测试：通过（11/11）
- Windows 安装包态桌面集成测试：通过（11/11）
- macOS x64 / arm64 DMG：由 `.github/workflows/build-macos.yml` 构建并逐架构校验
- 构建说明：`docs/macos-x64-arm64.md`

## 安装包

### Windows

- 文件：`release/Aria-0.6.6-x64.exe`
- 大小：140,646,615 bytes（约 134.13 MiB）
- SHA256：`E2A8B19C998B8BEB5810193EF273F1C8DC8F9BC32CF739E93D1486393AC835FD`

### macOS

由 GitHub Actions `Build macOS DMG` 生成（运行 `42667601359`，两个 job 均通过）：

- `Aria-0.6.6-x64.dmg`（Intel）
  - 大小：196,273,073 bytes（约 187.18 MiB）
  - SHA256：`EDF6E6BF4ECB90091B68293292E0337CFDFB39D5AD92C7BA1C0141B415202533`
- `Aria-0.6.6-arm64.dmg`（Apple Silicon）
  - 大小：187,463,694 bytes（约 178.78 MiB）
  - SHA256：`FFF38ECFB6E1366DCA8BEA4F17AA8FF8854696FE02AEC3EB9FDED2F3761EC010`
- 默认未签名；首次打开需右键 → 打开，或 `xattr -dr com.apple.quarantine /Applications/Aria.app`

CI 日志中的逐架构校验结果：

```text
verified Electron x64: x64 (macOS 12.0.0)
verified mpv x64: x64 (macOS 11.0.0)
verified mpv libluajit x64: x64 (macOS 11.0.0)
verified Now Playing addon x64: x64 (macOS 10.15.0)
verified sharp x64: x64 (macOS 10.15.0)

verified Electron arm64: arm64 (macOS 12.0.0)
verified mpv arm64: arm64 (macOS 11.0.0)
verified mpv libluajit arm64: arm64 (macOS 11.0.0)
verified Now Playing addon arm64: arm64 (macOS 11.0.0)
verified sharp arm64: arm64 (macOS 11.0.0)
```
