# Codex Usage Desktop - 诊断日志调试与生产环境 "Waiting for logs..." 问题修复总结

本文档记录了关于 `Codex Usage Desktop` 诊断日志系统的调试方法，以及如何修复在打包为 DMG/App 运行后，日志页面（Diagnostics Log）一直显示 "Waiting for logs..." 的疑难问题。

---

## 1. 生产环境/打包后 App 的日志调试指南

在 Tauri 应用打包为 Release 生产版本后，默认的开发者工具（右键检查元素）会被禁用。如果想查看真实 App 的运行状态或排查报错，可以使用以下三种方法：

### 方法 1：直接在终端运行已打包的 `.app`（推荐 🌟）
打包生成的真实 Release 版 App 就在项目目录下，你可以直接在终端里启动它。这样 App 后端的所有 Rust 输出、报错信息和插件日志都会实时打印在你的终端窗口中：
```bash
# 在终端中直接启动打包好的真实 Release App
./src-tauri/target/release/bundle/macos/Codex\ Usage\ Desktop.app/Contents/MacOS/Codex\ Usage\ Desktop
```
*(如果重新打包了，这个命令运行的就是最新的真实 Release 版本，若运行有任何报错或 Rust panic 都会直接呈现在当前终端中。)*

### 方法 2：实时监听 macOS 系统本地持久化日志（推荐 🌟）
Tauri 日志插件会自动将日志写入 macOS 系统的标准日志路径下：
`~/Library/Logs/com.ccusage.codex.desktop/Codex Usage Desktop.log`

你可以直接在终端里运行以下命令，**实时滚动监听**真实 App 的后台日志输出（哪怕你是双击运行 DMG 安装后的 App）：
```bash
# 实时滚动监听真实 App 的后台日志输出
tail -f ~/Library/Logs/com.ccusage.codex.desktop/Codex\ Usage\ Desktop.log
```
或者，你也可以直接在 Finder 中打开该日志文件夹进行离线排查：
```bash
open ~/Library/Logs/com.ccusage.codex.desktop/
```

### 方法 3：唤醒前端开发者工具（DevTools）
我们已经修改了配置开启了 Release 版本的 DevTools 支持。你现在可以直接在打包运行后的 App 任意空白处**点击右键**，选择 **"Inspect Element"（检查元素）**，或直接按下快捷键 **`Cmd + Option + I`**，即可召唤出浏览器开发者控制台（Console），查看前端的报错和日志输出。

---

## 2. 生产环境 "Waiting for logs..." 空日志问题诊断

### 2.1 现象描述
在 `pnpm tauri dev`（开发模式）下，点击 "Logs" 选项卡可以正常看到各种后台日志输出；但是一旦打包为生产环境 DMG 运行后，切换到 Logs 页面却永久显示 **"Waiting for logs..."**（等待日志），且无任何日志流进入。

### 2.2 根本原因剖析

#### 原因 1：Tauri v2 能力（Capabilities）限制
Tauri v2 引入了严格的安全性沙盒（Capabilities）。前端要想调用日志插件的 IPC，必须在 `src-tauri/capabilities/default.json` 里的 `permissions` 中显式授权。如果缺失了对 `"log:default"` 的配置，生产环境打包后前端与日志插件的 IPC 通信就会被安全沙盒彻底阻断。

#### 原因 2：Tauri 日志插件前后端协议不兼容（Protocol Mismatch）
*   **前端**使用稳定版：`"@tauri-apps/plugin-log": "^2.8.0"`
*   **后端**使用旧版本：`tauri-plugin-log = "2.0.0-rc"`（Release Candidate 候选版）
*   Tauri v2 从 RC 版到正式版经历了多次底层 IPC 指令命名的重构。这导致打包后，前端 `attachLogger` 发起的订阅请求与后端 Rust Crate 内部的事件名无法匹配，协议断层导致前端无法获得任何日志。

#### 原因 3：React 组件生命周期与日志捕获时机冲突
*   在旧代码中，`<LogPanel />` 采用了条件渲染：
    `{!isLoading && view === "logs" ? <LogPanel /> : null}`
*   这导致应用在刚启动（`isLoading` 为 true）时，`<LogPanel />` 并没有被挂载，因此底层的 `attachLogger` 从未被调用。
*   应用启动阶段（初始化、扫描、加载配置）正是日志输出最密集的黄金时间。等这波启动完毕后，应用在生产环境会进入“静默状态”（无新的后台操作）。
*   等到用户手动点击切换到 "Logs" 选项卡时，`<LogPanel />` 刚刚挂载并调用 `attachLogger`，但在它挂载后，后端没有产生任何新的日志。由于 `tauri-plugin-log` 无法重播历史日志，所以日志面板永远是一片空白。
*   *(注：在 Dev 模式下，由于 Vite 频繁的热更新 HMR 请求、WebSocket 连接以及 React 的严格模式重复渲染，会不断产生后续的活动日志，从而掩盖了这一生命周期设计缺陷)*

---

## 3. 最终解决方案与修改明细

### 3.1 补充 Capabilities 授权与启用 DevTools
*   **修改文件**：[`default.json`](file:///Users/vincent/Documents/Develop/github/codex-usage-desktop/src-tauri/capabilities/default.json)
    在 `permissions` 数组中补充了 `"log:default"`，打通了前端与日志插件的安全通信。
*   **修改文件**：[`Cargo.toml`](file:///Users/vincent/Documents/Develop/github/codex-usage-desktop/src-tauri/Cargo.toml)
    *   将 `tauri-plugin-log` 依赖版本升级至正式稳定版 `"2.0.0"`，对齐前后端 IPC 协议；
    *   在 `tauri` 的 `features` 中，启用了 `"devtools"` 特性，为生产包提供调试支持。

### 3.2 优化 `<LogPanel />` 挂载策略（启动即捕获）
*   **修改文件**：[`App.tsx`](file:///Users/vincent/Documents/Develop/github/codex-usage-desktop/src/App.tsx)
    去除了对 `<LogPanel />` 的条件销毁渲染，改为了基于样式的显隐控制（Tailwind CSS `block` / `hidden`）：
    ```typescript
    <div className={!isLoading && view === "logs" ? "block" : "hidden"}>
      <LogPanel />
    </div>
    ```
    使得该组件在应用生命周期开始的第一毫秒就立刻挂载，完美捕获并在后台积攒起整个启动阶段的所有黄金日志，并在用户切入 Logs 页时瞬间无缝展示。

### 3.3 补全单元测试 Mock（消除测试副作用）
*   **修改文件**：[`App.test.tsx`](file:///Users/vincent/Documents/Develop/github/codex-usage-desktop/src/App.test.tsx)
    由于 `<LogPanel />` 变成了应用启动时默认挂载，但在 Vitest / JSDOM 测试环境下并不存在 Tauri 的运行容器，这会导致 `attachLogger` 在初始化时由于找不到 Tauri 内部变量抛出 transform 异常。
    我们在测试代码头部加塞了对 `@tauri-apps/plugin-log` 的完美 Mock，彻底消除了这个测试副作用：
    ```typescript
    vi.mock("@tauri-apps/plugin-log", () => ({
      attachLogger: vi.fn(() => Promise.resolve(() => {})),
      LogLevel: {
        Trace: 0,
        Debug: 1,
        Info: 2,
        Warn: 3,
        Error: 4,
      },
    }));
    ```
    此举确保了本地 11 项单元测试 **100% 成功通过（Green State）**。
