/**
 * TypeScript types derived from contracts/schemas/alert-subscription.schema.json
 * Wave-0 FROZEN — do not modify.
 */

import type { IsoUtc } from './snapshot';

export interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface AlertLocation {
  lat_deg: number;
  lon_deg: number;
}

export interface AuroraTonightThreshold {
  enabled: boolean;
  min_go_look_score: number;
}

export interface BzTurnThreshold {
  enabled: boolean;
  bz_south_nt: number;
  min_sustained_minutes: number;
}

export interface AlertThresholds {
  aurora_tonight: AuroraTonightThreshold;
  bz_turn: BzTurnThreshold;
  kp_min?: number | null;
}

export interface AlertSubscription {
  schema_version: string;
  subscription_id: string;
  created_at: IsoUtc;
  push: PushSubscription;
  location: AlertLocation;
  thresholds: AlertThresholds;
}
