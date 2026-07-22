# AI Challenge: Reinventing the Citizen Experience — Technical Approach

**Olotalk · ALL IN 2026 · City of Montréal**
2026-07-15.

---

## 1. We measured the problem before we designed a solution

Every number below is computed from the City's own published data — principally the
**Requêtes 311** dataset (`donnees.montreal.ca/dataset/requete-311`, CC-BY 4.0),
**3,034,731 requests** from January 2022 to July 2026 — cross-referenced against the
**Base de données des actifs de voirie**, the **Géobase**, the **Réseau artériel
administratif (RAAV)**, the **Limites administratives de l'agglomération**, and the
MTQ's **Réseau routier — RTSS**.

We did this first, and it changed our design. The brief's framing — photo in,
category out — does not describe the expensive part of the problem.

**Reproduction.** `node shadow/montreal-challenge-verify.mjs` re-derives
every figure in this document from the live CKAN API and reports PASS/DRIFT/FAIL
against the values measured 2026-07-15. It completes in **~23 seconds** and is
dependency-free: the aggregation runs *server-side in the City's own datastore* (a
`GROUP BY` collapses the 1,529,458 evaluated requests into 11,833 counted cells —
lossless for this question), so nothing here depends on our copy of the data.
Anyone, including the City, can check our arithmetic against the source of record.
Field notes and dead ends: `findings.md`.

### Fact 1 — the classification system is large *and it moves*

The brief offers examples ("pothole, waste, graffiti"). `ACTI_NOM` contains **993
distinct values across the period**. But the more useful figure is smaller and more
interesting: **252 of those are retired**, marked with a leading asterisk
(`*Réclamation` runs to 2025-10-22; `Réclamation` begins 2025-10-23 — a clean
rename). Excluding retirements and churn, **513 distinct categories were used on
service requests in 2026 alone**.

Five hundred is still two orders of magnitude past a dropdown. But the churn is the
sharper point: **a classifier trained on 2022 labels would be emitting
`*Réclamation` today.** The taxonomy is a living document maintained by the City,
not a fixed label set — and the City's own methodology warns that *« des
arrondissements utilisent des catégories supplémentaires qui leur sont
spécifiques »*, so it is not even one flat citywide list.

### Fact 2 — the category does not name the owner

`Nid-de-poule` — a single category, 55,916 service requests — is handled by **19
distinct responsible units**. `Collecte de déchets` spans 21, `Feux de circulation -
Entretien` 21, `Occupation du domaine public` 20. Knowing the category tells you
what the work *is*. It does not tell you whose work it is.

### Fact 3 — the routing is barely an AI problem

We tested this directly, on **1,529,458 located service requests across 901
categories**, against four years of the City's actual routing decisions:

| Rule | Uses | In-sample | **Held out (2025–26, policy fit on 2022–24)** |
|---|---|---|---|
| **A** — geographic territory alone | a containment test | 90.33% | **90.95%** (516,486 / 567,859) |
| **B** — Rule A, plus one switch per category: *is this class owned geographically, or by a fixed unit?* | a containment test and a lookup table | 97.55% | **97.27%** (552,333 / 567,859) |

Neither rule uses a photo, a description, or a model of any kind. Both hold up out
of sample — Rule A is *better* on held-out data than in-sample.

> **Three denominators — do not conflate them.** This document reports numbers over
> three different populations, and the headline rests on the smallest.
> **3,034,731** is every request in the dataset, scanned in full for the taxonomy,
> channel-mix and NATURE figures — nothing is sampled. **1,529,458** is the located
> service requests (`NATURE='Requete'`, geocoded, excluding the BAM-pinned rows)
> that the in-sample rules are measured on. **567,859** is the 2025–26 held-out
> slice that **97.27% and 90.95% actually rest on**, with the policy fit only on
> 2022–24.

Rule B's switch flips for **142 of 901 categories**, and it encodes real municipal
structure. Montréal runs several asset classes as a **shared service**: **74.7% of
every traffic-signal request on the island** — arriving from 21 different
territories — is handled by **Rosemont–La Petite-Patrie**. Streetlights: 66.9%, from
23 territories. Priority sign maintenance: 73.3%. (The switch is not always
meaningful: a borough-local service like bag distribution is "fixed" and
"geographic" at once. The genuinely non-geographic classes are led by the shared
services above.)

**This is the trap in the challenge.** A system that correctly identifies a broken
traffic light in Ville-Marie and routes it to Ville-Marie **is wrong** — the answer
is Rosemont, three times out of four. No photo classifier can know that. No
containment test can know that. Only the asset's ownership knows that.

---

## 2. The architecture: resolve the asset, derive everything else

Conventional approach:

```
photo ──► classifier ──► category ──► department lookup ──► work order
```

Ours:

```
photo + location + voice/text
        │
        ▼
  ASSET RESOLUTION ──► a specific object: tronçon 1042318 · tree #3341-22 · catch basin
        │
        ├──► owner        = reconciled across authorities  → routing, incl. "not ours"
        ├──► category     = retrieved (asset class + defect) against the live catalog
        ├──► location     = the object, not a coordinate
        ├──► duplicate    = same asset, across requests (not within one)
        └──► priority     = how many separate requests name this asset this month
```

Asset resolution is **entity resolution against a registry** — retrieval over a
corpus, which is the system Olotalk already operates. It is not a classifier, and
that distinction is what makes both the tail and the churn tractable: you cannot
retrain a 513-class classifier every time a borough renames a category, but a
retrieval index over the current catalog absorbs a rename for free.

### The AI's actual job

The model does exactly two things, and neither of them is routing:

1. **Asset class + defect from the photo** — a vision-language model grounded in the
   City's catalog rather than a fixed label set: *road surface / pothole*, *tree /
   fallen branch*, *catch basin / blocked*. This is where the photo earns its keep.
2. **Retrieve the category** for that (asset class, defect) pair against the live
   catalog, using the citizen's own words as additional signal.

Everything downstream is a deterministic join.

### One question, only when it changes the answer

We do not present a form. When resolution is ambiguous *and* the ambiguity changes
the routing, the system asks exactly one question — *"Is the pothole in the traffic
lane or the bike lane?"* — chosen because its answer flips the department. If the
answer changes nothing, we don't ask.

---

## 3. The grounding guarantee

**The model never emits a department name.** It emits an asset. The reconciled
registry emits the department.

This is the core responsible-AI property of the design, and it is architectural
rather than aspirational:

- Routing is a **join with provenance**, not a model output. It cannot hallucinate a
  department, because no generative step is permitted to name one.
- Every routing decision carries a **citable reason**: this tronçon, this authority,
  this règlement. That is an audit trail a public administration can defend.
- The failure mode is **"I could not resolve this"** — detectable, refusable,
  routable to a human — rather than **confidently wrong**, which is the failure mode
  of a classifier and the one that costs the City a truck roll to an asset it does
  not own.

---

## 4. The jurisdiction answer does not exist yet. That is the opportunity.

Montréal's own pothole page instructs citizens: *"Is the pothole located on a
highway or service road? Contact the Ministère des Transports by dialling 511."*
**The City asks the citizen to perform the jurisdiction determination.**

We assumed, at first, that this was an unexploited data join. It is not. We checked,
and the finding reshaped our proposal:

> The Voirie asset database has a column named **`PROPRIETAIRE_REF`**. Its value
> dictionary permits `Ministère Transport Québec`, `Société Transport Montréal`,
> `Service des Grands Parcs`, and `Privé`. **On the 16,750 actual road-surface
> assets, those values are effectively absent** — the column is populated with the
> *territory the asset sits in*. Worse, the **autoroutes and bretelles are
> attributed to boroughs**: `Autoroute → Saint-Laurent` (60), `Autoroute →
> Sud-Ouest` (35), `Autoroute → Côte-des-Neiges–Notre-Dame-de-Grâce` (31). A naive
> join on the field named "owner" would dispatch a **provincial-highway pothole to a
> borough crew** — precisely the confident misroute §3 exists to prevent, on
> precisely the case montreal.ca says to dial 511 about. The layer is also frozen at
> `DATE_VERSION = 2020-05-30`.

**This is why the City still asks the citizen.** Its own data cannot answer the
question either. So the jurisdiction fact has to be *assembled*, from authorities
that disagree:

| Authority | Answers | Vintage / caveat |
|---|---|---|
| MTQ **RTSS** (live WFS, CC-BY) | Provincial network; its *scope* is the answer — presence ≈ not the City's. Carries `gestion` and `entretien` separately. | Live |
| **Limites administratives** | `TYPE` = *Arrondissement* ×19 vs *Ville liée* ×15 | Current |
| **RAAV** `ARTERE` | Règlement 02-003 central-council vs borough-council split | 2023, GPKG-only, contains flag errors |
| **311 behavioural record** | Four years of where the work actually went | The evidence base for Rule B |
| Voirie `PROPRIETAIRE_REF` | **Territory, not ownership** — do not use for jurisdiction | Frozen 2020 |

Reconciling these with **per-field provenance, and refusing when they conflict**, is
the work. Anyone can join a clean column. There isn't one. That reconciliation —
ingesting contradictory sources into one queryable, citable view and knowing when to
abstain — is precisely what Olotalk's stack does.

**The demand is real and currently unserved.** Even though no ville liée is ever a
responsible unit, and Westmount runs its own reporting form, **311 receives pothole
reports that geographically originate in villes liées** — Mont-Royal 169, Westmount
91, Dorval 20, and 31 more across seven other municipalities. Citizens do not know
where the boundary is; that is not a thing to expect of them. The City already has a
bucket for the general case: **`Organisme divers` — 47,578 requests, 47,577 of them
logged as `Information` rather than as work.** That is today's "belongs to someone
else" path, 1.6% of all traffic, and it is our baseline to beat.

---

## 5. Duplicates: the City already counts. Nobody groups.

We nearly proposed "duplicates are votes, and today the vote is discarded." That is
false, and the City's own schema says so. `PROVENANCE_TELEPHONE` is not a flag — the
dictionary defines it as *« Nombre de requérants différents via téléphone »*.
**202,271 service requests already carry more than one distinct requester**; 13,044
carry exactly four. Montréal merges duplicate reports into a single request and
preserves the count.

The gap is one level up. **The count is per-request; nothing groups across requests
to an asset.** Four separate requests naming the same catch basin over a year remain
four unrelated rows, because there is no asset identity to group them by. Resolve to
the asset and the grouping is exact — same object, same defect, same window, no
similarity threshold to tune — and the City gains a maintenance signal it cannot
currently assemble: not "this request had four callers," but "this asset has been
the subject of four requests this year."

---

## 6. Privacy: we mirror the City's own two-tier model

Montréal's 311 methodology states:

> *« Pour respecter la confidentialité des requérants, cette position géographique
> est ensuite obfusquée: les requêtes associées à des adresses ou installations
> particulières sont relocalisées au milieu du tronçon le plus près ayant une
> longueur de plus de 45 mètres. »*

The City operates **two tiers**: precise location internally, because that is how a
crew is dispatched; **tronçon-generalized** on publication, because that is the
granularity its privacy analysis blessed. We adopt the same two tiers rather than
inventing a third — precise for dispatch, tronçon-generalized for retention,
analytics, and anything published.

We state plainly what this does *not* claim: resolving to a specific asset is, for
some classes, **more identifying than the City's published granularity** — a street
tree fronts one house. Asset-level retention is therefore a posture that must be
agreed with the City's counsel under **Law 25**, per asset class, not something we
can assert by pointing at the obfuscation rule. What we can say is that Montréal has
already done the reasoning about location granularity as the privacy lever, and has
published where it landed; we start there rather than from zero.

The rest of the posture:

- **Redaction at intake.** Citizen photos of the public domain contain faces and
  licence plates. Detection and irreversible redaction happen before storage, not
  before display. We expect to be the only submission that raises this.
- **Voice is transcribed and discarded.** A recording is biometric-adjacent under
  Law 25; the transcript is not.
- **The corpus never leaves the perimeter.** Olotalk's embedding and vision models
  are already self-hosted — no third-party API sees ingested content.
- **Location is of the issue, not the reporter** — consistent with the City's own
  rule: *« La localisation concerne le lieu de la requête et non la localisation du
  requérant. »*

### Deployment and sovereignty

The Olotalk stack is a self-contained Compose bundle, and the inference endpoint is
configured by environment variable against an OpenAI-compatible interface. **Running
entirely inside the City's perimeter — including the answering model — is a
configuration change, not a rewrite.** We deploy on a ladder: shared multi-tenant →
per-tenant isolation → dedicated instance with Canadian residency → inside the
City's VPC → on-premises. The jury should assume any submission that cannot say this
will be routing citizen photographs, voice, and location through a foreign
jurisdiction on every request.

---

## 7. What we know we don't know

We would rather state these than have the jury find them.

- **An unknown share of our evaluation set is not citizen traffic.** The City's
  methodology warns: *« Certains arrondissements utilisent également la plateforme
  pour assigner des tâches internes… Le système ne permet pas de distinguer ce type
  de demande interne. »* Internal work orders are created *by* the unit that
  performs them, which **inflates Rule A in our favour**. We cannot size this.
- **Rule A may be partly tautological.** If `UNITE_RESP_PARENT` is itself
  auto-assigned from the coordinate by the City's system, then "geometry predicts
  the unit" is partly a restatement of that rule rather than a discovery. The
  shared-service exceptions (§1) show it is not *purely* geometric, and §9's
  argument rests on channel cost rather than accuracy — but the caveat stands.
- **Rule A is not a point-in-polygon as measured.** It uses the City's *precomputed*
  `ARRONDISSEMENT_GEO` column plus a 19-entry name-normalisation table. That is a
  fair proxy for a containment test, and we say so rather than implying we ran one.
- **Rule B is a fitted policy, not one bit per category.** It is a switch plus, for
  142 categories, the identity of the winning unit chosen by argmax. The held-out
  result (97.27%, fit on 2022–24, tested on 2025–26) is what defends it — not the
  parameter count.
- **Our ground truth is the final responsible unit.** The dataset does not expose
  reroutes, so we reproduce the endpoint of the City's process, not its intermediate
  decisions.
- **90.33% is a floor.** It was measured *through* the City's 45-metre obfuscation,
  which snaps reports to segment midpoints and skips segments under 45 m, injecting
  label noise we cannot remove. A phone's real GPS is strictly better.
- **Rule A scores 0% on the 2,417 requests originating in villes liées** — it
  predicts a unit that does not exist. Immaterial to the headline (0.16%) but a
  structural blind spot in exactly the jurisdiction path we are selling.
- **Pole ownership is not uniform and we cannot resolve it per-pole.**
  Hydro-Québec's data is zonal (443 polygons); in Pierrefonds and Dorval the
  pole-park manager is **Bell**, not HQ. HQ's open portal is **CC-BY-NC** — a real
  constraint on commercial deployment.
- **Bus shelters have no geodata anywhere.** Québecor's, under a contract reported to
  run to 2032, reachable at 514-ABRIBUS; we have not confirmed its 2026 status.
  Corroborating the gap: `Abribus - Nettoyage` has **exactly 1 record in 3,034,731**.
  We would route shelters by category, not geometry.
- **We have not read règlement 02-003**, only the City's authoritative paraphrase in
  the RAAV metadata. We would request it from the Service du greffe.
- **The Banque d'information 311 is now VPN-restricted.** The taxonomy we
  reconstructed from `ACTI_NOM` is a proxy for it, not a substitute. We would request
  access as a participant.
- **62,008 requests are pinned to a borough office** (`LOC_ERREUR_GDT=1`), excluded
  from every measurement above. Note that a large share are in-person counter
  submissions, so this is not purely "the City couldn't locate it."

---

## 8. Maturity: what exists today, what we build

**In production today (private beta):** multi-tenant ingestion and retrieval over a
living corpus; **self-hosted embeddings**; a vision pipeline that already runs image
→ VLM → structured extraction; a vector store; grounded generation with citation and
refusal; a conversational loop that asks clarifying questions.

**New for this challenge:** multi-authority reconciliation and the geospatial join;
speech recognition; the category retrieval index; photo redaction at intake.

**We do not claim** a municipal deployment or a government customer. Olotalk is in
private beta. Our answer to "demonstrated results" is not a logo — it is that we
measured this problem against 1.5 million of the City's own historical requests
before writing a line of proposal, held our headline out of sample, and are showing
the parts that don't flatter us, including the join we expected to work and which
does not.

---

## 9. Why this wins for the City, in the City's numbers

The brief asks for reduced categorization errors and faster routing. The data says
the prize is larger and elsewhere.

**82% of all 311 volume — 2,489,180 of 3,034,731 requests — still arrives by
telephone.** Mobile is 5.3%; the web is 3.0%.

And the City's routing is not sloppy — it is *highly regular*. That we could
reproduce **97.27% of it out of sample** with a containment test and a lookup table
is itself the evidence: a process this reducible is one being run consistently and
well by the people running it.

So the opportunity is not that Montréal's agents make mistakes. **It is that their
accuracy currently costs a phone call every single time.** We reproduce that
accuracy at zero marginal cost per request, and deliver a work order already
resolved to an asset, already grouped with the other requests naming that same
asset, already prioritised by how many separate citizens raised it, and already
rejected-with-an-explanation when it belongs to the MTQ, a ville liée, Bell,
Québecor, or a private owner.

Montréal's own agents already do this well. They should not have to do it 2.5
million times by phone.
