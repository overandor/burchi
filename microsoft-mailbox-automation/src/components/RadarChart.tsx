"use client";

import { useEffect, useState } from "react";

interface RadarChartProps {
  data: { label: string; value: number; max?: number }[];
  size?: number;
  color?: string;
}

/**
 * RadarChart — animated SVG radar/spider chart for multi-dimensional scores.
 * Used for DCS breakdowns, evidence quality, and research reliability.
 */
export function RadarChart({ data, size = 240, color = "hsl(var(--primary))" }: RadarChartProps) {
  const [animated, setAnimated] = useState(false);
  const center = size / 2;
  const maxRadius = size / 2 - 40;
  const numAxes = data.length;

  useEffect(() => {
    const timer = setTimeout(() => setAnimated(true), 100);
    return () => clearTimeout(timer);
  }, []);

  function getPoint(index: number, value: number, max: number = 100) {
    const angle = (index / numAxes) * Math.PI * 2 - Math.PI / 2;
    const radius = animated ? (value / max) * maxRadius : 0;
    return {
      x: center + Math.cos(angle) * radius,
      y: center + Math.sin(angle) * radius,
    };
  }

  function getAxisEnd(index: number) {
    const angle = (index / numAxes) * Math.PI * 2 - Math.PI / 2;
    return {
      x: center + Math.cos(angle) * maxRadius,
      y: center + Math.sin(angle) * maxRadius,
    };
  }

  function getLabelPos(index: number) {
    const angle = (index / numAxes) * Math.PI * 2 - Math.PI / 2;
    const r = maxRadius + 20;
    return {
      x: center + Math.cos(angle) * r,
      y: center + Math.sin(angle) * r,
    };
  }

  const points = data.map((d, i) => {
    const p = getPoint(i, d.value, d.max || 100);
    return `${p.x},${p.y}`;
  }).join(" ");

  // Grid rings at 25%, 50%, 75%, 100%
  const gridLevels = [0.25, 0.5, 0.75, 1.0];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Grid rings */}
      {gridLevels.map((level) => {
        const ringPoints = data.map((_, i) => {
          const angle = (i / numAxes) * Math.PI * 2 - Math.PI / 2;
          return `${center + Math.cos(angle) * maxRadius * level},${center + Math.sin(angle) * maxRadius * level}`;
        }).join(" ");
        return (
          <polygon
            key={level}
            points={ringPoints}
            className="radar-grid"
            opacity={level === 1.0 ? 0.5 : 0.25}
          />
        );
      })}

      {/* Axes */}
      {data.map((_, i) => {
        const end = getAxisEnd(i);
        return (
          <line
            key={i}
            x1={center}
            y1={center}
            x2={end.x}
            y2={end.y}
            className="radar-axis"
          />
        );
      })}

      {/* Data polygon */}
      <polygon
        points={points}
        className="radar-fill"
        style={{ fill: `${color}25`, stroke: color }}
      />

      {/* Data points */}
      {data.map((d, i) => {
        const p = getPoint(i, d.value, d.max || 100);
        return (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={4}
            className="radar-point"
            style={{ fill: color }}
          />
        );
      })}

      {/* Labels */}
      {data.map((d, i) => {
        const pos = getLabelPos(i);
        return (
          <text
            key={i}
            x={pos.x}
            y={pos.y}
            className="radar-label"
            dominantBaseline="middle"
          >
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}
