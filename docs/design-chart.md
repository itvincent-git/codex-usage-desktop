The current interface **presents all the information, but its visual hierarchy feels too much like a table**: there are many numbers, the cards look similar, and the charts appear too far down the page. At first glance, users struggle to tell whether recent spending is unusual, how usage is trending, or whether they are approaching their limits.

I recommend moving toward an **analytics dashboard: key metrics + trend charts + status indicators**, rather than simply adding color.


## 2. What needs the most attention in the current interface

### Current issues

The five metric cards currently have almost the same visual weight:

* Total Tokens
* Total Cost
* Avg / Day
* Cache Hit
* Cost / 1M

However, they differ in importance.

I recommend the following:

* Make **Total Cost** the primary metric.
* Use **Tokens / Cache / Cost per 1M** as supporting metrics.
* Use **Limits** for status monitoring.
* Show **Usage Trends** earlier, rather than placing it too far down the page.

---

## 3. Suggested homepage structure

Consider this layout:

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

This lets users see spending, trends, and remaining quota in the first viewport.

---

## 4. How to improve the design of each metric card

### Total Cost

Instead of displaying only `$299.7199`, use:

```text
Total Cost
$299.72
Last 30 days

+ $38.21 vs previous 30 days
[mini area chart]
```

Suggested content:

* Total spending for the current period
* Comparison with the previous period
* A 30-day mini area chart
* A marker for the highest-spending day

Use purple or pinkish purple for the visual styling.

---

### Total Tokens

Instead of showing only a total, consider:

```text
Total Tokens
340.7M

Input    210M
Output    19M
Cached   311M

[stacked mini bar chart]
```

If the data supports an input / output / cache breakdown, a **stacked bar chart** is much more useful than a single number.

Suggested colors:

* Input: blue
* Output: purple
* Cached: green / cyan

---

### Cache Hit

This metric is particularly well suited to a visual display.

Currently:

```text
92.0%
311,369,856 cached input tokens
```

Consider:

```text
Cache Efficiency
92%

[ring progress chart]

311.4M cached tokens
Estimated saved: $xx.xx
```

An estimate of the money saved would add value, if it can be calculated.

---

### Cost / 1M

This metric is somewhat abstract, so add context:

```text
Cost / 1M
$0.8796

↓ 8.2% lower than previous period
[small trend line]
```

Users may not know whether `$0.8796` alone is good or bad. A trend gives the number meaning.

---

### Avg / Day

Currently:

```text
11,358,197 / $9.9907
```

This is a little dense. Split it into:

```text
Daily Average
$9.99 / day

11.36M tokens / day
[7-day rolling average line]
```

This is easier to read.

---

## 5. Suggested redesign of Codex Limits

The current progress bars are readable, but the visual design could be stronger. Consider two status cards side by side:

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

Recommendations:

* `remaining > 70%`: green / blue
* `30% - 70%`: yellow
* `< 30%`: orange / red
* Add a status label: `Healthy` / `Moderate` / `Near limit`

For example:

```text
5-hour limit
Healthy · 91% remaining
```

This is more intuitive than a percentage alone.

---

## 6. Make Usage Trends a central section

Currently, `Usage Trends` is so far down the page that only its title is visible, leaving the chart out of view.

Show a main chart in the first viewport:

### Recommended main chart

**Daily Cost + Tokens dual-axis chart**

```text
X-axis: date
Left axis: Tokens
Right axis: Cost
Bars: tokens
Line: cost
```

Or, more simply:

**Stacked Daily Token Bar + Cost Line**

```text
Daily token usage: stacked bars
Daily cost: line
```

This chart would be particularly useful because users could immediately see:

* Which days had usage spikes
* Whether cost and token usage move together
* Whether caching reduces costs
* Whether a particular day is unusual

---

## 7. Add a Calendar Heatmap

This is a good fit for a usage app.

Use something similar to the GitHub contribution heatmap:

```text
May 2026
Mon Tue Wed Thu Fri Sat Sun
□ □ ▢ ▣ ▣ ■ □
```

Use it to show:

* Daily token usage intensity
* Daily spending intensity
* A switch between `Tokens / Cost / Sessions`

This would make the page more memorable.

---

## 8. Color recommendations: varied, but consistent

Use a semantic color palette rather than assigning colors arbitrarily.

Assign distinct colors to page elements to avoid the monotony of the current single-color treatment.

For example:

* Cost: purple
* Tokens: blue
* Cache: green
* Limits: dynamic colors based on risk
* Export / rescan: continue using primary-color buttons

The key principle: **color should communicate meaning, not just decorate.**

---

## 9. Card styling recommendations

The current cards look rather flat. Consider these improvements:

### Card structure

```text
[icon] Label
Big Number
Sub text / delta
Mini chart
```

For example:

```text
┌────────────────────────┐
│ 💸 Total Cost           │
│ $299.72                 │
│ ↑ 12.4% from last month │
│    ╭╮  ╭─╮              │
│ ───╯╰──╯ ╰──            │
└────────────────────────┘
```

### Visual details

Consider adding:

* A subtle gradient at the top of each card
* A primary-color border on hover
* Icons on pale circular backgrounds
* Tabular numerals to prevent numbers from shifting
* At most two decimal places for key values

For example, display `$299.7199` as `$299.72`, with the full value available on hover or in a tooltip.

---

## 10. Make the header feel more like a finished product

The current header text is:

```text
Local Codex cost intelligence.
A compact local dashboard...
```

Consider text that better communicates the current status:

```text
Good afternoon, Vincent
Your Codex usage is healthy this period.

$299.72 spent · 340.7M tokens · 92% cache hit
```

Keep the following on the right:

* Last 30 Days
* Export
* Rescan
* Last updated

De-emphasize technical information such as “Imported 33 day buckets...” by moving it to a small status bar or Logs.

---

## 11. Recommended direction for the final design

I recommend prioritizing this version:

### Phase one: low effort, visible improvements

1. Add mini charts to all five metric cards.
2. Make Total Cost the main card, spanning two columns.
3. Use a ring chart for Cache Hit.
4. Use gauges and status labels for Limits.
5. Move Usage Trends into the first viewport.
6. Add a semantic color palette.
7. Standardize number formatting: `340.7M`, `$299.72`, `$0.88 / 1M`.

### Phase two: further improvements to the experience

1. Add a Calendar Heatmap.
2. Add comparisons with the previous period.
3. Support Dark Mode.
4. Open daily details when a day is clicked.
5. Highlight unusual usage, such as “May 18 cost was 2.3x higher than average”.

---

## 12. A more detailed homepage layout proposal

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

I recommend designing this as **a dashboard that makes the current status clear at a glance**, rather than simply adding more cards.
The most important design change is to pair every prominent number with a trend chart or status visualization, so users can tell whether it is normal, rising, falling, or approaching a limit.
