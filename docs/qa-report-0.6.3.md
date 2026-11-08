# Aria 0.6.3 QA 报告

日期：2026-11-08  
环境：Windows 11 / Node 24.15.0 / Electron 43 / x64

## 修复

QQ 音乐红心/取消红心返回 `2001`。

根因：`musics.fcg` 的 `ag-1` 请求体必须是 **base64 文本**；此前发送的是原始加密字节，上游在网络层直接返回 2001，尚未进入业务错误码。

同时修正 2001 节点重试域名：
`u6.y.qq.com` → `shu6.y.qq.com` → `szu6.y.qq.com`。

## 真实账号验证

使用真实 QQ 登录 Cookie 验证：

| 操作 | 结果 |
| --- | --- |
| 添加红心 `003aAPj81VWrbL` | 200，`{ ok: true, liked: true }` |
| 读取「我喜欢」 | 1 首，歌曲出现在列表 |
| 取消红心 | 200，`{ ok: true, liked: false }` |
| 再次读取「我喜欢」 | 0 首，已还原 |

测试后账号收藏状态已恢复。

## 自动化测试

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npx tsc -b` | 通过 |
| 单元测试 | `npm test` | 43 个文件 / 273 项通过 |
| 后端构建 | `npm run build:server` | 通过 |
| 前端构建 | `npm run build:web` | 通过 |
| 桌面集成（安装包态） | `node scripts/test-desktop.cjs --resources release/win-unpacked/resources` | 通过 |

新增测试覆盖：
- ag-1 请求体 base64 往返
- 2001 时 `u6 → shu6` 节点重试
- 写接口请求体必须是 base64 文本

## 安装包

- 文件：`release/Aria-0.6.3-x64.exe`
- 大小：164,148,774 bytes（约 156.54 MiB）
- SHA256：`C958634553F4BA126662924253155C5F1D8234225003EBC327C66C4B59386000`
