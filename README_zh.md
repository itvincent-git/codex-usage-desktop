# Codex Usage Desktop

> 看清 Codex 的 Token、额度和费用去向，不需要把会话日志发送到任何地方。

[![Release](https://img.shields.io/github/v/release/itvincent-git/codex-usage-desktop?label=release)](https://github.com/itvincent-git/codex-usage-desktop/releases/latest)
[![平台：macOS 与 Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)](#安装)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Local first](https://img.shields.io/badge/local--first-privacy-green.svg)](#隐私与网络访问)

**[下载 Windows x64 版](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-windows-x64-setup.exe)** · **[Apple 芯片版](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-macos-arm64.dmg)** · **[Intel Mac 版](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-macos-x64.dmg)** · [English README](README.md) · [日本語](README_ja.md)

> [!IMPORTANT]
> ⭐ 如果你喜欢 Codex Usage Desktop，欢迎[在 GitHub 上为仓库点亮 Star](https://github.com/itvincent-git/codex-usage-desktop)，支持项目持续发展。

![Codex Usage Desktop 仪表盘，展示 Token 成本、趋势与账户额度](docs/screen_shot.jpg)

Codex Usage Desktop 将电脑上已有的 Codex CLI 日志整理成清晰的使用看板。你可以查看 Token 和成本趋势，找出消耗最多的项目与模型，深入检查单个会话，并随时关注账户实时额度——全部在一个原生桌面应用中完成。

- **默认本地运行：** 会话日志只在本机读取，应用不会上传日志。
- **无需配置 API Key：** 安装并打开，即可扫描已有的 Codex 数据。
- **免费开源：** 无需为本应用注册账号、购买订阅或接入托管分析服务。

## 你可以看到什么

|            | 能力                                               |
| ---------- | ------------------------------------------------ |
| **快速掌握用量** | 查看 Token 总量、预估成本、缓存命中率、日均数据，以及预设或自定义时间范围内的趋势。    |
| **找到成本来源** | 按项目、模型、日期、月份和单个 Codex 会话拆分用量。                    |
| **提前关注额度** | 查看实时 5 小时、周度或月度额度、重置时间、可用重置次数，以及可用时的额度重置预测。      |
| **深入会话活动** | 搜索会话标题、项目和模型，并打开会话查看具体用量与活动明细。                   |
| **常驻且省心**  | 可选菜单栏或系统托盘指标、开机启动、中英文界面和应用内更新。                  |
| **随时导出数据** | 将当前看板时间范围导出为 Excel (`.xlsx`) 或 Markdown (`.md`)。 |

## 安装

### Windows 10/11 x64

[下载最新版 Windows 安装程序](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-windows-x64-setup.exe)，打开后按提示安装。NSIS 安装器采用当前用户安装模式，不需要进行全系统安装。

> [!WARNING]
> Windows 安装器目前没有 Authenticode 签名，因此 Microsoft Defender SmartScreen 可能提示“无法识别的应用”。继续前请确认文件来自本仓库的 GitHub Release。

应用会优先使用 `%USERPROFILE%\.codex` 中的原生 Windows 会话。如果其中没有 JSONL 会话，则自动检查默认 WSL 发行版，并使用其 `$HOME/.codex` 数据和 Codex CLI。原生与 WSL 会话不会合并，以免重复统计。

### macOS

根据你的 Mac 选择对应版本：

| Mac                         | 下载                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Apple 芯片（M1、M2、M3、M4 及更新型号） | [下载最新版 ARM64 DMG](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-macos-arm64.dmg) |
| Intel                       | [下载最新版 x64 DMG](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-macos-x64.dmg)     |

打开 DMG，并将 **Codex Usage Desktop** 移入“应用程序”目录。你也可以查看[最新版本与更新说明](https://github.com/itvincent-git/codex-usage-desktop/releases/latest)。

> [!NOTE]
> 应用不会绕过 macOS Gatekeeper。如果首次启动被系统拦截，请打开 **系统设置 → 隐私与安全性** 并允许打开。

### 通过终端安装

安装脚本会自动识别 Apple 芯片或 Intel，下载对应 DMG，并将应用复制到 `/Applications`：

```bash
curl -fsSL https://raw.githubusercontent.com/itvincent-git/codex-usage-desktop/main/scripts/install.sh | sh
```

脚本不会关闭或绕过 Gatekeeper。

## 快速开始

1. 正常使用 Codex CLI，确保 `~/.codex`（Windows 上为 `%USERPROFILE%\.codex`）下已有会话日志。
2. 打开 Codex Usage Desktop，应用会扫描本地日志并建立本地 SQLite 索引。
3. 选择时间范围，或打开模型、项目、按日、按月、会话页面探索用量。

查看实时账户额度需要本机 Codex CLI 已完成登录。如有需要，请先运行 `codex auth login`，然后刷新看板。

## 隐私与网络访问

Codex 会话内容可能包含敏感信息，因此应用被设计为将日志留在你的设备上：

- `~/.codex` 下的源文件只在本地读取，应用不会上传、分享或修改它们。
- 无需在应用中输入或保存 OpenAI、LiteLLM API Key。
- 聚合后的用量数据存储在操作系统应用数据目录中的 SQLite 缓存里。
- 实时额度会使用本机已有的 Codex 登录状态直接向 ChatGPT 查询，应用不会随请求发送会话日志。
- 网络还用于加载公共字体、模型定价、额度预测和更新检查；定价会缓存在本地，这些请求不包含会话日志或用量分析数据。

## 兼容性与当前边界

- 当前安装包支持 Apple 芯片和 Intel Mac，以及 Windows 10/11 x64；暂不提供 Linux 安装包。
- Windows 原生会话为空时只检查默认 WSL 发行版，不会合并多个发行版。
- 用量与成本根据本地 Codex 日志计算；成本数据是基于可用模型定价的估算值。
- 未知模型的预估成本默认为零。
- 会话明细取决于每份本地 Codex 日志中实际包含的信息。

## 高级选项

- `CODEX_HOME`：Codex home 目录；非空值具有最高优先级，并关闭 Windows/WSL 自动发现
- `CODEX_CLI_PATH`：显式指定 Codex CLI 可执行文件或包装器路径（按平台使用 `codex`、`codex.exe` 或 `codex.cmd`）
- `CODEX_USAGE_TIMEZONE`：按日统计使用的时区，默认系统时区，失败时回退 UTC

## 开发者说明

Codex Usage Desktop 使用 React 19、Vite、Tauri v2 和 Rust 原生 usage pipeline 构建。

安装 Node.js `>= 24`、`pnpm`、Rust 和 Tauri v2 系统依赖，然后通过真实桌面应用启动：

```bash
pnpm install
pnpm tauri dev
```

运行检查：

```bash
pnpm test
pnpm typecheck
cd src-tauri && cargo test
```

使用 `pnpm tauri build` 构建安装包。
