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

| 特性       | Codex Usage Desktop (本地优先)       | 传统云端 SaaS 工具                |
|:-------- |:-------------------------------- |:--------------------------- |
| **数据隐私** | 🟢 **100% 本地**。您的日志绝不离开您的设备。     | 🔴 需将原始日志上传至第三方云端服务器。       |
| **凭证安全** | 🟢 **零 API 密钥需求**。不存储任何 API 密钥。  | 🔴 必须上传主 API 密钥/Token 才能运行。 |
| **成本费用** | 🟢 **完全免费且开源**。无任何订阅费用。          | 🔴 按席位或数据量收费的订阅制。           |
| **性能体验** | 🟢 **极速 SQLite 本地索引**。毫秒级读取本机日志。 | 🔴 受限于网络延迟、上传带宽和 API 限制。    |

---

## 功能亮点

* 🔍 **本地日志扫描器 (Local-First Scanner)**：实时、零配置地解析本机 `~/.codex/sessions` 目录下的 Codex CLI 会话日志，完全基于本地运行。
* 📊 **多维交互仪表盘 (Interactive Dashboard)**：
  * **多时间窗口切换**：支持 1d、7d、14d、30d、60d、90d 等时间跨度切换。
  * **直观趋势图表**：使用动态 Recharts 展示输入/输出 token、缓存命中量以及每日费用趋势。
* 💼 **细粒度多维度拆分**：
  * **项目用量分析**：精准统计各个本地项目目录（CWD）所消耗的 Token 和预算。
  * **模型用量与成本**：按模型细化分类（如 `gpt-5.5`, `gpt-5.4` 等），费用分布一目了然。
* 🗓️ **自然月长期概览 (Monthly View)**：以自然月为单位聚合用量和成本，方便进行中长期的用量规划与预算复盘。
* 💾 **多样化数据导出**：支持一键将当前时间窗口下的看板用量数据导出为 Excel (`.xlsx`) 或 Markdown (`.md`) 报告。
* ⚙️ **便捷缓存管理**：可在设置中一键重建或清空本地 SQLite 用量数据库，随时从原始日志重新同步数据。

## 下载和安装

### 一键安装脚本

```bash
curl -fsSL https://raw.githubusercontent.com/itvincent-git/codex-usage-desktop/main/scripts/install.sh | sh
```

脚本会按当前 Mac 架构下载最新 DMG，并将 `Codex Usage Desktop.app` 安装到 `/Applications`。脚本不会绕过 macOS Gatekeeper。如果首次启动被系统拦截，请在“系统设置 > 隐私与安全性”中允许打开。

### 手动下载

也可以从 [GitHub Releases](https://github.com/itvincent-git/codex-usage-desktop/releases/latest) 下载最新 macOS 版本。

当前 release 构建：

- macOS Apple Silicon
- macOS Intel

Windows 和 Linux 构建在计划中；当前 release workflow 只发布 macOS 桌面安装包。

## 隐私与安全

> [!IMPORTANT]
> **零云端遥测与凭证安全保障声明**
> 
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
pnpm tauri dev
```

常用检查命令：

```bash
pnpm test
pnpm typecheck
cd src-tauri && cargo test
```

打包命令：

```bash
pnpm tauri build
```
