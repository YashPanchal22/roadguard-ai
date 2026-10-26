import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState, Skeleton } from './ui';
import { useTheme } from '../context/AppProviders';
import type { ChartBundle, SeriesPoint } from '../types';

const PALETTE = ['#f97316', '#3b82f6', '#14b8a6', '#8b5cf6', '#ef4444', '#eab308', '#0ea5e9', '#64748b'];

function useChartTheme() {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  return {
    dark,
    grid: dark ? '#1e293b' : '#e2e8f0',
    axis: dark ? '#94a3b8' : '#64748b',
    tooltipBg: dark ? '#0d1526' : '#ffffff',
    tooltipBorder: dark ? '#22304f' : '#cbd5e6',
    text: dark ? '#e2e8f0' : '#0d1526',
  };
}

function tooltipStyle(theme: ReturnType<typeof useChartTheme>) {
  return {
    contentStyle: {
      backgroundColor: theme.tooltipBg,
      border: `1px solid ${theme.tooltipBorder}`,
      borderRadius: 8,
      fontSize: 12,
      color: theme.text,
    },
    labelStyle: { color: theme.text, fontWeight: 600, fontSize: 11 },
    itemStyle: { color: theme.text, fontSize: 11 },
  };
}

export function ChartFrame({
  title,
  description,
  children,
  action,
  height = 240,
  loading,
  empty,
  emptyDescription = 'No records match the current filters.',
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  height?: number;
  loading?: boolean;
  empty?: boolean;
  emptyDescription?: string;
}) {
  return (
    <div className="card flex flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-ink-100 px-4 py-3 dark:border-ink-800">
        <div>
          <h3 className="text-[13px] font-semibold text-ink-900 dark:text-ink-50">{title}</h3>
          {description ? <p className="mt-0.5 text-[11px] leading-snug text-ink-500 dark:text-ink-400">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="p-3" style={{ minHeight: height }}>
        {loading ? (
          <Skeleton className="h-full w-full" />
        ) : empty ? (
          <EmptyState title="No data yet" description={emptyDescription} />
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function hasValues(points: SeriesPoint[]): boolean {
  return points.some((point) => Number(point.value) !== 0 || Number(point.secondary ?? 0) !== 0);
}

export function TimeSeriesChart({ bundle, loading }: { bundle?: ChartBundle; loading?: boolean }) {
  const theme = useChartTheme();
  const primary = bundle?.series[0]?.data ?? [];
  const secondary = bundle?.series[1]?.data ?? [];
  const merged = useMemo(
    () =>
      primary.map((point, index) => ({
        label: point.label,
        [bundle?.series[0]?.name ?? 'value']: point.value,
        ...(secondary[index] ? { [bundle?.series[1]?.name ?? 'secondary']: secondary[index].value } : {}),
      })),
    [primary, secondary, bundle],
  );

  return (
    <ChartFrame
      title={bundle?.name ?? 'Reports by date'}
      description={bundle?.description}
      loading={loading}
      empty={!loading && !hasValues(primary)}
      emptyDescription="No reports were recorded in this period."
    >
      <ResponsiveContainer width="100%" height={230}>
        <AreaChart data={merged} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="gradSubmitted" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f97316" stopOpacity={0.5} />
              <stop offset="95%" stopColor="#f97316" stopOpacity={0.03} />
            </linearGradient>
            <linearGradient id="gradResolved" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: theme.axis }}
            tickFormatter={(value: string) => value.slice(5)}
            interval="preserveStartEnd"
            minTickGap={24}
            stroke={theme.grid}
          />
          <YAxis tick={{ fontSize: 10, fill: theme.axis }} allowDecimals={false} stroke={theme.grid} />
          <Tooltip {...tooltipStyle(theme)} />
          <Legend wrapperStyle={{ fontSize: 11, color: theme.axis }} />
          <Area
            type="monotone"
            dataKey={bundle?.series[0]?.name ?? 'value'}
            stroke="#f97316"
            strokeWidth={2}
            fill="url(#gradSubmitted)"
          />
          {secondary.length ? (
            <Area
              type="monotone"
              dataKey={bundle?.series[1]?.name ?? 'secondary'}
              stroke="#14b8a6"
              strokeWidth={2}
              fill="url(#gradResolved)"
            />
          ) : null}
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function CategoryBarChart({
  bundle,
  loading,
  horizontal = false,
  title,
  description,
}: {
  bundle?: ChartBundle;
  loading?: boolean;
  horizontal?: boolean;
  title?: string;
  description?: string;
}) {
  const theme = useChartTheme();
  const data = bundle?.series[0]?.data ?? [];
  return (
    <ChartFrame
      title={title ?? bundle?.name ?? 'Chart'}
      description={description ?? bundle?.description}
      loading={loading}
      empty={!loading && !hasValues(data)}
    >
      <ResponsiveContainer width="100%" height={horizontal ? Math.max(200, data.length * 30) : 230}>
        <BarChart
          data={data}
          layout={horizontal ? 'vertical' : 'horizontal'}
          margin={{ top: 6, right: 12, left: horizontal ? 12 : -20, bottom: 0 }}
        >
          <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" tick={{ fontSize: 10, fill: theme.axis }} allowDecimals={false} stroke={theme.grid} />
              <YAxis
                type="category"
                dataKey="label"
                width={104}
                tick={{ fontSize: 10, fill: theme.axis }}
                stroke={theme.grid}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: theme.axis }}
                interval={0}
                angle={data.length > 6 ? -25 : 0}
                textAnchor={data.length > 6 ? 'end' : 'middle'}
                height={data.length > 6 ? 52 : 30}
                stroke={theme.grid}
              />
              <YAxis tick={{ fontSize: 10, fill: theme.axis }} allowDecimals={false} stroke={theme.grid} />
            </>
          )}
          <Tooltip {...tooltipStyle(theme)} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={46}>
            {data.map((entry, index) => (
              <Cell key={entry.label} fill={PALETTE[index % PALETTE.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function DonutChart({ bundle, loading }: { bundle?: ChartBundle; loading?: boolean }) {
  const theme = useChartTheme();
  const data = bundle?.series[0]?.data ?? [];
  const total = data.reduce((sum, point) => sum + Number(point.value ?? 0), 0);
  return (
    <ChartFrame
      title={bundle?.name ?? 'Distribution'}
      description={bundle?.description}
      loading={loading}
      empty={!loading && total === 0}
    >
      <ResponsiveContainer width="100%" height={230}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="label" innerRadius={52} outerRadius={82} paddingAngle={2}>
            {data.map((entry, index) => (
              <Cell key={entry.label} fill={PALETTE[index % PALETTE.length]} stroke="transparent" />
            ))}
          </Pie>
          <Tooltip {...tooltipStyle(theme)} />
          <Legend wrapperStyle={{ fontSize: 11, color: theme.axis }} />
        </PieChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function TrendLineChart({ bundle, loading }: { bundle?: ChartBundle; loading?: boolean }) {
  const theme = useChartTheme();
  const primary = bundle?.series[0]?.data ?? [];
  const secondary = bundle?.series[1]?.data ?? [];
  const merged = useMemo(
    () =>
      primary.map((point, index) => ({
        label: point.label,
        [bundle?.series[0]?.name ?? 'value']: point.value,
        ...(secondary[index] ? { [bundle?.series[1]?.name ?? 'secondary']: secondary[index].value } : {}),
      })),
    [primary, secondary, bundle],
  );
  return (
    <ChartFrame
      title={bundle?.name ?? 'Trend'}
      description={bundle?.description}
      loading={loading}
      empty={!loading && !hasValues(primary)}
    >
      <ResponsiveContainer width="100%" height={230}>
        <LineChart data={merged} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
          <CartesianGrid stroke={theme.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: theme.axis }} stroke={theme.grid} />
          <YAxis tick={{ fontSize: 10, fill: theme.axis }} allowDecimals={false} stroke={theme.grid} />
          <Tooltip {...tooltipStyle(theme)} />
          <Legend wrapperStyle={{ fontSize: 11, color: theme.axis }} />
          <Line type="monotone" dataKey={bundle?.series[0]?.name ?? 'value'} stroke="#f97316" strokeWidth={2} dot={{ r: 2 }} />
          {secondary.length ? (
            <Line
              type="monotone"
              dataKey={bundle?.series[1]?.name ?? 'secondary'}
              stroke="#14b8a6"
              strokeWidth={2}
              dot={{ r: 2 }}
            />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function MiniSparkline({ data, color = '#f97316' }: { data: SeriesPoint[]; color?: string }) {
  if (!data.length) return null;
  return (
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <Area type="monotone" dataKey="value" stroke={color} fill={color} fillOpacity={0.18} strokeWidth={1.5} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
