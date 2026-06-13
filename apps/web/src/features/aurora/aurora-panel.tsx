/**
 * aurora-panel.tsx — Main aurora feature panel
 *
 * Composes the tonight card and the aurora oval map into a single panel.
 * Accepts a Snapshot fixture as input (fixture-driven development per the
 * Wave-1 contracts-first rule). In production this will be fed by the
 * periodic snapshot poll.
 *
 * This is the public-facing component that the App shell renders into
 * the #aurora-panel section.
 */

import React from "react";
import type { Snapshot } from "./snapshot-local";
import { useAurora } from "./use-aurora";
import type { UserLocation } from "./types";
import { TonightCard } from "./tonight-card";
import { AuroraMap } from "./aurora-map";

// ---------------------------------------------------------------
// Props
// ---------------------------------------------------------------

export interface AuroraPanelProps {
  /** Snapshot fixture (in production: latest polled snapshot). */
  snapshot: Snapshot;
  /** User's set location (null = use default Reykjavík). */
  userLocation?: UserLocation | null;
  /** Show NOAA comparison toggle (hidden until W2-I3 integration). */
  showNoaaComparison?: boolean;
}

// ---------------------------------------------------------------
// Component
// ---------------------------------------------------------------

export const AuroraPanel: React.FC<AuroraPanelProps> = ({
  snapshot,
  userLocation = null,
}) => {
  const { forecast, mapState, degraded, delayLabel } = useAurora({
    snapshot,
    userLocation,
  });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background:
          "linear-gradient(180deg, rgba(10, 15, 30, 0.95) 0%, rgba(8, 12, 24, 0.98) 100%)",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 0,
        }}
      >
        {/* Tonight card — left side */}
        <div style={{ flex: "1 1 320px", minWidth: 280 }}>
          <TonightCard
            forecast={forecast}
            degraded={degraded}
            delayLabel={delayLabel}
            locationLabel={mapState.userLocation?.label}
          />
        </div>

        {/* Aurora map — right side */}
        <div
          style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "8px 16px 8px 0",
          }}
        >
          <AuroraMap mapState={mapState} size={260} />
        </div>
      </div>

      {/* NOAA comparison note (placeholder for W2-I3) */}
      {mapState.hemisphericPowerGw !== null && (
        <div
          style={{
            padding: "6px 20px 10px",
            fontSize: 11,
            color: "#555",
            borderTop: "1px solid rgba(255,255,255,0.03)",
            display: "flex",
            gap: 12,
          }}
        >
          <span>
            NOAA OVATION:{" "}
            {new Date(snapshot.ovation.forecast_time).toLocaleTimeString(
              "en-US",
              { hour: "2-digit", minute: "2-digit", timeZone: "UTC" },
            )}{" "}
            UTC
          </span>
          <span>
            Delay-corrected effective time:{" "}
            {new Date(
              snapshot.l1_to_earth.arriving_now_measured_at,
            ).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "UTC",
            })}{" "}
            UTC
          </span>
          <span>
            Observed:{" "}
            {snapshot.sources.swpc_plasma.status === "ok"
              ? "live"
              : snapshot.sources.swpc_plasma.status}
          </span>
        </div>
      )}

      {/* Active events reference */}
      {snapshot.events_active.length > 0 && (
        <div
          style={{
            padding: "6px 20px 10px",
            fontSize: 11,
            color: "#666",
            borderTop: "1px solid rgba(255,255,255,0.03)",
          }}
        >
          Active events: {snapshot.events_active.join(", ")}
        </div>
      )}
    </div>
  );
};

export default AuroraPanel;
