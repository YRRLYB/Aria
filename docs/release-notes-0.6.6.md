## Aria 0.6.6

- macOS 安装包改为按架构分别构建：Intel（x64）与 Apple Silicon（arm64）各一个 DMG。
- 每个 DMG 的 Electron、mpv、Now Playing 插件与 sharp/libvips 都会按目标 CPU 校验，架构不匹配直接终止出包。
- mpv 在 Intel 与 Apple Silicon 上统一使用固定社区构建（最低 macOS 11），下载后校验 SHA256。
- Now Playing 原生插件合并为 universal；运行时也会检测 mpv 架构，混入错误二进制时自动回落到 Web Audio。
- macOS 最低系统版本为 12.0（Electron 43 限制）。
- 新增 GitHub Actions 双架构构建工作流；Windows 安装包与既有功能保持原行为。
- 产物：
  - Windows：`Aria-0.6.6-x64.exe` — SHA256 `E2A8B19C998B8BEB5810193EF273F1C8DC8F9BC32CF739E93D1486393AC835FD`
  - macOS Intel：`Aria-0.6.6-x64.dmg` — SHA256 `EDF6E6BF4ECB90091B68293292E0337CFDFB39D5AD92C7BA1C0141B415202533`
  - macOS Apple Silicon：`Aria-0.6.6-arm64.dmg` — SHA256 `FFF38ECFB6E1366DCA8BEA4F17AA8FF8854696FE02AEC3EB9FDED2F3761EC010`
- macOS 包默认未签名，首次打开请右键 → 打开，或执行 `xattr -dr com.apple.quarantine /Applications/Aria.app`。
