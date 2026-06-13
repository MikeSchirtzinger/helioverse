/**
 * Fixture: snapshot-degraded.json
 * Stale plasma feed → fixed-delay fallback + nulls/gaps in series.
 */
import fixture from '../../../../contracts/fixtures/snapshot/snapshot-degraded.json';
import type { Snapshot } from '../types/snapshot';
export const snapshotDegraded = fixture as Snapshot;
