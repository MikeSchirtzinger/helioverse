/**
 * aurora-map.tsx — Aurora oval render on a polar projection
 *
 * Renders the OVATION-derived auroral oval, user pin, viewline (equatorward
 * edge), and a day/night terminator band on an azimuthal equidistant north-
 * polar projection. All coordinates are derived from the snapshot fixture
 * data via the useAurora hook.
 *
 * The map is pure SVG — zero external dependencies beyond React.
 */

import React from "react";
import type { AuroraMapState, OvalPoint, UserLocation } from "./types";

// ---------------------------------------------------------------
// Projection helpers
// ---------------------------------------------------------------

const DEFAULT_SIZE = 340;
const PADDING = 10;
const CENTER = DEFAULT_SIZE / 2;
const RADIUS = CENTER - PADDING;

/**
 * Azimuthal equidistant projection from North Pole.
 * colat_deg = 90 - lat; radius on map = colat_deg / 90 * RADIUS
 */
function polarProject(
  latDeg: number,
  lonDeg: number,
): { x: number; y: number } {
  const colat = 90 - latDeg;
  if (colat < 0) {
    // Southern hemisphere — project symmetrically
    const rad = (Math.abs(colat) / 90) * RADIUS;
    const theta = ((lonDeg - 90) * Math.PI) / 180;
    return {
      x: CENTER + rad * Math.cos(theta),
      y: CENTER + rad * Math.sin(theta),
    };
  }
  const rad = (colat / 90) * RADIUS;
  const theta = ((lonDeg - 90) * Math.PI) / 180;
  return {
    x: CENTER + rad * Math.cos(theta),
    y: CENTER + rad * Math.sin(theta),
  };
}

/**
 * Convert an array of oval points to an SVG path string (closed polygon).
 */
function pointsToSvgPath(points: OvalPoint[]): string {
  if (points.length === 0) return "";
  const parts: string[] = [];
  for (const pt of points) {
    const { x, y } = polarProject(pt.latDeg, pt.lonDeg);
    parts.push(parts.length === 0 ? `M${x},${y}` : `L${x},${y}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

// ---------------------------------------------------------------
// Night-side shading band (approximate terminator)
// ---------------------------------------------------------------

/**
 * Draw a "night shadow" wedge on the map. This is an approximation:
 * the terminator forms a great circle dividing day from night. On a
 * polar projection, this appears as a curved band.
 *
 * In v1, this is a simplified fixed rendering centered on the UTC
 * midnight meridian. Post-v1: the WASM sky_state() will compute the
 * precise terminator for the snapshot time.
 */
function nightShadowPath(): string {
  // Approximate: shade the "night half" of the polar map
  // This is the hemisphere opposite the sun (roughly centered on
  // local midnight meridian ~180° from the sun at the snapshot time).
  //
  // For the fixed rendering we shade a 140° wedge centered on lon=0
  // (approximate midnight in June).
  const cx = CENTER;
  const cy = CENTER;
  const r = RADIUS;
  const angle = 140; // degrees of night side
  const startAngle = -70; // centered roughly on midnight

  const a1 = ((startAngle - 90) * Math.PI) / 180;
  const a2 = ((startAngle + angle - 90) * Math.PI) / 180;

  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const x2 = cx + r * Math.cos(a2);
  const y2 = cy + r * Math.sin(a2);

  return `M${cx},${cy} L${x1},${y1} A${r},${r} 0 0,1 ${x2},${y2} Z`;
}

// ---------------------------------------------------------------
// Grid lines (lat/lon reference)
// ---------------------------------------------------------------

function GridLines() {
  const lines: React.ReactNode[] = [];

  // Latitude circles: every 15°
  for (let lat = 30; lat < 90; lat += 15) {
    const r = ((90 - lat) / 90) * RADIUS;
    lines.push(
      <circle
        key={`lat-${lat}`}
        cx={CENTER}
        cy={CENTER}
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={1}
      />,
    );
    // Label
    if (lat >= 50) {
      lines.push(
        <text
          key={`lat-label-${lat}`}
          x={CENTER + 5}
          y={CENTER - r - 3}
          fill="rgba(255,255,255,0.2)"
          fontSize={8}
        >
          {lat}°
        </text>,
      );
    }
  }

  // Longitude lines: every 30° (selected)
  for (let lon = 0; lon < 360; lon += 30) {
    const theta = ((lon - 90) * Math.PI) / 180;
    const x2 = CENTER + RADIUS * Math.cos(theta);
    const y2 = CENTER + RADIUS * Math.sin(theta);
    lines.push(
      <line
        key={`lon-${lon}`}
        x1={CENTER}
        y1={CENTER}
        x2={x2}
        y2={y2}
        stroke="rgba(255,255,255,0.04)"
        strokeWidth={1}
      />,
    );
  }

  return <g>{lines}</g>;
}

// ---------------------------------------------------------------
// User pin
// ---------------------------------------------------------------

interface UserPinProps {
  location: UserLocation;
}

function UserPin({ location }: UserPinProps) {
  const { x, y } = polarProject(location.latDeg, location.lonDeg);

  return (
    <g>
      {/* Pulse ring */}
      <circle
        cx={x}
        cy={y}
        r={10}
        fill="none"
        stroke="#60a5fa"
        strokeWidth={2}
        opacity={0.4}
      >
        <animate
          attributeName="r"
          from={6}
          to={14}
          dur="2s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          from={0.5}
          to={0}
          dur="2s"
          repeatCount="indefinite"
        />
      </circle>
      {/* Pin dot */}
      <circle
        cx={x}
        cy={y}
        r={4}
        fill="#60a5fa"
        stroke="#1e3a5f"
        strokeWidth={1.5}
      />
      {/* Label */}
      <text
        x={x + 8}
        y={y - 6}
        fill="#93c5fd"
        fontSize={10}
        fontWeight={500}
        style={{ textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}
      >
        {location.label ??
          `${location.latDeg.toFixed(1)}°, ${location.lonDeg.toFixed(1)}°`}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------
// Hemisphere label
// ---------------------------------------------------------------

function NorthPoleLabel() {
  return (
    <text
      x={CENTER}
      y={CENTER + 4}
      textAnchor="middle"
      fill="rgba(255,255,255,0.3)"
      fontSize={10}
    >
      NP
    </text>
  );
}

// ---------------------------------------------------------------
// Map legend
// ---------------------------------------------------------------

interface LegendProps {
  maxProbability: number;
  hemisphericPowerGw: number | null;
}

function Legend({ maxProbability, hemisphericPowerGw }: LegendProps) {
  const steps = 4;
  const items: React.ReactNode[] = [];

  for (let i = 0; i < steps; i++) {
    const pct = Math.round(((maxProbability * (i + 1)) / steps) * 100);
    const alpha = 0.2 + (0.6 * (i + 1)) / steps;
    const green = Math.round(100 + (155 * (i + 1)) / steps);
    items.push(
      <div
        key={i}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          fontSize: 10,
          color: "#a0a0b0",
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: 3,
            background: `rgba(34, 197, 94, ${alpha.toFixed(2)})`,
            border: "1px solid rgba(74, 222, 128, 0.3)",
          }}
        />
        <span>{pct}%</span>
      </div>,
    );
  }

  return (
    <div
      style={{
        position: "absolute" as const,
        bottom: 8,
        right: 8,
        display: "flex",
        flexDirection: "column" as const,
        gap: 2,
        padding: "6px 8px",
        background: "rgba(0,0,0,0.5)",
        borderRadius: 6,
      }}
    >
      {items}
      {hemisphericPowerGw !== null && (
        <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>
          HP: {hemisphericPowerGw.toFixed(0)} GW
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Main map component
// ---------------------------------------------------------------

export interface AuroraMapProps {
  mapState: AuroraMapState;
  size?: number;
}

export const AuroraMap: React.FC<AuroraMapProps> = ({
  mapState,
  size = DEFAULT_SIZE,
}) => {
  const {
    ovalBoundary,
    ovalInnerBoundary,
    viewline,
    userLocation,
    maxProbability,
    hemisphericPowerGw,
  } = mapState;

  const ovalPath = pointsToSvgPath(ovalBoundary);
  const innerOvalPath = pointsToSvgPath(ovalInnerBoundary);
  const viewlinePath = pointsToSvgPath(viewline);

  // Use the map-state terminator path when non-empty; fall back to the
  // local static approximation if the hook hasn't computed one.
  const nightPath =
    mapState.terminatorPath && mapState.terminatorPath.trim() !== ""
      ? mapState.terminatorPath
      : nightShadowPath();

  // Scale the SVG
  const scale = size / DEFAULT_SIZE;
  const cx = CENTER * scale;
  const cy = CENTER * scale;
  const r = RADIUS * scale;

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        overflow: "hidden",
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ display: "block" }}
      >
        {/* Background circle (ocean) */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="#0a1628"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={1}
        />

        {/* Grid lines */}
        <GridLines />

        {/* Coastline hint — minimal outline */}
        <circle
          cx={cx}
          cy={cy}
          r={r * 0.45}
          fill="none"
          stroke="rgba(255,255,255,0.04)"
          strokeWidth={1}
        />

        <g transform={`scale(${scale})`}>
          {/* Night shadow wedge */}
          <path d={nightPath} fill="rgba(5, 10, 30, 0.55)" stroke="none" />

          {/* Auroral oval — filled ring */}
          <path
            d={ovalPath}
            fill={`rgba(34, 197, 94, ${(0.15 + maxProbability * 0.35).toFixed(2)})`}
            stroke="rgba(74, 222, 128, 0.6)"
            strokeWidth={2}
          />

          {/* Auroral oval — inner glow */}
          <path
            d={innerOvalPath}
            fill="rgba(10, 20, 40, 0.4)"
            stroke="rgba(74, 222, 128, 0.3)"
            strokeWidth={1}
            strokeDasharray="4 3"
          />

          {/* Viewline (equatorward edge, dashed) */}
          <path
            d={viewlinePath}
            fill="none"
            stroke="#facc15"
            strokeWidth={1.5}
            strokeDasharray="6 4"
            opacity={0.7}
          />

          {/* User pin */}
          {userLocation && <UserPin location={userLocation} />}

          {/* North pole marker */}
          <NorthPoleLabel />
        </g>

        {/* Map border ring */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={2}
        />
      </svg>

      {/* Legend overlay */}
      <Legend
        maxProbability={maxProbability}
        hemisphericPowerGw={hemisphericPowerGw}
      />
    </div>
  );
};

export default AuroraMap;
