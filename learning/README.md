# Continual-learning truth surface

This directory is the persistent, versioned boundary between live evaluation
and any learned residual correction. It does not replace the production
physics baseline.

- `ledger/v1/events.jsonl` is an append-only record of NASA DONKI CME analyses
  and adjacent WSA–ENLIL outputs.
- `ledger/v1/outcomes.jsonl` contains only outcomes joined through exact DONKI
  graph links: CME → Earth IPS shock → GST observed Kp.
- `registry/registry.json` records the production baseline and every accepted or
  rejected residual challenger.
- `runs/` contains immutable offline gate/backtest reports.
- `schema/v1/` defines the checked record contracts.

The weekly workflow collects a rolling 30-day source window and merges new
revisions into the ledger. It will not fit a residual model until there are at
least 10 linked arrival outcomes and 10 linked Kp outcomes. Once that gate is
met, the latest 20% of each head is held out chronologically. Every CME linked
to the same physical shock or storm stays on one side of that split. A challenger
is registered only when it reduces MAE for both heads on those unseen rows. Even a
registered challenger stays in shadow; WSA–ENLIL plus DBM remains production
until a separate, explicit promotion decision.

Local collection against a running Vite proxy keeps the NASA key out of the
process environment:

```bash
corepack pnpm learning:collect -- --base-url=http://127.0.0.1:3000/donki
corepack pnpm learning:train
corepack pnpm check:learning
```

Scheduled collection reads `NASA_DONKI_KEY` from the GitHub Actions secret.
