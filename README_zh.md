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

- 查看近期 Codex CLI token 使用量。
- 按模型、日期和项目估算 Codex 使用成本。
- 查看缓存命中率、每百万 token 成本和每日用量趋势。
- 只读取本机 `~/.codex` session 日志，保持本地优先。
- 将当前 Dashboard 时间窗口导出为 Excel 或 Markdown。

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

## 隐私和数据

- 扫描和重置操作只读取本地 Codex 日志，不会删除原始日志。
- Usage 汇总会保存在应用数据目录中的本地 SQLite 缓存里。
- Pricing 数据会缓存在本地。缓存不存在时，应用会尝试从 LiteLLM 拉取 Codex 模型价格；如果拉取失败，则使用内置 pricing 表。
- 成本是基于应用当前可用 pricing 数据计算的估算值。

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
