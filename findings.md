# Montréal open data — field notes, dead ends, and traps

**Companion to `proposal.md` · 2026-07-15**

The proposal necessarily leads with what works. This is the other half — **what cost
us the most to learn and appears nowhere in the pitch** — the complete record, kept so
the next person (including us in September) doesn't rediscover it.

Read this before touching Montréal's open data again.

Everything here is re-derivable via `shadow/montreal-challenge-verify.mjs`.

---

## 1. Fields that do not mean what they are named

This is the whole document in one table. Every row cost us at least one wrong
conclusion.

| Field / dataset | Looks like | Actually is |
|---|---|---|
| **`PROPRIETAIRE_REF`** (voirie assets) | The asset's **owner**. Its dictionary permits `Ministère Transport Québec`, `Société Transport Montréal`, `Service des Grands Parcs`, `Privé`. | **The territory the asset sits in.** Those four values appear on ~7 of 16,750 chaussée rows. **Autoroutes are attributed to boroughs** (`Autoroute`+`Bretelle` → Saint-Laurent ×121, Sud-Ouest ×68). Frozen at `DATE_VERSION = 2020-05-30`. **Useless for jurisdiction. Actively dangerous.** |
| **`LOC_ERREUR_GDT`** | A location-**error** flag. | *« Information sur la précision du positionnement de la requête avant l'obfuscation »* — `0` = located at the issue; **`1` = located at the borough's BAM service counter.** Not an error; a "filed in person, pinned to the desk" marker. 62,008 rows. |
| **`ARRONDISSEMENT`** | Where the issue is. | *« Arrondissement attitré pour régler la requête »* — **the borough assigned to fix it.** It can never name a ville liée, because Montréal never assigns work to one. |
| **`ARRONDISSEMENT_GEO`** | A near-duplicate of the above. | *« Arrondissement (géographiquement parlant) dans lequel l'intervention doit avoir lieu »* — **the geographic one.** This is the column for any "where did it originate" question. |
| **`PROVENANCE_TELEPHONE`** | A boolean: "arrived by phone." | *« Nombre de requérants différents via téléphone »* — **a count of distinct requesters**, ranging 0…14+. 202,271 requests have more than one. (For channel share, use `PROVENANCE_ORIGINALE`, which *is* categorical.) |
| **`geobase-gestion-troncon`** | Road-segment **management** → jurisdiction. | An **update changelog** (segment IDs, dates, operation types, version numbers). States explicitly: *« cet ensemble de données ne contient pas de l'information géospatiale »*. |
| **`ACTI_NOM`** | The live taxonomy: 993 categories. | 993 **all-time strings**, of which **252 are retired** with a leading `*` (`*Réclamation` → `Réclamation` on 2025-10-23, a clean rename), plus ~23 canonical-duplicate pairs. **513 were live on 2026 service requests.** |
| **`TYPE_LIEU_INTERV`** null on 1,391,651 rows | A gap the City can't fill. | *« Contrairement aux requêtes, les demandes d'information ne sont pas géoréférencées. »* The nulls are almost exactly the 1,391,644 `Information` rows. **On service requests it is populated on all but 7 of 1,643,087.** |

---

## 2. Dead ends we walked into

### The 51% that wasn't
Comparing `ARRONDISSEMENT` to `ARRONDISSEMENT_GEO` with naive string equality
reports a **50.9% mismatch** (835,576 of 1,641,613). It is almost entirely
formatting: `Mercier - Hochelaga-Maisonneuve` vs `Mercier-Hochelaga-Maisonneuve`.
Normalised (strip accents, uppercase, `ST`→`SAINT`, drop leading `LE`, remove
non-alphanumerics), the true divergence is **11,321 — 0.69%**.

And even 0.69% is **not an error rate**: the two fields mean different things (who
fixes it vs where it is), so divergence is often correct.

> **Lesson:** a shocking number from a string comparison is a string bug until proven
> otherwise.

### The circular zero
Filtering pothole requests to villes liées on `ARRONDISSEMENT` returns **0**. This
looks like a finding ("citizens never misreport across the boundary") and is
actually a **restatement of the column's definition** — that column names the unit
assigned to fix it, which is never a ville liée.

The right column, `ARRONDISSEMENT_GEO`, returns **311**: Mont-Royal 169, Westmount
91, Dorval 20, Côte-Saint-Luc 9, and 22 more across seven municipalities.
Westmount's single most common 311 category is `Nid-de-poule`.

> **Lesson:** the correct number supported the argument *better* than the wrong one.
> Convenient findings deserve more scrutiny, not less.

### The owner column that isn't
We found `PROPRIETAIRE_REF`, read its **value dictionary** — which lists exactly the
third parties we hoped for — and concluded "the jurisdiction join is a column." We
never checked whether the values were **populated**. They are not.

> **Lesson:** a column's existence and its permitted-value list are not evidence
> about its contents. Check the distribution, never the schema.

---

## 3. The best find: the obfuscation rule

**Not in the CKAN metadata.** `notes` says only *« il est important de prendre
connaissance de la méthodologie »*; `methodology` and `extras` are null and no
resource is a methodology document. The text is **rendered on the dataset page
only** — `https://donnees.montreal.ca/dataset/requete-311`, section "Production des
données":

> *« Pour respecter la confidentialité des requérants, cette position géographique
> est ensuite obfusquée: les requêtes associées à des adresses ou installations
> particulières sont **relocalisées au milieu du tronçon le plus près ayant une
> longueur de plus de 45 mètres**. »*

Also there, and load-bearing:

> *« La localisation concerne le lieu de la requête et non la localisation du
> requérant. »*
> *« Contrairement aux requêtes, les demandes d'information ne sont pas
> géoréférencées. »*

### Why it matters twice

**Architecturally:** the City's privacy team independently chose the **tronçon** as
the atomic safe unit of location — and that is the same unit jurisdiction attaches
to (RAAV `ARTERE`, MTQ RTSS segments). Privacy and routing want the same primitive.

**Forensically:** it explains every coordinate anomaly, and we mis-diagnosed all of
them before finding it:

| Observation | Our wrong read | The truth |
|---|---|---|
| 19,024 distinct coords for 56,296 potholes | heavy obfuscation / grid snapping | ~19k **tronçon midpoints**; many potholes per segment |
| 148 reports on one exact coordinate | a suspicious hotspot | 148 potholes on one road segment over 4 years |
| Two precision regimes coexist (9dp and 15dp) | two geocoding pipelines | two vintages of the obfuscation pass |
| Two hot points ~2 m apart | duplicate geocodes | the **same segment's midpoint recomputed** after a géobase version bump — which is why `geobase-gestion-troncon` exists at all |

**Consequence for any eval:** the published coordinates are segment midpoints. You
**cannot** validate metre-precision asset resolution against 311 history. You
**can** validate segment- and territory-level routing — which is the granularity
jurisdiction lives at anyway. It destroys precision we don't need and preserves
precision we do.

The 45 m threshold also injects noise: segments **shorter** than 45 m are skipped,
so some reports snap to a neighbouring street. Any accuracy measured through it is
a **floor**.

---

## 4. Confounds we could not eliminate

- **Internal work orders are indistinguishable from citizen requests.** The City:
  *« Certains arrondissements utilisent également la plateforme pour assigner des
  tâches internes… Le système ne permet pas de distinguer ce type de demande
  interne. »* These are created **by** the unit that performs them, which **inflates
  the geometry rule in our favour**. Unsizable.
- **Possible tautology.** If `UNITE_RESP_PARENT` is auto-assigned from the
  coordinate by the City's own system, "geometry predicts the unit" partly restates
  that rule rather than discovering it. The shared-service exceptions (Rosemont)
  prove it is not *purely* geometric, but we could not rule this out.
- **Ground truth is the endpoint only.** Reroutes are invisible; we reproduce where
  a request ended, not the decisions along the way.

---

## 5. API cookbook

```
Base:  https://donnees.montreal.ca/api/3/action
SQL:   GET /datastore_search_sql?sql=<urlencoded>
Fields: GET /datastore_search?resource_id=<id>&limit=1   ← the real column names
```

| Resource | ID |
|---|---|
| Requêtes 311 (2022 → present) | `2cfa0e06-9be4-49a6-b7f1-ee9f2363a872` |
| Voirie — chaussée agrégée (C22) | `b1519f66-b48d-4ab6-a79b-1830c6307775` |
| Voirie — liste de valeurs (dictionary) | `d277acf9-2c0c-4eaf-9e02-8c03eef690ce` |

**Gotchas, all hit for real:**

- **`/download/` paths 302 to `montreal-prod.storage.googleapis.com`.** In a
  sandboxed shell the cross-host redirect returns `RBAC: access denied` (19 bytes).
  The **API** works fine; only bulk file downloads are affected. Use the datastore,
  or fetch from an unsandboxed context.
- **The dataset *page* is not curl-able** — it times out / returns a shell. The
  methodology text (§3) needs a rendering fetch. It is not in the API.
- **`COUNT(*) FILTER (WHERE …)` silently returns nothing** on some datastore
  queries — no error, an empty record set. Use `SUM(CASE WHEN … THEN 1 ELSE 0 END)`
  or separate queries. This ate two debugging cycles.
- **The dictionary column is `PROPRIETAIRE_REF`, not `PROPRIETAIRE`.** The attribute
  *group* names in the dictionary are the literal column names on the asset tables.
- **Paginate grouped queries.** The datastore caps rows per response; the 311
  category×territory×unit aggregate is ~7.4k groups (~11.8k with a period split).

---

## 6. What is still unverified

Do not present any of these as fact without checking first.

- **Règlement 02-003** full text. We only have the City's authoritative paraphrase
  in the RAAV dataset metadata. `montreal.ca/reglements-municipaux` is a JS SPA;
  no PDF surfaced. → Service du greffe.
- **Banque d'information 311** (`www1.ville.montreal.qc.ca/banque311/`) — now
  **VPN-restricted (403)**, no Wayback snapshot. This is the *actual* taxonomy
  documentation; our 993-string reconstruction is a proxy. → request as a participant.
- **RAAV's 33 `ARTERE=1` segments lying inside villes liées** (22 of them
  Mont-Royal / Côte-de-Liesse). Found via the GPKG, which we could not re-download
  to confirm. Notably it **agrees** with an independent 311 finding — 169 Mont-Royal
  potholes handled by Montréal boroughs — so it is probably right.
- **PJCCI / CA25 / SSL as RTSS operators.** One pass found them in the `gestion`
  field; a later 800-feature sample returned only `MTQ`. Not disproven, not sampled.
- **The `AREQ` zone** covering Westmount in Hydro-Québec's pole KMZ — blank
  `Gestionnaire`, no legend. Possibly the CSEM buried network. **Unconfirmed —
  do not assume.**
- **Québecor's bus-shelter contract status in 2026.** Sources are the 2012–13
  announcements stating it runs to 2032. Transgesco returned 503.
- **HQ open data is CC-BY-NC.** A real constraint if any of this is commercialised.

---

## 7. The process lesson

Three of our four worst errors share one shape: **we trusted a schema, a
convenient number, or a plausible column name instead of looking at the
distribution.**

- The dictionary permitted MTQ → we assumed MTQ was in the data.
- A column named `ARRONDISSEMENT` → we assumed it meant "where it is."
- A column named `PROVENANCE_TELEPHONE` with value `1` → we assumed a boolean.

The fourth was the mirror image: we **disbelieved a correct finding** (the
obfuscation rule) because our own reasoning about the coordinates looked sound. It
was sound and wrong — the pattern we explained as address-geocoding was
tronçon-snapping.

> Look at the values. Always. The schema is a claim, not evidence.
