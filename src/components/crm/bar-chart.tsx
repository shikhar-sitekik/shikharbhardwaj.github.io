"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface BarDatum {
  label: string;
  value: number;
  /** Secondary value shown in tooltip only (e.g. weighted). */
  secondary?: number;
  count?: number;
}

/**
 * Single-series horizontal bar chart. One hue (no legend needed; the card
 * title names the series), recessive grid, tooltip on hover, 4px data-end radius.
 */
export function HBarChart({
  data,
  format,
  secondaryLabel,
  height,
}: {
  data: BarDatum[];
  format: "money" | "number";
  currency?: string;
  secondaryLabel?: string;
  height?: number;
  currencyCode?: string;
}) {
  return <HBarChartInner data={data} format={format} secondaryLabel={secondaryLabel} height={height} />;
}

function HBarChartInner({ data, format, secondaryLabel, height }: { data: BarDatum[]; format: "money" | "number"; secondaryLabel?: string; height?: number }) {
  const fmt = (n: number) =>
    format === "money" ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n) : new Intl.NumberFormat("en-US").format(n);
  const h = height ?? Math.max(140, data.length * 30 + 30);
  return (
    <div style={{ height: h }} className="w-full px-2 py-3">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 8 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="0" />
          <XAxis type="number" tickFormatter={fmt} tick={{ fontSize: 11, fill: "var(--text-3)" }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 11.5, fill: "var(--text-2)" }} axisLine={false} tickLine={false} interval={0} />
          <Tooltip
            cursor={{ fill: "var(--surface-hover)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const d = payload[0].payload as BarDatum;
              return (
                <div className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[12px] shadow-md">
                  <p className="font-medium text-text">{d.label}</p>
                  <p className="tabular text-text-2">{fmt(d.value)}</p>
                  {d.secondary !== undefined && secondaryLabel ? (
                    <p className="tabular text-text-3">
                      {secondaryLabel}: {fmt(d.secondary)}
                    </p>
                  ) : null}
                  {d.count !== undefined ? <p className="tabular text-text-3">{d.count} records</p> : null}
                </div>
              );
            }}
          />
          <Bar dataKey="value" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={18} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
