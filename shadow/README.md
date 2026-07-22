# Montréal routing shadow-run

**A frozen routing policy, scored every day against the City of Montréal's own
decisions — in the open, reproducible by anyone.**

📊 **Live scorecard:** <https://etobicoke.github.io/reinventer-acheminement-montreal/shadow/scorecard.html> — regenerated daily.

This repository is the routing half of Olotalk's submission to the **ALL IN 2026 AI
Challenge** (City of Montréal). The submission's thesis: routing a citizen report —
*"whose problem is this?"* — should be a **deterministic, citable resolver**, not a
model's guess. This repo is that claim, running live: a routing policy hash-frozen
on the City's pre-2025 history, scored daily against the City's actual routing, with
every prediction independently recomputable from public data.

## Reproduce every number

```bash
node shadow-run.mjs        # pulls the live City API, re-derives the whole scorecard
```

No dependencies (Node ≥ 18). It fails loudly if the committed policy hash no longer
matches its own rules.

## The integrity claim — stated precisely

A juror who works with the 311 data will test these sentences. They are written to
survive that.

1. **The policy is provably not retrofitted.** The routing table is fit *only* on
   requests created before `FREEZE_CUTOFF` (2025-01-01 — i.e. 2024 and earlier),
   then hashed (sha256, in `policy.json`). The table cannot have been tuned to any
   later request, because those requests did not exist when the hash was minted. The
   fit and backtest windows partition cleanly at 2025-01-01 — no gap, no overlap.
2. **A prediction is a pure, public function.** `predict(policy, category,
   territory)` reads nothing but the frozen table and two public columns of the
   request. No model weights, no free parameters, nothing hidden. Anyone recomputes
   every prediction from the same inputs and gets the same answer — nothing to fake.
3. **The ledger is time-stamped by git.** Each run writes `predictions/<date>.json`
   and regenerates the scorecard; the daily commit is the proof-of-time. **This
   repo's public commit history is the ledger.**
4. **Tampering is self-detecting.** Every run rehashes the stored policy and refuses
   to score if it no longer matches its own rules. One altered routing rule ⇒ a
   different hash ⇒ a hard stop.

## What it deliberately does **not** claim

- It does **not** claim to predict a routing *before the City makes it*. The 311
  open data publishes each request with its responsible unit already attached
  (verified: 68,776 / 68,776 recent located requests arrive routed). The claim is
  the narrower, checkable one above — not "we beat the City to it."
- It scores the **routing resolver only** — the "whose is it?" layer. It does not
  score photo/voice perception; there are no photos in the 311 record. Perception is
  demonstrated separately.
- Ground truth is the City's *final* responsible unit; reroutes along the way are
  not visible in this dataset.

## The two tiers on the scorecard

| Tier | Window | What it proves | N (2026-07-21) |
|---|---|---|---|
| **Held-out backtest** | created 2025-01-01 → 2026-07-21 | the frozen policy generalizes to a large body of requests it never saw | 585,918 → **97.27%** |
| **Prospective · live** | created after the shadow run began (2026-07-21) | it keeps working on requests that did not exist at submission — and cannot have | 0 and counting |

The backtest is the evidence for day one. The prospective tier is small at first
(the feed publishes ~a day behind) and **compounds**: by the September 16–17 jury it
is a two-month live track record accumulated in this repo's commits.

A companion verifier in the Olotalk repository proves the proposal's *static*
numbers against the same City API today; this repo proves them **going forward**.

## How it stays live

`.github/workflows/shadow.yml` runs `shadow-run.mjs` on a daily cron and commits the
new ledger entry + regenerated scorecard back to the repo — no babysitting. Manual
runs: Actions tab → *shadow-run* → *Run workflow*, or `node shadow-run.mjs` locally.

## Files

| File | Role |
|---|---|
| `shadow-run.mjs` | the harness — self-contained, dependency-free (Node ≥ 18) |
| `policy.json` | the frozen table + its sha256. **Committed. Never hand-edit.** |
| `predictions/<date>.json` | one immutable ledger entry per run — the proof-of-time |
| `scorecard.html` / `index.html` | the jury-facing page (identical; `index.html` is the Pages entry point) |
| `scorecard.json` | machine-readable scorecard |
| `.github/workflows/shadow.yml` | the daily automation |

Data: Requêtes 311 (`donnees.montreal.ca`, CC-BY 4.0 · © Ville de Montréal). Code: MIT.
