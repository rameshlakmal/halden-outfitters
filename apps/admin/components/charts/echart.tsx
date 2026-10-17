'use client';
// One ECharts canvas. Only the chart types and parts used here are bundled (echarts/core). Colours come from the
// CSS tokens, so a chart re-draws in the other theme's steps when the theme changes; reduced motion turns
// animation off.
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';
import { useTheme } from '../shell/theme';

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

export type Tokens = {
  chart: string;
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  surface: string;
  surface2: string;
};
export type EChartsOption = echarts.EChartsCoreOption;

/** Resolved token colours (canvas can't read CSS variables, so read them through a probe element). */
function readTokens(): Tokens {
  const probe = document.createElement('i');
  document.body.append(probe);
  const read = (name: string) => {
    probe.style.color = `var(${name})`;
    return getComputedStyle(probe).color;
  };
  const t = {
    chart: read('--chart'),
    ink: read('--ink'),
    ink2: read('--ink-2'),
    ink3: read('--ink-3'),
    line: read('--line'),
    surface: read('--surface'),
    surface2: read('--surface-2'),
  };
  probe.remove();
  return t;
}

/** The hover tooltip: a surface card with ink text. */
export const tooltip = (t: Tokens) => ({
  backgroundColor: t.surface,
  borderColor: t.line,
  borderWidth: 1,
  padding: [8, 12],
  textStyle: { color: t.ink, fontSize: 13 },
  extraCssText: 'border-radius:10px;box-shadow:0 12px 32px -16px rgba(0,0,0,.35)',
});

/** The look every chart shares: text in ink tokens and the tooltip. Axes come from `axis`. */
export function baseOption(t: Tokens): EChartsOption {
  return { textStyle: { fontFamily: getComputedStyle(document.body).fontFamily, color: t.ink3 }, tooltip: tooltip(t) };
}

export const axis = (t: Tokens) => ({
  axisLine: { lineStyle: { color: t.line } },
  axisTick: { show: false },
  axisLabel: { color: t.ink3, fontSize: 12 },
  splitLine: { lineStyle: { color: t.line, type: [3, 4] as number[] } },
});

export function EChart({
  build,
  height,
  label,
}: {
  /** Makes the option from the theme's colours. */
  build: (t: Tokens) => EChartsOption;
  height: number;
  /** What the chart shows, for screen readers (the numbers are also in the tooltip and the page's text). */
  label: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, undefined, { renderer: 'canvas' });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    chart.current?.setOption(
      { animation: !reduce, animationDuration: 700, animationEasing: 'cubicOut', ...build(readTokens()) },
      true,
    );
  }, [build, theme]);

  return <div ref={el} role="img" aria-label={label} style={{ height }} />;
}
