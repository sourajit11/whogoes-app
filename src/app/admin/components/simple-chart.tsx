"use client";

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface ChartData {
  label: string;
  value: number;
}

interface SimpleChartProps {
  data: ChartData[];
  color?: string;
  type?: "bar" | "line" | "area";
  height?: number;
}

export default function SimpleChart({
  data,
  color = "#6366f1",
  type = "bar",
  height = 256,
}: SimpleChartProps) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-zinc-400"
        style={{ height }}
      >
        No data available
      </div>
    );
  }

  const commonProps = {
    data,
    margin: { top: 8, right: 8, bottom: 0, left: -16 },
  };

  const xAxisProps = {
    dataKey: "label" as const,
    tick: { fontSize: 11, fill: "#a1a1aa" },
    axisLine: false,
    tickLine: false,
  };

  const yAxisProps = {
    tick: { fontSize: 11, fill: "#a1a1aa" },
    axisLine: false,
    tickLine: false,
  };

  const gridProps = {
    strokeDasharray: "3 3",
    stroke: "#27272a",
    opacity: 0.3,
  };

  const tooltipProps = {
    contentStyle: {
      backgroundColor: "#18181b",
      border: "1px solid #3f3f46",
      borderRadius: "8px",
      fontSize: "12px",
      color: "#fafafa",
    },
  };

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {type === "bar" ? (
          <BarChart {...commonProps}>
            <CartesianGrid {...gridProps} />
            <XAxis {...xAxisProps} />
            <YAxis {...yAxisProps} />
            <Tooltip {...tooltipProps} />
            <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
          </BarChart>
        ) : type === "line" ? (
          <LineChart {...commonProps}>
            <CartesianGrid {...gridProps} />
            <XAxis {...xAxisProps} />
            <YAxis {...yAxisProps} />
            <Tooltip {...tooltipProps} />
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              dot={{ r: 3, fill: color }}
            />
          </LineChart>
        ) : (
          <AreaChart {...commonProps}>
            <CartesianGrid {...gridProps} />
            <XAxis {...xAxisProps} />
            <YAxis {...yAxisProps} />
            <Tooltip {...tooltipProps} />
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              fill={color}
              fillOpacity={0.15}
              strokeWidth={2}
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
