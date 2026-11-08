# Existing Page Styles and Account Card Design Rationale

This document distills the design of existing screens outside the Accounts page for reuse in future pages and cards. The project's visual style combines neutral backgrounds, subtle borders, restrained indigo accents, and a clear hierarchy for data. Compactness comes from grouping related information, alignment, and consolidating secondary details, rather than shrinking all the text.

## Page Styles

| Page or area | Existing design characteristics | Reusable principles |
| --- | --- | --- |
| Dashboard | Primary cost uses bold 36–48px text; small labels and supporting data are visually subdued; the main card has a very subtle indigo gradient; trends and summaries sit side by side | Limit each content group to a few visual focal points; give primary metrics, descriptions, and timestamps distinct levels |
| Models | Top summaries use bold 18px values and gray 12px labels; quotas for the same model are grouped into horizontal bars; detailed estimates can be expanded | Place comparable data side by side and reveal complex data progressively; preserve the ability to compare |
| Projects | Names, paths, token breakdowns, and costs have distinct levels; paths use a monospace font; labels sit next to values; thin bars show proportions | Organize content by its relationships rather than presenting a flat sequence of label-value pairs |
| Daily and Monthly | 14px table body text; gray 12px headers; right-aligned costs; each cell can contain totals, breakdowns, and proportions; consecutive inactive records are merged | Use alignment and merging to make dense information compact while preserving readability |
| Sessions and details | Lists carry primary information; details contain conversations, usage breakdowns, and quotas; models, status, and time are supporting information | Use the main view for quick recognition and selection, with detailed explanations available on demand |
| Settings | Titles and descriptions are grouped; cards have 12px corners; whitespace and subtle dividers separate groups; inputs, switches, and explanations follow their operational relationships | Use containers to separate tasks rather than adding a small card for every field |
| Logs | Monospace 12px body text; subdued timestamps; semantic colors for log levels; a fixed toolbar and independently scrolling content | Keep technical details in a dedicated area; use status colors only for parts that need to be identified |
| Sidebar and shared header | Light purple-gray sidebar background; selected items use indigo text and a low-opacity background; small line icons; small text for sync status and time | Use color to convey status and interaction; keep background information from competing with primary content |

## Colors and Surfaces

The following are actual values from `src/styles.css` and `tailwind.config.ts`.

| Meaning | Light | Dark | Usage |
| --- | --- | --- | --- |
| Page background | `#FAFAFA` | `#0E0E11` | Main content background |
| Card surface | `#FFFFFF` | `#18181B` | Bounded content blocks |
| Sidebar | `#F5F4F9` | `#18181B` | Global navigation |
| Primary text | `#0A0A0A` | `#FAFAFA` | Headings and key values |
| Secondary text | `#6B6B6B` | `#A1A1AA` | Labels, timestamps, and supporting descriptions |
| Borders and dividers | `#E8E8EC` | `#303036` | Subtle 1px borders and dividers |
| Primary color | `#6366F1` | Same as light | Primary actions, selection, and small accents |
| Success | `#10B981` | Same as light | Normal status and success feedback |
| Warning | `#F59E0B` | Same as light | Stale data and states requiring attention |
| Error | `#EF4444` | Same as light | Request errors or failures |

Charts also use category colors such as sky, emerald, and violet, as well as cost intensity colors such as amber and rose, always paired with labels. These are not a reason to color every ordinary field individually. Some existing screens use localized gradients and highlighted badges; account cards should maintain the same restraint.

## Typography and Information Hierarchy

| Level | Existing usage | Account card recommendation |
| --- | --- | --- |
| Page and card titles | General Sans, commonly 24px, `tracking-display: -0.04em` | 24px page titles; 16–18px semibold email addresses |
| Primary metrics | 36–48px on the dashboard; bold 18px model summaries | Bold 28px remaining quota values; give both windows equal importance |
| Body text and actions | DM Sans, commonly 14px with weights of 400–500 | 12–14px for workspaces, subscription summaries, and actions |
| Supporting labels | Gray 10–12px text; English group labels often use uppercase and letter spacing | At least 11px for key supporting information; do not force extra letter spacing on Chinese text |
| Numbers and technical information | `tabular-nums` aligns values; paths and some monetary amounts use JetBrains Mono | Use tabular numerals for quotas, balances, and counts; put full paths in the details |

Chinese text falls back to the system sans-serif font. Font sizes in the mockups express review targets; reuse the existing font configuration during implementation.

## Geometry and Spacing

- Base cards have 12px corners and buttons have 6px corners; labels may use a pill shape. Cards typically have a 1px border and do not rely on prominent shadows at rest.
- Shared card headers and content default to 24px padding; the main dashboard card uses a more compact 16–20px. Spacing between pages and cards is commonly 16px.
- Core content and supporting descriptions are often grouped with 4–8px gaps; functional sections use 12–16px gaps. Dividers separate groups rather than individual fields.
- Icons come from Lucide and are commonly 14–16px; data bars are usually thin rounded bars, 4–8px high.
- The shared content area has a maximum width of 1280px, with horizontal padding of 24, 32, or 40px depending on content width.
- The existing `content-sm/md/lg` container breakpoints are 640, 768, and 1024px. They depend on the main content area's width rather than the whole window's width. The account mockups recommend allowing two columns when the content area is at least 760px wide, with individual cards starting at about 370px; the final implementation must be verified in a real Tauri window.

## Account Card Proposal

See the [account card mockup](design/accounts-card-review.png) for review. The [conversation preview source](design/accounts-card-review.html) provides expandable details and menus for viewing in the conversation. All data, email addresses, workspaces, and dates are examples; buttons do not perform real account operations.

### Information Structure

1. Identity: use the email address as the title and the workspace as secondary text; show “Currently in use” as a small indigo badge. Place the plan name directly in the subscription summary instead of listing four separate property rows.
2. Subscription summary: combine details into “Plus · Active subscription · Expires Dec 7 · Auto-renewal.” Full years, times, and data sources are available in the details. Describe canceled renewal as “Will not renew at expiration”; do not incorrectly describe the subscription as expired.
3. Quotas: place the 5-hour and weekly quotas side by side; use 28px values to emphasize the remaining quota, with small gray text for the reset countdown. Progress bars consistently show remaining quota without also repeating both remaining and consumed percentages. Free accounts show only the monthly window actually provided by the API.
4. Resources: group the balance and available reset count horizontally, keeping values next to their units; put reset voucher expiration dates in expandable details so that many entries do not increase the card's default height.
5. Footer: place the update time and details on one side, with “Refresh,” “Switch to this account,” and “More” on the other; put sign-in and removal actions in the More menu. Show the sign-in action directly when the account requires signing in again.

### State Rules

- Normal: use neutral primary values, with a small colored dot and text for success status; do not fill the whole area with green. Adjust text contrast for the dark theme.
- Low quota: highlight only the affected window and explicitly label it “Low remaining quota.” This mockup uses 12% remaining to illustrate the state; the final threshold follows the project's existing quota rules rather than introducing new business rules during design.
- Stale data or partial failure: retain the last successful values and identify them as “Previous data,” along with the failed item. Never display unknown or failed queries as 0, 100%, or “Invalid subscription.”
- Sign-in required: show a visible message and a sign-in button within the card; keep other cached metrics available for viewing.
- Time: show compact timestamps by default; retain per-item update times, errors, full validity periods, and individual reset voucher expiration dates in “Data details.” When items are out of sync, do not hide older values behind a single “Just updated” label.
- Switching, removal, and signing in again only change where actions appear; preserve existing behavior, disabled conditions, and confirmation requirements. Historical usage is not attributed to an individual account card.

### Review Criteria

- Identify the account and whether it is currently in use at first glance, read the available quota next, and leave subscription details, balances, and update times at the third level.
- Target a normal card height of about 300–340px; allow natural growth as text wraps, avoiding clipping from fixed heights. Use a single column on narrow screens and allow email addresses to wrap.
- Give every existing field a place; collapsible details contain only infrequently needed information, while critical exceptions remain visible.
- Do not add avatars, scores, filters, statistical overviews, or marketing decoration.

## Source References

- [Theme colors and base typography](../src/styles.css)
- [Fonts, corner radii, shadows, and container breakpoints](../tailwind.config.ts)
- [Base card](../src/components/ui/card.tsx) and [button](../src/components/ui/button.tsx)
- [Dashboard hero card](../src/components/dashboard-hero-card.tsx) and [shared header](../src/components/dashboard-header.tsx)
- [Model data organization](../src/components/model-usage-card.tsx)
- [Project data organization](../src/components/project-usage-card.tsx)
- [Daily table](../src/components/daily-usage-table.tsx) and [monthly table](../src/components/monthly-usage-table.tsx)
- [Session list](../src/components/session-usage-table.tsx) and [settings](../src/components/settings-page.tsx)
- [Logs](../src/components/log-panel.tsx)
- [Sidebar](../src/components/app-sidebar.tsx) and [shared layout](../src/App.tsx)

The Accounts page is used only to check the fields to be reorganized and existing behavior; it is not a source for the style observations above.
