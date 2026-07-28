# Plan: Split "Home" from "Metrics Dashboard"

**Source:** Feedback item — "Home Page Separate from Metrics Dashboard? I think it would be good to
separate the dashboard that contains the metrics from other important info like need to-do/address
stuff like deadlines, colour sample holds, need follow up, etc."

## Current state

Everything lives in one page: `/admin/dashboard` (`src/app/admin/dashboard/page.tsx` +
`DashboardView.tsx`). It's also the app's landing page — both the post-login redirect
(`src/app/login/LoginForm.tsx:37`, `from ?? '/admin/dashboard'`) and the root redirect
(`src/app/page.tsx`) point here. The single view currently mixes two different jobs:

- **Metrics** (glanceable, backward-looking): 7 stat cards (Total Orders, Pipeline Value, Awaiting
  Customer, In Progress, Confirmed, Changes Requested, Colour Sample Holds, + Failed Events for
  admins), 7-day trend bar chart, status-breakdown pie chart.
- **Action items** (forward-looking, "what do I need to do today"): Quick Actions, Needs
  Follow-up (stale orders), Upcoming Deadlines, Colour Sample Holds list, Recent Orders, Failed
  Events list (admin only).

Both are server-rendered from one `getDashboardData()` call in `page.tsx` that fires 7 queries in
parallel and hands everything to one client component.

## Proposed split

Two pages, two nav items:

| Page | Route | Purpose |
|---|---|---|
| **Home** | `/admin/dashboard` (keep this URL — it's the login/root redirect target, no need to touch that logic) | Action-oriented landing page: "what needs my attention today." Quick Actions, Needs Follow-up, Upcoming Deadlines, Colour Sample Holds, Recent Orders, Failed Events (admin). Small at-a-glance counts only where they drive an action (e.g. badge counts on Quick Action buttons). |
| **Metrics** | new `/admin/metrics` | Pure reporting: the 7 stat cards, 7-day trend chart, status breakdown pie. No action buttons, no order lists. |

Nav rename: `AppShell.tsx`'s `NAV_ITEMS`/`buildNavItems()` — relabel the existing "Dashboard" item to
"Home" (same route, same icon is fine or swap `DashboardOutlined` for `HomeOutlined`), add a new
"Metrics" item (`BarChartOutlined` or similar) pointing at `/admin/metrics`, inserted right after
Home.

## File changes

1. **`src/app/admin/dashboard/page.tsx`** (rename in place, stays as Home)
   - Trim `getDashboardData()` to only the queries Home needs: `recentOrders`, `staleOrders`,
     `upcomingDeadlines`, `colorSampleHolds`, and the subset of `counts` needed for Quick Action
     badges (`changesRequested`, `sent`+`viewed` for "Awaiting Customer"). Drop `totalValueNZD` and
     `trend` — those move to Metrics.
   - Keep `listFailedEvents()` for admin role.
   - Rename component to `HomeView` (new file `src/app/admin/dashboard/HomeView.tsx`, or keep the
     dashboard folder and rename the view file — recommend keeping the folder name `dashboard` since
     that's the stable URL, just rename the component/file to `HomeView.tsx` for clarity).

2. **New `src/app/admin/metrics/page.tsx`** + **`src/app/admin/metrics/MetricsView.tsx`**
   - New server component with its own trimmed query set: `countRows` (all 7 stat cards),
     `valueRow` (Pipeline Value), `trendRows` (7-day trend). Also needs `colorSampleHolds.length`
     count and `failedEvents.length` count for their respective stat cards — those can be cheap
     `count()` queries instead of full row fetches (Home already fetches the full rows it needs
     separately; Metrics only needs the number).
   - `MetricsView` renders: the `Row` of `Statistic` cards, the trend `BarChart`, the status
     `PieChart`. No `Quick Actions`, no `List`s of orders, no retry button/event list.

3. **`DashboardView.tsx` → split into `HomeView.tsx` + `MetricsView.tsx`**
   - `STATUS_HEX`, `formatNZD`, `timeAgo`, `deadlineLabel`, `DashboardOrderListItem` are shared
     helpers used by both — move them to a small shared module, e.g.
     `src/app/admin/dashboard/dashboard-utils.tsx` (or `src/lib/dashboard-format.ts` for the pure
     functions, keep `DashboardOrderListItem` co-located with `HomeView` since only Home uses order
     lists). `STATUS_HEX` is needed by both (Home's avatar colors, Metrics' pie fill) — put it in the
     shared utils module.
   - `HomeView` keeps: header + "New Order" button, Quick Actions card, Needs Follow-up list, Recent
     Orders list, Upcoming Deadlines list, Colour Sample Holds list, Failed Events list + retry
     logic (`useState`/`retryEvent`/`App.useApp()` message hook — all admin-only bits stay here).
   - `MetricsView` keeps: stat card `Row`, trend `BarChart` card, status breakdown `PieChart` card.
     This view is presumably stateless (no retry logic needed) — can likely be a server component
     directly rendering antd/recharts, or a thin client component if `recharts` requires it (check:
     `ResponsiveContainer` typically needs `'use client'` — keep `MetricsView` as `'use client'` like
     the original for consistency).

4. **`AppShell.tsx`**
   - Update `buildNavItems()`: relabel `/admin/dashboard` entry to "Home"; add
     `{ key: '/admin/metrics', icon: <BarChartOutlined />, label: <Link href="/admin/metrics">Metrics</Link> }`.
     No role restriction needed — both roles currently see the dashboard, so both should see Metrics.

5. **Tests**
   - Split `DashboardView.test.tsx` into `HomeView.test.tsx` (Quick Actions, stale/deadline/colour
     lists, failed-event retry flow) and `MetricsView.test.tsx` (stat card values, trend/pie render
     with data and empty states). Reuse the existing `baseProps`/`order`/`failedEvent` builders,
     split them across the two test files per what each view's props actually need.
   - Add/verify `getDashboardData` (or its split successors) integration tests if any exist for
     `page.tsx` — check `dashboard` folder for a `page.integration.test.ts` before assuming none
     exists.

## Open questions to confirm before implementing

- **Recent Orders**: is this an "action" list (Home) or a "metrics" list (Metrics)? Leaning Home —
  it's the same "what's moving" framing as Needs Follow-up, and it's the natural place to click into
  an order. Flag this choice to the user rather than assuming.
- **Colour Sample Holds stat card**: the full list already lives on Home (it's an action item — hold
  production). Does the *count* also need to show as a stat card on Metrics, or is that redundant
  now that Home shows the full actionable list with a badge? Recommend: keep the stat card on
  Metrics (it's a legitimate "how many right now" metric) but don't duplicate the full list there.
- **Failed Events**: same question — Home keeps the actionable list (with Retry buttons, admin-only).
  Metrics could optionally keep just the count stat card for admins. Recommend yes, for parity with
  Colour Sample Holds.
- Any preference on the "Metrics" nav icon/label wording, or a different route name
  (`/admin/metrics` vs `/admin/reports` vs `/admin/analytics`)?

## Suggested implementation order

1. Extract shared helpers (`STATUS_HEX`, `formatNZD`, `timeAgo`, `deadlineLabel`) to a shared module.
2. Build `MetricsView` + `/admin/metrics/page.tsx` first (smaller, no interactive state) — verify
   stat cards/charts render correctly standalone.
3. Trim `HomeView` (rename from `DashboardView`) down to the action-oriented sections, remove what
   moved to Metrics.
4. Update `AppShell.tsx` nav.
5. Split tests, run `npm run typecheck && npm run lint && npm run test`.
6. Manually verify both pages in the browser (login → Home shows action items only → Metrics shows
   stat cards/charts only → nav highlights the right item on each).
