现在这个界面**信息完整，但视觉层级偏“表格化”**：数字很多、卡片相似、图表位置偏后，用户第一眼很难判断“最近花费是否异常、使用趋势怎样、额度是否危险”。

我建议你不要单纯“加颜色”，而是改成 **Analytics Dashboard 风格：核心数字 + 趋势图 + 状态提示**。


## 2. 当前界面最应该改的地方

### 现在的问题

你现在的 5 个数据卡片几乎是同一种视觉权重：

* Total Tokens
* Total Cost
* Avg / Day
* Cache Hit
* Cost / 1M

但其实它们的重要性不同。

我建议改成：

* **Total Cost** 做主指标
* **Tokens / Cache / Cost per 1M** 做辅助指标
* **Limits** 做状态监控
* **Usage Trends** 提前露出，不要放太低

---

## 3. 新首页结构建议

可以改成这样：

```text
┌──────────────────────────────────────────────┐
│ Hero: 30-day Cost + Trend                     │
│ $299.72        +12.4% vs previous period      │
│ [30-day cost line chart / area chart]         │
└──────────────────────────────────────────────┘

┌──────────────┬──────────────┬──────────────┐
│ Total Tokens │ Cache Hit    │ Cost / 1M    │
│ 340.7M       │ 92%          │ $0.8796      │
│ mini chart   │ ring chart   │ trend line   │
└──────────────┴──────────────┴──────────────┘

┌──────────────────────────────┬──────────────┐
│ Daily Usage Trend             │ Codex Limits │
│ stacked bar / area chart      │ 5h + weekly  │
└──────────────────────────────┴──────────────┘

┌──────────────────────────────────────────────┐
│ Calendar Heatmap / Monthly Overview           │
└──────────────────────────────────────────────┘
```

这样第一屏就能看到“花了多少钱、趋势怎样、额度还剩多少”。

---

## 4. 每个数据卡片怎么变得更有设计感

### Total Cost

现在只是 `$299.7199`，可以变成：

```text
Total Cost
$299.72
Last 30 days

+ $38.21 vs previous 30 days
[小型面积折线图]
```

建议展示：

* 当前周期总花费
* 与上一个周期对比
* 30 天 mini area chart
* 最高花费日标记

视觉上可以用紫色 / 粉紫色。

---

### Total Tokens

不要只显示一个总数，建议改成：

```text
Total Tokens
340.7M

Input    210M
Output    19M
Cached   311M

[stacked mini bar chart]
```

如果你的数据里能拆分 input / output / cache，建议做 **stacked bar chart**，比单个数字有用很多。

颜色建议：

* Input：蓝色
* Output：紫色
* Cached：绿色 / 青色

---

### Cache Hit

这个最适合用图形化。

现在是：

```text
92.0%
311,369,856 cached input tokens
```

可以改成：

```text
Cache Efficiency
92%

[圆环进度图]

311.4M cached tokens
Estimated saved: $xx.xx
```

如果能算出节省金额，会更有价值。

---

### Cost / 1M

这个指标比较抽象，建议加上下文：

```text
Cost / 1M
$0.8796

↓ 8.2% lower than previous period
[small trend line]
```

单独一个 `$0.8796` 用户不一定知道好坏，加趋势后才有意义。

---

### Avg / Day

现在显示：

```text
11,358,197 / $9.9907
```

这个信息密度有点高，可以拆成：

```text
Daily Average
$9.99 / day

11.36M tokens / day
[7-day rolling average line]
```

更容易读。

---

## 5. Codex Limits 建议重做

现在的进度条是可读的，但设计感偏弱。可以改成两个并排的状态卡：

```text
5-hour limit
91% remaining
Reset in 4h 25m

[ring gauge] [progress bar]

Weekly limit
90% remaining
Reset Wed 15:15

[ring gauge] [progress bar]
```

建议：

* `remaining > 70%`：绿色 / 蓝色
* `30% - 70%`：黄色
* `< 30%`：橙色 / 红色
* 加一个状态文案：`Healthy` / `Moderate` / `Near limit`

比如：

```text
5-hour limit
Healthy · 91% remaining
```

这样比单纯百分比更直观。

---

## 6. Usage Trends 应该成为核心区域

现在 `Usage Trends` 在下面，只露出标题，用户还没看到图。

建议第一屏直接展示一张主图：

### 主图推荐

**Daily Cost + Tokens 双轴图**

```text
X轴：日期
左轴：Tokens
右轴：Cost
柱状图：tokens
折线图：cost
```

或者更简单：

**Stacked Daily Token Bar + Cost Line**

```text
每日 token 用量：堆叠柱状图
每日 cost：折线图
```

这张图会非常有价值，因为用户能马上看到：

* 哪天用量暴涨
* cost 和 token 是否同步
* cache 是否改善成本
* 某天是否异常

---

## 7. 增加一个 Calendar Heatmap

这个很适合 usage app。

类似 GitHub contribution heatmap：

```text
May 2026
Mon Tue Wed Thu Fri Sat Sun
□ □ ▢ ▣ ▣ ■ □
```

用于展示：

* 每天 token 使用强度
* 每天 cost 强度
* 可切换 `Tokens / Cost / Sessions`

这个会让页面马上更有记忆点。

---

## 8. 颜色建议：丰富，但不要乱

建议用一套语义色，而不是随机上色。

你给页面元素定义好不同的颜色，避免现在只有一种颜色的单调。

例如：

* 成本：紫色
* token：蓝色
* cache：绿色
* limits：按风险动态变色
* export / rescan：继续用主色按钮

重点是：**颜色要表达含义，不只是装饰。**

---

## 9. 卡片样式建议

你现在的卡片比较平。可以增强一点：

### 卡片结构

```text
[icon] Label
Big Number
Sub text / delta
Mini chart
```

例如：

```text
┌────────────────────────┐
│ 💸 Total Cost           │
│ $299.72                 │
│ ↑ 12.4% from last month │
│    ╭╮  ╭─╮              │
│ ───╯╰──╯ ╰──            │
└────────────────────────┘
```

### 视觉细节

建议加：

* 卡片顶部轻微渐变
* hover 时 border 变主色
* 图标放在淡色圆形背景里
* 数字用 tabular nums，避免跳动
* 重要数值最多保留 2 位小数

例如 `$299.7199` 建议显示成 `$299.72`，详细值可以 hover 或 tooltip。

---

## 10. 顶部区域可以更像产品

现在顶部文案是：

```text
Local Codex cost intelligence.
A compact local dashboard...
```

可以改成更有状态感：

```text
Good afternoon, Vincent
Your Codex usage is healthy this period.

$299.72 spent · 340.7M tokens · 92% cache hit
```

右侧保留：

* Last 30 Days
* Export
* Rescan
* Last updated

把 “Imported 33 day buckets...” 这种技术信息弱化，可以放到小状态条或 Logs 里。

---

## 11. 我会建议的最终版方向

我建议你优先做这个版本：

### 第一阶段，成本最低但效果明显

1. 5 个数据卡片全部加 mini chart。
2. Total Cost 做成主卡，占两列。
3. Cache Hit 做圆环图。
4. Limits 改成 gauge + 状态文案。
5. Usage Trends 移到第一屏。
6. 加一套语义色。
7. 数字格式统一：`340.7M`、`$299.72`、`$0.88 / 1M`。

### 第二阶段，再增强体验

1. 加 Calendar Heatmap。
2. 加上一周期对比。
3. 支持 Dark Mode。
4. 点击某天进入 daily detail。
5. 异常用量高亮，比如 “May 18 cost was 2.3x higher than average”。

---

## 12. 一个更具体的首页布局建议

```text
Header
├─ Logo / App name
├─ Dashboard / Monthly / Settings / Logs
└─ Time range / Export / Rescan

Overview
├─ Main Cost Card, 2 columns wide
│  ├─ $299.72
│  ├─ +12.4% vs previous period
│  └─ 30-day area chart
│
├─ Limit Status Card
│  ├─ 5h: 91% remaining
│  └─ Weekly: 90% remaining

Metric Cards
├─ Tokens: 340.7M + stacked mini bars
├─ Cache Hit: 92% + ring chart
├─ Cost / 1M: $0.88 + trend line

Usage Trend
├─ Daily stacked token bars
└─ Cost line overlay

Monthly Heatmap
└─ Cost / Tokens calendar view
```

我的建议是：**不要把它做成“更多卡片”，而是做成“能一眼看懂状态的驾驶舱”。**
最关键的设计变化是：把每个大数字都配一个趋势图或状态图，让用户知道这个数字是“正常、变高、变低，还是危险”。
