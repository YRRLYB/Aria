# Aria macOS：Intel（x64）与 Apple Silicon（arm64）适配

日期：2026-11-10  
适用版本：0.6.6 及以上

Aria 的 macOS 包现在是**按架构分别构建**的：`Aria-<version>-x64.dmg` 给 Intel Mac，`Aria-<version>-arm64.dmg` 给 Apple Silicon。两条链路里的每一个原生组件都会按目标 CPU 校验，不再出现“在 M 系列 Mac 上装到 Intel mpv”或“在 Intel Mac 上装到 arm64 sharp”的问题。

## 1. 每个架构现在包含什么

| 组件 | x64 | arm64 | 说明 |
| --- | --- | --- | --- |
| Electron | x64 | arm64 | macOS 构建不再复用 Windows 的 `node_modules/electron/dist`，由 electron-builder 按目标架构下载 |
| mpv 解码器 | 固定 x86_64 构建 | 固定 arm64 构建 | 使用同一发布日期的社区构建，二者最低都支持 macOS 11 |
| libluajit | x64 | arm64 | 随 mpv 一起打包，`@executable_path/lib` 解析 |
| Now Playing 插件 | universal | universal | x64 + arm64 用 `lipo` 合并，两个 DMG 共用 |
| sharp / libvips | darwin-x64 | darwin-arm64 | 按目标架构从 npm 下载并校验 SHA-512，运行时从 `dist-server/node_modules` 加载 |
| 最终校验 | `afterPack` | `afterPack` | Electron Framework、mpv、libluajit、Now Playing、sharp 全部检查 Mach-O slice，不匹配直接让构建失败 |

### mpv 版本

- 固定发布：`eko5624/mpv-mac` `2026-11-09`
- x64：`mpv-x86_64-git-d9d402dc07.zip`，SHA256 `d17d4665...b691cc`
- arm64：`mpv-arm64-git-d9d402dc07.zip`，SHA256 `bbb4c621...fe353a`
- 两个二进制的最低系统版本都是 macOS 11.0；Aria 本身受 Electron 43 限制要求 macOS 12+。

之所以不用 mpv 官方 release：官方目前只提供 macOS 14 arm、macOS 15 intel/arm 等分档，无法用同一个版本同时覆盖 Intel 和 Apple Silicon 的低版本系统。社区构建在同一天为两个架构发布、且都面向 macOS 11，因此更适合作为统一解码器。

### sharp / libvips

sharp 通过 `@img/sharp-darwin-<arch>` 和 `@img/sharp-libvips-darwin-<arch>` 两个可选 npm 包提供预编译二进制。`scripts/before-pack.cjs` 会在每个架构打包前：

1. 从 npm registry 读取与 `sharp@0.34.5` 匹配的版本；
2. 下载 tarball 并校验 `sha512` integrity；
3. 解压到 `dist-server/node_modules/@img/`；
4. 删除其他架构的 sharp/libvips 包；
5. 校验 `.node` 和所有 `.dylib` 的 Mach-O slice。

根目录 `node_modules` 不会进入安装包（`files` 已排除），所以宿主机的 sharp 不会污染另一架构的 DMG。

## 2. 在 macOS 上构建

要求：

- macOS 12 或更高（构建机建议 macOS 15）
- Node.js 24
- Xcode Command Line Tools：`xcode-select --install`
- 网络可访问 GitHub Releases 与 npm registry

```bash
npm ci

# 只构建当前 Mac 对应的架构（推荐，速度最快）
npm run dist:mac:x64      # Intel Mac
npm run dist:mac:arm64    # Apple Silicon Mac

# 在同一台 Mac 上构建两个 DMG（按顺序打包，默认并发为 1）
npm run dist:mac
```

产物：

- `release/Aria-<version>-x64.dmg`
- `release/Aria-<version>-arm64.dmg`

`npm run dist:mac` 会调用 `electron-builder --mac --x64 --arm64`。如果宿主机的 Xcode 能交叉编译另一架构的 Now Playing 插件，会直接得到 universal 插件；如果交叉编译失败，宿主架构的包仍然可用，但另一架构会在 `afterPack` 阶段明确报错，不会悄悄产出坏包。

### 构建流程中的保护

- `scripts/before-pack.cjs`：按 electron-builder 当前 `arch` 准备 mpv 与 sharp，并确保 Now Playing 插件包含目标 slice。
- `scripts/after-pack.cjs`：检查最终 `.app` 内的 Electron、mpv、libluajit、Now Playing、sharp 是否为目标架构；任何一个不匹配都会终止打包。
- `electron/macBinary.cjs`：运行时也会读取 mpv 的 Mach-O slice；如果安装包里的 mpv 与当前 Electron CPU 不一致，自动回落到 Web Audio，而不是让用户点播放后没有反应。

## 3. GitHub Actions

仓库提供 `.github/workflows/build-macos.yml`：

- `macos-15-intel` → x64 DMG
- `macos-15`（Apple Silicon）→ arm64 DMG
- 支持手动 `workflow_dispatch`，也会在推送 `v*` tag 时运行
- 两个 DMG 分别作为 Actions artifact 上传（保留 14 天）

这样不需要本地 Mac 也能得到两个架构的安装包。工作流默认不签名；未签名包首次打开需要右键 → 打开，或执行：

```bash
xattr -dr com.apple.quarantine /Applications/Aria.app
```

## 4. 签名与公证（可选）

正式分发建议配置 Apple Developer 证书。electron-builder 会自动读取以下环境变量：

```bash
export CSC_LINK="/path/to/developer-id.p12"   # 或 base64
export CSC_KEY_PASSWORD="..."
export APPLE_ID="..."
export APPLE_APP_SPECIFIC_PASSWORD="..."
export APPLE_TEAM_ID="..."
```

当 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 同时存在时，`electron-builder.config.cjs` 会自动开启 notarization。CI 工作流默认设置了 `CSC_IDENTITY_AUTO_DISCOVERY=false`；配置证书后请删掉该行，并把上述变量接到 workflow secrets。

## 5. 手工验证

```bash
# mpv / Now Playing / sharp 的架构
lipo -archs "/Applications/Aria.app/Contents/Resources/app.asar.unpacked/vendor/mpv/mpv"
lipo -archs "/Applications/Aria.app/Contents/Resources/app.asar.unpacked/electron/native/aria-nowplaying/aria_nowplaying.node"
lipo -archs "/Applications/Aria.app/Contents/Resources/app.asar.unpacked/dist-server/node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node"

# 最低系统版本
vtool -show-build "/Applications/Aria.app/Contents/Resources/app.asar.unpacked/vendor/mpv/mpv"

# 实际解码
"/Applications/Aria.app/Contents/Resources/app.asar.unpacked/vendor/mpv/mpv" --no-video --ao=null --length=3 "http://127.0.0.1:3636/api/providers/netease/tracks/409872504/stream?level=lossless"
```

## 6. 常见问题

**构建报 “architecture mismatch”**  
说明缓存里残留了另一架构的 mpv 或插件。删除以下目录后重试：

```bash
rm -rf .cache/mpv-macos .cache/mac-native vendor/mpv
npm run dist:mac:<arch>
```

**没有 Xcode，构建卡在 Now Playing**  
临时允许跳过原生媒体键插件：

```bash
ARIA_ALLOW_MISSING_MAC_NATIVE=1 npm run dist:mac:arm64
```

这样会回落到 Chromium 媒体会话，播放本身不受影响。

**DMG 能打开但提示“已损坏”**  
这是未签名包被 Gatekeeper 拦截，不是文件损坏。右键打开，或执行上面的 `xattr` 命令。正式分发请配置签名与公证。
