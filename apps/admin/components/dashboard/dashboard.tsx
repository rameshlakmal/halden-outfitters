'use client';
// The admin home: how the shop is doing over 7, 30 or 90 days of shop time, and what needs doing now.
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { axis, baseOption, EChart, tooltip, type Tokens } from '@/components/charts/echart';
import { Card, CardTitle, Empty, PageHeader, Skeleton, Tag } from '@/components/kit';
import { change, count, day, money, OPEN_STATUSES, REASON_LABEL, STATUS_LABEL, when } from '@/lib/format';
import { type DashboardData, useDashboard } from '@/lib/staff';

const RANGES = [7, 30, 90] as const;

function Delta({ value, previous, upIsGood = true }: { value: string; previous: string; upIsGood?: boolean }) {
  const c = change(value, previous);
  if (!c) return <p className="tabular text-xs text-ink-3">No earlier period to compare</p>;
  const good = c.up === upIsGood;
  return (
    <p className={`tabular text-xs ${good ? 'text-success' : 'text-danger'}`}>
      {c.text} <span className="text-ink-3">vs previous period</span>
    </p>
  );
}

function Tile({
  label,
  value,
  children,
  href,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-[12.5px] text-ink-3">{label}</p>
      <p className="tabular mt-1.5 text-[26px] leading-tight font-semibold">{value}</p>
      <div className="mt-1">{children}</div>
    </>
  );
  const cls = 'block rounded-[var(--radius-card)] border border-line bg-surface p-5';
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:border-accent`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function RevenueTile({ d }: { d: DashboardData }) {
  const spark = useCallback(
    (t: Tokens) => ({
      grid: { left: 0, right: 0, top: 4, bottom: 4 },
      xAxis: { type: 'category', show: false, boundaryGap: false, data: d.series.map((p) => p.day) },
      yAxis: { type: 'value', show: false, min: 'dataMin' },
      series: [
        {
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: d.series.map((p) => Number(p.revenue)),
          lineStyle: { width: 2, color: t.chart },
          areaStyle: { color: t.chart, opacity: 0.18 },
        },
      ],
    }),
    [d.series],
  );
  return (
    <div className="grid min-w-0 content-between gap-3 rounded-[var(--radius-card)] bg-hero p-5 text-hero-ink sm:row-span-2">
      <div>
        <p className="text-[12.5px] opacity-75">Revenue</p>
        <p className="tabular mt-1.5 text-[40px] leading-none font-semibold sm:text-[46px]">{money(d.revenue.value)}</p>
      </div>
      <EChart build={spark} height={72} label={`Revenue per day over the last ${d.days} days`} />
      <Delta value={d.revenue.value} previous={d.revenue.previous} />
    </div>
  );
}

function RevenueChart({ d }: { d: DashboardData }) {
  const build = useCallback(
    (t: Tokens) => ({
      ...baseOption(t),
      grid: { left: 56, right: 16, top: 16, bottom: 28 },
      tooltip: { ...tooltip(t), trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: t.ink3 } } },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: d.series.map((p) => day(p.day)),
        ...axis(t),
        splitLine: { show: false },
      },
      yAxis: { type: 'value', ...axis(t) },
      series: [
        {
          name: 'Revenue',
          type: 'line',
          smooth: true,
          showSymbol: false,
          symbolSize: 8,
          data: d.series.map((p) => Number(p.revenue)),
          lineStyle: { width: 2, color: t.chart },
          itemStyle: { color: t.chart },
          areaStyle: { color: t.chart, opacity: 0.12 },
        },
      ],
    }),
    [d.series],
  );
  return (
    <Card>
      <CardTitle>Revenue per day</CardTitle>
      <EChart
        build={build}
        height={260}
        label={`Revenue per day over the last ${d.days} days, ${money(d.revenue.value)} in total`}
      />
    </Card>
  );
}

function OrdersChart({ d }: { d: DashboardData }) {
  const build = useCallback(
    (t: Tokens) => ({
      ...baseOption(t),
      grid: { left: 40, right: 16, top: 16, bottom: 28 },
      tooltip: { ...tooltip(t), trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: t.surface2 } } },
      xAxis: { type: 'category', data: d.series.map((p) => day(p.day)), ...axis(t), splitLine: { show: false } },
      yAxis: { type: 'value', minInterval: 1, ...axis(t) },
      series: [
        {
          name: 'Orders',
          type: 'bar',
          barMaxWidth: 18,
          data: d.series.map((p) => p.orders),
          itemStyle: { color: t.chart, borderRadius: [4, 4, 0, 0] },
        },
      ],
    }),
    [d.series],
  );
  return (
    <Card>
      <CardTitle>Orders per day</CardTitle>
      <EChart
        build={build}
        height={260}
        label={`Orders per day over the last ${d.days} days, ${d.orders.value} in total`}
      />
    </Card>
  );
}

/** Horizontal bars with the count printed at the end of each bar, so nothing depends on colour or hover. */
function BarList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: { label: string; value: number; muted?: boolean }[];
  empty: string;
}) {
  const build = useCallback(
    (t: Tokens) => ({
      ...baseOption(t),
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      tooltip: { ...tooltip(t), trigger: 'item' },
      xAxis: { type: 'value', show: false },
      yAxis: {
        type: 'category',
        inverse: true,
        data: rows.map((r) => r.label),
        ...axis(t),
        axisLine: { show: false },
        axisLabel: { color: t.ink2, fontSize: 12.5 },
      },
      series: [
        {
          name: title,
          type: 'bar',
          barMaxWidth: 16,
          data: rows.map((r) => ({ value: r.value, itemStyle: { color: r.muted ? t.ink3 : t.chart } })),
          itemStyle: { borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', color: t.ink2, fontFamily: 'var(--font-mono)', fontSize: 12 },
        },
      ],
    }),
    [rows, title],
  );
  const total = rows.reduce((n, r) => n + r.value, 0);
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      {total === 0 ? (
        <Empty title={empty} />
      ) : (
        <EChart
          build={build}
          height={Math.max(160, rows.length * 34 + 16)}
          label={`${title}: ${rows.map((r) => `${r.label} ${r.value}`).join(', ')}`}
        />
      )}
    </Card>
  );
}

export function DashboardView() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const q = useDashboard(days);
  const d = q.data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`Shop time, last ${days} days`}
        actions={
          <div role="group" aria-label="Range" className="flex rounded-full border border-line bg-surface p-1">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={r === days}
                onClick={() => setDays(r)}
                className={`h-8 rounded-full px-3.5 text-[13px] font-medium transition-colors ${
                  r === days ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:text-ink'
                }`}
              >
                {r} days
              </button>
            ))}
          </div>
        }
      />

      {q.isError && (
        <Card>
          <Empty title="The dashboard didn't load">Check that the API is running, then reload the page.</Empty>
        </Card>
      )}

      {!d && !q.isError && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
          <Skeleton className="h-[236px] sm:row-span-2 sm:h-auto" />
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className={`h-[110px] ${i === 4 ? 'xl:col-span-2' : ''}`} />
          ))}
        </div>
      )}

      {d && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
            <RevenueTile d={d} />
            <Tile label="Orders" value={count(d.orders.value)}>
              <Delta value={d.orders.value} previous={d.orders.previous} />
            </Tile>
            <Tile label="Average order" value={money(d.averageOrder.value)}>
              <Delta value={d.averageOrder.value} previous={d.averageOrder.previous} />
            </Tile>
            <Tile label="Return rate" value={`${d.returnRate.value}%`}>
              <Delta value={d.returnRate.value} previous={d.returnRate.previous} upIsGood={false} />
            </Tile>
            <Tile label="Reviews to moderate" value={count(d.queues.reviewsToModerate)} href="/reviews">
              <p className="text-xs text-ink-3">waiting for support now</p>
            </Tile>
            <div className="xl:col-span-2">
              <Tile
                label="Low stock"
                value={`${d.queues.lowStock} ${d.queues.lowStock === 1 ? 'product' : 'products'}`}
                href="/products?low=1"
              >
                <p className={`text-xs ${d.queues.lowStock ? 'text-danger' : 'text-ink-3'}`}>
                  {d.queues.lowStock ? 'at or under their threshold' : 'everything is above its threshold'}
                </p>
              </Tile>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <RevenueChart d={d} />
            <OrdersChart d={d} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
            <BarList
              title="Orders by status"
              empty="No orders in this range"
              rows={d.byStatus.map((s) => ({
                label: STATUS_LABEL[s.status],
                value: s.count,
                muted: !OPEN_STATUSES.includes(s.status),
              }))}
            />
            <BarList
              title="Return reasons"
              empty="No returns in this range"
              rows={d.returnReasons.map((r) => ({ label: REASON_LABEL[r.reason], value: r.count }))}
            />
            <Card className="overflow-hidden">
              <CardTitle
                action={
                  <Link href="/orders" className="text-[13px] text-accent hover:underline">
                    All orders
                  </Link>
                }
              >
                Recent orders
              </CardTitle>
              {d.recentOrders.length === 0 ? (
                <Empty title="No orders yet" />
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="text-left text-ink-3">
                      <tr>
                        <th className="px-5 py-2 font-medium">Order</th>
                        <th className="py-2 font-medium">Customer</th>
                        <th className="py-2 font-medium">Status</th>
                        <th className="px-5 py-2 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.recentOrders.map((o) => (
                        <tr key={o.id} className="border-t border-line">
                          <td className="px-5 py-2.5 whitespace-nowrap">
                            <Link href={`/orders/${o.id}`} className="tabular font-medium hover:text-accent">
                              #{o.id}
                            </Link>
                            <p className="text-xs text-ink-3">{when(o.placedAt)}</p>
                          </td>
                          <td className="py-2.5 pr-3 whitespace-nowrap">{o.customer}</td>
                          <td className="py-2.5 pr-3">
                            <Tag
                              tone={
                                OPEN_STATUSES.includes(o.status)
                                  ? 'accent'
                                  : o.status === 'cancelled'
                                    ? 'danger'
                                    : 'neutral'
                              }
                            >
                              {STATUS_LABEL[o.status]}
                            </Tag>
                          </td>
                          <td className="tabular px-5 py-2.5 text-right">{money(o.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          {d.lowStock.length > 0 && (
            <Card className="overflow-hidden">
              <CardTitle
                action={
                  <Link href="/products?low=1" className="text-[13px] text-accent hover:underline">
                    Restock
                  </Link>
                }
              >
                Low stock
              </CardTitle>
              <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] border-t border-line">
                {d.lowStock.map((p) => (
                  <Link
                    key={p.id}
                    href={`/products/${p.id}`}
                    className="-mb-px grid gap-0.5 border-r border-b border-line px-5 py-3 hover:bg-surface-2"
                  >
                    <span className="font-medium">{p.name}</span>
                    <span className="tabular text-xs text-ink-3">
                      <span className={p.available === 0 ? 'text-danger' : 'text-ink'}>{p.available} left</span> of a
                      threshold of {p.threshold}
                    </span>
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </>
  );
}
