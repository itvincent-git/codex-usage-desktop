# Codex Usage Desktop

[![Release](https://img.shields.io/github/v/release/itvincent-git/codex-usage-desktop?label=release)](https://github.com/itvincent-git/codex-usage-desktop/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](https://github.com/itvincent-git/codex-usage-desktop/releases/latest)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri-24c8db.svg)](https://tauri.app/)
[![Local first](https://img.shields.io/badge/local--first-privacy-green.svg)](#隐私和数据)

一个本地优先的 macOS Codex CLI 用量统计桌面看板，用来从本机 `~/.codex` 日志查看 token 使用量、成本预估、模型用量和项目用量。

[下载最新版本](https://github.com/itvincent-git/codex-usage-desktop/releases/latest) · [English README](README.md)

如果你在本机使用 Codex CLI，并希望不用上传本地日志就能查看近期 token、成本趋势、缓存命中率、模型用量和项目用量，可以使用 Codex Usage Desktop。

## 为什么使用

Codex 的使用量增长极快，但监控它不应以牺牲你的隐私或凭证安全为代价。

不同于传统的需要云端登录和上传 API 密钥的分析平台，**Codex Usage Desktop** 秉承完全的“本地优先（Local-First）”哲学。

### 📊 本地优先 vs. 传统云端 SaaS 分析

| 特性 | Codex Usage Desktop (本地优先) | 传统云端 SaaS 工具 |
| :--- | :--- | :--- |
| **数据隐私** | 🟢 **100% 本地**。您的日志绝不离开您的设备。 | 🔴 需将原始日志上传至第三方云端服务器。 |
| **凭证安全** | 🟢 **零 API 密钥需求**。不存储任何 API 密钥。 | 🔴 必须上传主 API 密钥/Token 才能运行。 |
| **成本费用** | 🟢 **完全免费且开源**。无任何订阅费用。 | 🔴 按席位或数据量收费的订阅制。 |
| **性能体验** | 🟢 **极速 SQLite 本地索引**。毫秒级读取本机日志。 | 🔴 受限于网络延迟、上传带宽和 API 限制。 |

---

## 功能亮点

- 本地扫描 Codex CLI session 日志。
- 支持从 1 天到 90 天的 Dashboard 时间窗口。
- 提供 Monthly 视图，查看更长期的自然月汇总。
- 展示 token、缓存、成本、模型和项目维度的拆分。
- 可导出 Excel (`.xlsx`) 和 Markdown (`.md`)。
- 支持清空本地 SQLite 缓存，并从 Codex 日志重新构建 usage 数据。

## 下载和安装

从 [GitHub Releases](https://github.com/itvincent-git/codex-usage-desktop/releases/latest) 下载最新 macOS 版本。

当前 release 构建：

- macOS Apple Silicon
- macOS Intel

Windows 和 Linux 构建在计划中；当前 release workflow 只发布 macOS 桌面安装包。

## 工作方式

1. 打开桌面应用。
2. 首次启动时，应用会从 `~/.codex` 读取本地 Codex session 日志，并建立本地 usage 缓存。
3. 在 Dashboard 视图查看总 tokens、预估成本、日均、缓存命中率、每百万 token 成本、每日趋势、模型用量和项目用量。
4. 在 Dashboard 中切换 1d / 2d / 7d / 14d / 30d / 60d / 90d 时间窗口。
5. 打开 Monthly 视图查看自然月汇总。
6. 新的 Codex session 产生后，点击 `Rescan local logs` 刷新看板。
7. 点击 `Export`，将当前 Dashboard 时间窗口导出为 Excel (`.xlsx`) 或 Markdown (`.md`)。
8. 如果本地缓存需要重建，在 Settings 中点击 `Reset cache`，应用会清空缓存并从 Codex 日志重新构建。

## 隐私与安全

> [!IMPORTANT]
> **零云端遥测与凭证安全保障声明**
> * **不存储 API 密钥**：本应用**不需要也不存储**您的 OpenAI/LiteLLM API 密钥。它完全基于本地日志中已记录的 token 计数进行分析。
> * **日志保留在本地**：本应用以只读方式读取本机 `~/.codex` 中的原始会话文件，绝对不会上传、分享或修改它们。
> * **本地 SQLite 缓存**：计算汇总后的数据保存在您本地系统应用数据目录下的 SQLite 缓存中。
> * **极简网络交互**：价格数据缓存在本地。如果本地不存在价格缓存，应用会通过 HTTPS 从 LiteLLM 获取公开的定价列表，绝不发送任何用户凭证或使用指标。

## 高级选项

- `CODEX_HOME`: Codex home 目录，默认 `~/.codex`
- `CODEX_USAGE_TIMEZONE`: 日期分桶使用的时区，默认系统时区，失败时回退 UTC

## 当前边界

- 当前展示的是按天和按月聚合后的 usage，不是会话级明细。
- 未知模型按零成本处理。
- 当前 release 安装包只支持 macOS。

## 路线图

- Windows 和 Linux 安装包。
- 更细粒度的用量明细。
- 更多导出和报告能力。

## 开发者说明

应用使用 React 19、Vite、Tauri v2 和 Rust 原生 usage pipeline 构建。

本地开发需要 Node.js `>= 24`、`pnpm`、Rust 和 Tauri v2 系统依赖，然后运行：

```bash
pnpm install
pnpm dev:app
```

常用检查命令：

```bash
pnpm test
pnpm typecheck
cd src-tauri && cargo test
```

打包命令：

```bash
pnpm build
pnpm tauri build
```
