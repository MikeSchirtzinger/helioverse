import { EventDetailPanel, MetricStrip } from './components';
import { activeCmeEventFixture, degradedSnapshotFixture, resolvedCmeEventFixture, stormSnapshotFixture } from './fixtures';

export function PanelsStory() {
  return (
    <main style={{ display: 'grid', gap: 16, padding: 20, background: '#070a16' }}>
      <MetricStrip snapshot={stormSnapshotFixture} title="Storm fixture metric strip" />
      <EventDetailPanel event={activeCmeEventFixture} />
      <MetricStrip snapshot={degradedSnapshotFixture} title="Degraded L1 fixture metric strip" />
      <EventDetailPanel event={resolvedCmeEventFixture} />
    </main>
  );
}

export default PanelsStory;
