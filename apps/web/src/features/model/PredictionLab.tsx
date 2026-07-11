import { useEffect, useMemo, useState } from 'react';
import type { DonkiCme, DonkiGst, DonkiIps } from '@/scene/donki-feeds';
import { evaluatePredictions } from './evaluation';

function value(value: number | null, suffix = '', digits = 1): string {
  return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)}${suffix}`;
}

function utc(iso: string | null): string {
  if (!iso) return 'no ENLIL arrival';
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }) + ' UTC';
}

interface LearningStatus {
  schema_version: 'helioverse.learning-status.v1';
  generated_at: string | null;
  ledger_revision: string | null;
  ledger: { events: number; outcomes: number };
  gate: { arrival: number; kp: number; required: number; ready: boolean };
  residual: { state: string; model_id: string | null; reason?: string | null };
  production: { model_id: string; label: string };
}

function useLearningStatus(): LearningStatus | null {
  const [status, setStatus] = useState<LearningStatus | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/learning/status.json', { signal: controller.signal, cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((body: unknown) => {
        if (body && typeof body === 'object' && (body as LearningStatus).schema_version === 'helioverse.learning-status.v1') {
          setStatus(body as LearningStatus);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return status;
}

function refreshedAt(iso: string | null): string {
  if (!iso) return 'not collected';
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? 'timestamp unavailable'
    : parsed.toLocaleString('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }) + ' UTC';
}

export function PredictionLab({
  cmes,
  shocks,
  storms,
  loading,
  error,
}: {
  cmes: DonkiCme[] | null;
  shocks: DonkiIps[] | null;
  storms: DonkiGst[] | null;
  loading: boolean;
  error: string | null;
}) {
  const evaluation = useMemo(() => evaluatePredictions(cmes, shocks, storms), [cmes, shocks, storms]);
  const learning = useLearningStatus();
  const gate = learning?.gate ?? {
    arrival: evaluation.arrivalN,
    kp: evaluation.kpN,
    required: 10,
    ready: evaluation.calibrationReady,
  };
  const activePredictions = useMemo(() => (cmes ?? [])
    .filter((cme) => cme.hasEnlilRun)
    .sort((a, b) => (b.startUnix - a.startUnix))
    .slice(0, 4), [cmes]);

  return (
    <section className="hx-model" aria-labelledby="hx-model-title">
      <div className="hx-panel-intro">
        <p className="hx-kicker">Prediction lab</p>
        <h2 id="hx-model-title">Physics first. Learning only after outcomes.</h2>
        <p>The production baseline is WSA–ENLIL plus the verified drag model. A residual learner may correct systematic error only after DONKI links a prediction to a measured shock and storm outcome.</p>
      </div>

      <div className="hx-model-state" data-ready={gate.ready}>
        <div>
          <span>Residual model</span>
          <strong>{learning?.residual.state === 'registered_challenger' ? 'Shadow challenger' : 'Not trained'}</strong>
        </div>
        <p>
          {gate.ready && learning?.residual.reason === 'insufficient_complete_feature_rows'
            ? `The ledger has ${gate.arrival} arrival outcomes and ${gate.kp} Kp outcomes, but fewer than ${gate.required} complete feature rows per head. Missing measurements are withheld rather than filled.`
            : gate.ready && learning?.residual.reason === 'insufficient_independent_outcome_groups'
              ? `The ledger has ${gate.arrival} arrival outcomes and ${gate.kp} Kp outcomes, but there are not enough independent physical shocks and storms for a leakage-free holdout.`
              : gate.ready
            ? `The persistent ledger has ${gate.arrival} arrival outcomes and ${gate.kp} Kp outcomes. Any residual stays in shadow unless the scheduled offline fit improves both heads on chronological holdout data.`
            : `Training requires ${gate.required} arrival outcomes and ${gate.required} Kp outcomes. Persistent exact-link ledger: ${gate.arrival} arrival outcomes and ${gate.kp} Kp outcomes.`}
        </p>
        <p className="hx-ledger-meta">
          {learning
            ? `${learning.ledger.events} versioned prediction events · refreshed ${refreshedAt(learning.generated_at)} · production ${learning.production.label}`
            : 'Persistent ledger status unavailable; live-window metrics remain visible below.'}
        </p>
      </div>

      {error ? <div className="hx-feed-alert"><strong>Evaluation feed degraded</strong><span>{error}</span></div> : null}

      <div className="hx-eval-grid" aria-label="Model evaluation metrics">
        <EvalMetric label="Arrival MAE" value={value(evaluation.arrivalMaeHours, ' h')} sample={evaluation.arrivalN} />
        <EvalMetric label="Arrival bias" value={value(evaluation.arrivalBiasHours, ' h')} sample={evaluation.arrivalN} />
        <EvalMetric label="Kp MAE" value={value(evaluation.kpMae)} sample={evaluation.kpN} />
        <EvalMetric label="Kp bias" value={value(evaluation.kpBias)} sample={evaluation.kpN} />
      </div>

      <p className="hx-method-note">
        Exact graph links only: DONKI CME → Earth IPS shock → GST observed Kp. The metrics below are the current 30-day feed window; the training gate above is the persistent append-only ledger. Unlinked temporal coincidences are excluded rather than guessed.
      </p>

      <div className="hx-predictions">
        <header><h3>Recent model outputs</h3><span>{loading ? 'refreshing…' : `${activePredictions.length} WSA–ENLIL runs`}</span></header>
        {activePredictions.length ? activePredictions.map((cme) => (
          <article key={cme.activityID}>
            <div>
              <span>{cme.sourceLocation || cme.activityID.slice(0, 16)}</span>
              <strong>{cme.speed_kms == null ? 'speed unavailable' : `${Math.round(cme.speed_kms)} km/s`}</strong>
            </div>
            <dl>
              <div><dt>Arrival</dt><dd>{utc(cme.enlilShockIso)}</dd></div>
              <div><dt>Peak Kp</dt><dd>{cme.predictedKp == null ? 'unavailable' : `up to ${cme.predictedKp}`}</dd></div>
              <div><dt>Earth path</dt><dd>{cme.isEarthDirected ? 'glancing/direct impact flagged' : 'not flagged'}</dd></div>
            </dl>
            <p><span className="hx-prov hx-prov--modelled">modelled</span> WSA–ENLIL output; speed and direction originate in measured DONKI analysis.</p>
          </article>
        )) : (
          <div className="hx-empty"><strong>No WSA–ENLIL output in the 30-day window.</strong><span>This is a valid quiet state, not a demo fallback.</span></div>
        )}
      </div>
    </section>
  );
}

function EvalMetric({ label, value, sample }: { label: string; value: string; sample: number }) {
  return <div><span>{label}</span><strong>{value}</strong><em>n={sample} exact linked outcomes</em></div>;
}
