/**
 * tonight-card.tsx — The "Tonight" aurora answer card
 *
 * Displays: verdict badge (Likely/Possible/Unlikely), probability %,
 * confidence, time window, look direction, activity label, delay badge,
 * degradation warning.
 */

import React from "react";
import type { TonightForecast, DegradedInfo } from "./types";
import type { Verdict } from "./go-look";

// ---------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------

interface VerdictBadgeProps {
  verdict: Verdict;
  score: number;
}

const VERDICT_STYLES: Record<
  Verdict,
  { bg: string; text: string; icon: string }
> = {
  Likely: {
    bg: "rgba(34, 197, 94, 0.18)",
    text: "#4ade80",
    icon: "🟢",
  },
  Possible: {
    bg: "rgba(234, 179, 8, 0.18)",
    text: "#facc15",
    icon: "🟡",
  },
  Unlikely: {
    bg: "rgba(239, 68, 68, 0.15)",
    text: "#f87171",
    icon: "🔴",
  },
};

function VerdictBadge({ verdict, score }: VerdictBadgeProps) {
  const s = VERDICT_STYLES[verdict];
  const pct = Math.round(score * 100);

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 16px",
        borderRadius: 12,
        background: s.bg,
        border: `1px solid ${s.text}40`,
        fontSize: 18,
        fontWeight: 700,
        color: s.text,
      }}
    >
      <span style={{ fontSize: 22 }}>{s.icon}</span>
      <span>{verdict.toUpperCase()}</span>
      <span style={{ fontWeight: 400, opacity: 0.8, marginLeft: 4 }}>
        {pct}%
      </span>
    </div>
  );
}

interface ProbabilityBarProps {
  probabilityPct: number;
  score: number;
  confidence: number;
}

function ProbabilityBar({
  probabilityPct,
  score,
  confidence,
}: ProbabilityBarProps) {
  const barPct = Math.min(100, Math.max(0, Math.round(score * 100)));

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: 13, color: "#a0a0b0" }}>Go-look score</span>
        <span style={{ fontSize: 13, color: "#d0d0e0", fontWeight: 600 }}>
          {barPct}% · confidence {Math.round(confidence * 100)}%
        </span>
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: "rgba(255,255,255,0.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${barPct}%`,
            borderRadius: 3,
            background:
              barPct >= 60
                ? "linear-gradient(90deg, #22c55e, #4ade80)"
                : barPct >= 30
                  ? "linear-gradient(90deg, #eab308, #facc15)"
                  : "linear-gradient(90deg, #ef4444, #f87171)",
            transition: "width 0.5s ease",
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 3,
        }}
      >
        <span style={{ fontSize: 11, color: "#666" }}>0%</span>
        <span style={{ fontSize: 11, color: "#666" }}>
          Auroral probability: {probabilityPct}%
        </span>
        <span style={{ fontSize: 11, color: "#666" }}>100%</span>
      </div>
    </div>
  );
}

interface TimeWindowBadgeProps {
  timeWindow: TonightForecast["timeWindow"];
  lookDirection: string;
}

function TimeWindowBadge({ timeWindow, lookDirection }: TimeWindowBadgeProps) {
  return (
    <div
      style={{
        display: "flex",
        gap: 16,
        marginTop: 10,
        flexWrap: "wrap" as const,
      }}
    >
      <div
        style={{
          padding: "6px 12px",
          borderRadius: 8,
          background: "rgba(255,255,255,0.06)",
          fontSize: 13,
          color: "#c0c0d0",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ opacity: 0.6 }}>🕐</span>
        <span>{timeWindow.label}</span>
      </div>
      <div
        style={{
          padding: "6px 12px",
          borderRadius: 8,
          background: "rgba(255,255,255,0.06)",
          fontSize: 13,
          color: "#c0c0d0",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ opacity: 0.6 }}>🧭</span>
        <span>{lookDirection}</span>
      </div>
    </div>
  );
}

interface DegradedBannerProps {
  degraded: DegradedInfo;
}

function DegradedBanner({ degraded }: DegradedBannerProps) {
  if (!degraded.isDegraded || !degraded.reason) return null;

  return (
    <div
      style={{
        marginTop: 12,
        padding: "8px 12px",
        borderRadius: 8,
        background: "rgba(239, 68, 68, 0.1)",
        border: "1px solid rgba(239, 68, 68, 0.25)",
        fontSize: 12,
        color: "#fca5a5",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span>⚠️</span>
      <span>{degraded.reason}</span>
    </div>
  );
}

interface DelayBadgeProps {
  delayLabel: string;
  isDegraded: boolean;
}

function DelayBadge({ delayLabel, isDegraded }: DelayBadgeProps) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 6,
        background: isDegraded
          ? "rgba(239, 68, 68, 0.12)"
          : "rgba(34, 197, 94, 0.12)",
        fontSize: 11,
        color: isDegraded ? "#fca5a5" : "#86efac",
        fontWeight: 500,
      }}
    >
      <span>{isDegraded ? "⚠️" : "✓"}</span>
      <span>{delayLabel}</span>
    </div>
  );
}

interface ActivityLabelProps {
  activityLabel: string;
}

function ActivityLabel({ activityLabel }: ActivityLabelProps) {
  const isStorm = activityLabel.includes("Storm");
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: isStorm ? "#fca5a5" : "#a0a0b0",
        textTransform: "uppercase",
        letterSpacing: 1,
      }}
    >
      {activityLabel}
    </span>
  );
}

// ---------------------------------------------------------------
// Main card
// ---------------------------------------------------------------

export interface TonightCardProps {
  forecast: TonightForecast;
  degraded: DegradedInfo;
  delayLabel: string;
  /** Location display name */
  locationLabel?: string;
}

export const TonightCard: React.FC<TonightCardProps> = ({
  forecast,
  degraded,
  delayLabel,
  locationLabel,
}) => {
  return (
    <div style={{ padding: "16px 20px" }}>
      {/* Header row */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: "#e0e0e0" }}>
            Tonight{locationLabel ? ` — ${locationLabel}` : ""}
          </span>
          <ActivityLabel activityLabel={forecast.activityLabel} />
        </div>
        <DelayBadge delayLabel={delayLabel} isDegraded={degraded.isDegraded} />
      </div>

      {/* Verdict */}
      <div style={{ marginBottom: 8 }}>
        <VerdictBadge verdict={forecast.verdict} score={forecast.score} />
      </div>

      {/* Probability bar */}
      <ProbabilityBar
        probabilityPct={forecast.probabilityPct}
        score={forecast.score}
        confidence={forecast.confidence}
      />

      {/* Time window + look direction */}
      <TimeWindowBadge
        timeWindow={forecast.timeWindow}
        lookDirection={forecast.lookDirection}
      />

      {/* Degradation banner */}
      <DegradedBanner degraded={degraded} />

      {/* Dominant limiter note */}
      <div style={{ marginTop: 8, fontSize: 11, color: "#666" }}>
        {forecast.dominantLimiter === "Daylight"
          ? "Too bright — wait for darkness"
          : forecast.dominantLimiter === "Oval"
            ? "Auroral activity is the limiting factor"
            : forecast.dominantLimiter === "CloudObserved"
              ? "Satellite shows clouds overhead"
              : forecast.dominantLimiter === "CloudForecast"
                ? "Cloud forecast is unfavorable"
                : forecast.dominantLimiter === "Moon"
                  ? "Moonlight may wash out faint aurora"
                  : ""}
      </div>
    </div>
  );
};

export default TonightCard;
