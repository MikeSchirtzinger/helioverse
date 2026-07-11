import { useMemo, useState } from 'react';
import {
  answerKnowledgeQuestion,
  CAUSAL_STEPS,
  getCausalStep,
  type CausalStepId,
} from './knowledge';

export function LearningPanel({
  activeStep,
  onStepChange,
  onExit,
}: {
  activeStep: CausalStepId;
  onStepChange: (step: CausalStepId) => void;
  onExit: () => void;
}) {
  const [question, setQuestion] = useState('');
  const matches = useMemo(() => answerKnowledgeQuestion(question), [question]);
  const selected = question.trim() && matches[0] ? matches[0] : getCausalStep(activeStep);

  return (
    <section className="hx-learn" aria-labelledby="hx-learn-title">
      <button type="button" className="hx-learn-exit" onClick={onExit}>
        <span aria-hidden="true">←</span>
        <span><strong>Back to solar system</strong><small>Close Learn and keep this stage selected</small></span>
      </button>
      <div className="hx-panel-intro">
        <p className="hx-kicker">Science bank</p>
        <h2 id="hx-learn-title">Ask the causal chain</h2>
        <p>Answers come from a bounded heliophysics knowledge bank. It does not invent an answer when no topic matches.</p>
      </div>

      <label className="hx-question">
        <span>Ask about a process, signal or colour</span>
        <input
          type="search"
          value={question}
          onChange={(event) => setQuestion(event.currentTarget.value)}
          placeholder="Why does southward Bz matter?"
        />
      </label>

      {question.trim() && matches.length === 0 ? (
        <div className="hx-empty" role="status">
          <strong>No grounded answer in this bank.</strong>
          <span>Try CME, Bz, L1, substorm, Kp, aurora colour, or OVATION.</span>
        </div>
      ) : (
        <article className="hx-lesson" data-provenance={selected.provenance}>
          <header>
            <span>{selected.index}</span>
            <div>
              <p>{selected.question}</p>
              <h3>{selected.title}</h3>
            </div>
          </header>
          <p className="hx-lesson-lead">{selected.plain}</p>
          <dl>
            <div><dt>Picture it</dt><dd>{selected.analogy}</dd></div>
            <div><dt>Mechanism</dt><dd>{selected.mechanism}</dd></div>
            <div><dt>Clock</dt><dd>{selected.timing}</dd></div>
            <div><dt>In the scene</dt><dd>{selected.watch}</dd></div>
            <div><dt>Grounded by</dt><dd><code>{selected.source}</code></dd></div>
          </dl>
          <button
            type="button"
            className="hx-text-action"
            onClick={() => {
              onStepChange(selected.id);
              onExit();
            }}
          >
            View this stage in the solar system
          </button>
        </article>
      )}

      <div className="hx-topic-list" aria-label="Knowledge topics">
        {CAUSAL_STEPS.map((step) => (
          <button
            key={step.id}
            type="button"
            className={step.id === selected.id ? 'is-active' : ''}
            onClick={() => {
              setQuestion('');
              onStepChange(step.id);
            }}
          >
            <span>{step.index}</span>
            {step.shortLabel}
          </button>
        ))}
      </div>
    </section>
  );
}
