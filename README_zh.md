# Codex Usage Desktop

> **看清 Codex Token 用在哪里、额度还剩多少、何时重置——一个本地桌面应用就够了。**

**[下载 Windows x64 版](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-windows-x64-setup.exe)** · **[Apple 芯片版](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-macos-arm64.dmg)** · **[Intel Mac 版](https://github.com/itvincent-git/codex-usage-desktop/releases/latest/download/codex-usage-desktop-macos-x64.dmg)** · [English README](README.md) · [日本語](README_ja.md)

⭐ 如果 Codex Usage Desktop 对你有帮助，欢迎[为项目点亮 **Star**](https://github.com/itvincent-git/codex-usage-desktop)。

## 不用再猜，Codex 额度去哪了

如果你每天都在使用 Codex，你可能也想知道：

- **我的 5 小时或周额度还剩多少？**
- **额度什么时候重置？**
- **哪个项目或会话消耗了最多 Token？**
- **今天的用量和昨天相比怎么样？**
- **哪些模型消耗的 Token 最多、预估成本最高？**
- **一段很长的 Codex 会话里，到底发生了什么？**

Codex Usage Desktop 将电脑上已有的 Codex 会话数据整理成清晰的原生看板，帮你回答这些问题。

**无需 API Key，无需额外注册账号，不上传会话日志。安装并打开即可。**

![Codex Usage Desktop 用量看板](docs/dashboard.jpg)

## 你可以做什么

### 📊 一眼看清 Codex 用量

不用翻阅 JSONL 日志，就能了解自己的使用情况。

查看：

- Token 总量与预估成本
- 输入、输出和缓存 Token 用量
- 缓存命中率
- 每日和每月趋势
- 日均用量
- 自定义日期范围

快速判断用量是否在增长，以及 Token 都花在了哪里。

### ⏱ 在触及上限前，掌握剩余额度

工作时随时关注当前 Codex 额度。

监控：

- 实时 **5 小时额度**
- **周度或月度额度**
- 剩余额度
- 重置时间与倒计时
- 可用重置次数
- 可用时的额度重置预测

你还可以将额度信息直接显示在 **macOS 菜单栏或 Windows 系统托盘**，自定义显示文案和倒计时单位，不必一直打开看板。

实时额度使用本机已有的 Codex 登录状态。

![macOS 菜单栏中的 Codex 额度与重置倒计时](docs/menubar.jpg)

### 🔍 找出 Token 消耗来源

按以下维度拆分用量：

- 项目
- 模型
- 日期
- 月份
- 会话

看清**具体是哪个项目、模型或会话消耗了 Token**，了解用量背后的原因。

![展示 Token 构成与预估成本的项目用量详情](docs/project-usage-detail.jpg)

### 💬 看懂每一段 Codex 会话

从汇总图表深入到具体会话，了解数字背后的活动。

按标题、项目和模型搜索会话，打开即可查看详情。

![展示 Token 用量、预估成本与额度消耗的会话列表](docs/session-detail-list.jpg)

根据本地日志实际记录的内容，会话视图可以展示：

- Token 用量与预估成本
- 对 5 小时和周额度的估算消耗
- 剩余额度变化
- 命令与工具活动
- 网页搜索及结果
- 补丁与代码差异
- 长时间运行的命令
- 子代理层级
- 会话回放时间线

既能看懂 **Codex 做了什么**，也能了解**这些工作消耗了多少用量**。

![包含命令、工具活动与原始 JSONL 链接的会话详情时间线](docs/session-detail.jpg)

### 🔄 了解额度重置情况

Codex 的额度规则与重置情况可能随时间变化。Codex Usage Desktop 帮你看清这些变化。

查看：

- 最近一次官方 Token 重置公告
- 近期重置事件
- 最近 30 天的重置公告记录
- 会话日志中观测到的每日剩余额度变化
- 可用时的重置次数详情与到期时间

### 💻 适合日常常驻使用

Codex Usage Desktop 随时可用，尽量减少打扰：

- 原生 macOS 与 Windows 应用
- macOS 菜单栏 / Windows 系统托盘
- 开机启动
- 自动检查更新
- English、简体中文和日本語
- Windows WSL Codex 会话检测
- 浅色与深色主题

### 📤 导出你的用量数据

需要在其他工具里分析或分享用量？

将当前看板选定的时间范围导出为：

- **Excel（`.xlsx`）**
- **Markdown（`.md`）**

## 默认保护隐私

Codex 会话可能包含敏感的提示词、代码、命令和项目信息。

Codex Usage Desktop 将这些数据留在你的电脑上。

- 会话日志**只在本地读取**
- 应用**绝不上传会话日志**
- 无需 OpenAI 或 LiteLLM API Key
- 无需注册 Codex Usage Desktop 账号
- 聚合统计存储在本地 SQLite 数据库
- 项目**免费开源**

你的 Codex 数据始终属于你。实时额度及其他网络请求的详情见[隐私与网络访问](#隐私与网络访问)。

## 零配置上手

已经在使用 Codex CLI？那就可以开始探索用量了。

1. 安装 Codex Usage Desktop。
2. 打开应用。
3. 已有的 Codex 会话会被自动检测并建立索引。
4. 开始查看 Token、额度、项目、模型和会话。

不用部署分析服务器，不用配置数据库，也不用粘贴 API Key。

**安装即用。**

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
