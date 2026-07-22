#!/usr/bin/env node
// Montréal AI Challenge (ALL IN 2026) — reproduction & verification harness.
//
// Re-derives EVERY quantitative claim in:
//   proposal.md  (+ proposal.html)
//   findings.md
// directly from the City of Montréal's live open-data API, and reports
// PASS / DRIFT / FAIL against the values documented on 2026-07-15.
//
// WHY THIS EXISTS
// The proposal's entire differentiator is "we measured this." A number in a PDF
// is an assertion; a number a judge can re-derive in 60 seconds is evidence.
// Anyone — including a City of Montréal official — can run this against the
// live portal and check our arithmetic.
//
// DRIFT IS EXPECTED, NOT A BUG. The 311 resource is "2022 à ce jour": it grows
// every day. Absolute row counts WILL diverge from the documented values over
// time. The *rates* (Rule A / Rule B accuracy, shared-service shares) are the
// load-bearing claims and are stable; they are checked with a tolerance. Counts
// are reported as DRIFT, not FAIL, when they only grow.
//
// Dependency-free by house convention: Node 22 has global fetch, and the CKAN
// datastore exposes SQL, so no client library earns its place here.
//
// Usage:
//   node shadow/montreal-challenge-verify.mjs           # all checks
//   node shadow/montreal-challenge-verify.mjs --quick   # skip the 1.5M-row eval
//   node shadow/montreal-challenge-verify.mjs --json    # machine-readable

const API = "https://donnees.montreal.ca/api/3/action";

// Resource IDs (CKAN). Stable identifiers, not derived from the portal UI.
const R311 = "2cfa0e06-9be4-49a6-b7f1-ee9f2363a872"; // Requêtes 311, 2022 → present
const R_VOIRIE_CHAUSSEE = "b1519f66-b48d-4ab6-a79b-1830c6307775"; // Voirie C22 — chaussée agrégée
const R_VOIRIE_DICT = "d277acf9-2c0c-4eaf-9e02-8c03eef690ce"; // Voirie — liste de valeurs

const QUICK = process.argv.includes("--quick");
const JSON_OUT = process.argv.includes("--json");

const results = [];
const log = (...a) => { if (!JSON_OUT) console.log(...a); };

/** Run SQL against the CKAN datastore. Returns records[]. */
async function sql(query) {
  const url = `${API}/datastore_search_sql?sql=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`CKAN HTTP ${res.status} for: ${query.slice(0, 120)}…`);
  const body = await res.json();
  if (!body.success) throw new Error(`CKAN error: ${JSON.stringify(body.error).slice(0, 200)}`);
  return body.result.records;
}

/** Page through a grouped query that may exceed the datastore's row cap. */
async function sqlPaged(select, pageSize = 25000) {
  const out = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await sql(`${select} LIMIT ${pageSize} OFFSET ${offset}`);
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

const n = (v) => Number(v);
const pct = (x) => `${(x * 100).toFixed(2)}%`;

/**
 * Territory / unit name normalisation.
 *
 * ARRONDISSEMENT_GEO says "Mercier-Hochelaga-Maisonneuve"; UNITE_RESP_PARENT
 * says "MERCIER - HOCHELAGA-MAISONNEUVE". Same place, different string. Naive
 * string equality reports a ~51% mismatch that is pure formatting — see
 * FINDINGS.md §"The 51% that wasn't".
 *
 * Verified collision-free: exactly 19 units map 1:1 onto the 19 boroughs, and
 * no unit normalises into a borough it is not.
 */
function norm(s) {
  if (!s) return "";
  let x = s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase();
  x = x.replace(/['.]/g, " ");
  let toks = x.split(/[^A-Z0-9]+/).filter(Boolean);
  toks = toks.map((t) => (t === "STE" ? "SAINTE" : t === "ST" ? "SAINT" : t));
  if (toks[0] === "LE") toks = toks.slice(1);
  return toks.join("");
}

function record(status, label, actual, documented, note = "") {
  results.push({ status, label, actual, documented, note });
  if (JSON_OUT) return;
  const badge = { PASS: "\x1b[32mPASS\x1b[0m", FAIL: "\x1b[31mFAIL\x1b[0m", DRIFT: "\x1b[33mDRIFT\x1b[0m", INFO: "\x1b[36mINFO\x1b[0m" }[status];
  const doc = documented === null ? "" : `  (documented ${documented})`;
  console.log(`  ${badge}  ${label}: \x1b[1m${actual}\x1b[0m${doc}${note ? `  — ${note}` : ""}`);
}

/** Counts may only grow (the dataset is append-only): equal → PASS, greater → DRIFT, less → FAIL. */
function expectCount(label, actual, documented) {
  if (actual === documented) return record("PASS", label, actual, documented);
  if (actual > documented) return record("DRIFT", label, actual, documented, "dataset grew — expected over time");
  return record("FAIL", label, actual, documented, "count went DOWN — data was withdrawn or the query changed");
}

/** Rates are the load-bearing claims: checked with a tolerance. */
function expectRate(label, actual, documented, tol = 0.01) {
  const delta = Math.abs(actual - documented);
  if (delta <= tol) return record("PASS", label, pct(actual), pct(documented));
  return record("FAIL", label, pct(actual), pct(documented), `off by ${(delta * 100).toFixed(2)}pp`);
}

// ─────────────────────────────────────────────────────────────────────────────

async function volumeAndNature() {
  log("\n\x1b[1m§1  Volume and request nature\x1b[0m");
  const [tot] = await sql(`SELECT COUNT(*) AS n FROM "${R311}"`);
  expectCount("total rows in the 311 resource", n(tot.n), 3034731);

  const nat = await sql(`SELECT "NATURE", COUNT(*) AS n FROM "${R311}" GROUP BY 1`);
  const byNature = Object.fromEntries(nat.map((r) => [r.NATURE, n(r.n)]));
  expectCount("NATURE='Requete' (service requests)", byNature.Requete, 1588391);
  expectCount("NATURE='Information' (not georeferenced by design)", byNature.Information, 1391644);

  // Information rows carry no location by design — this is why 1.39M coords are null.
  const [nullLieu] = await sql(
    `SELECT COUNT(*) AS n FROM "${R311}" WHERE "NATURE" <> 'Information' AND "TYPE_LIEU_INTERV" IS NULL`
  );
  record("INFO", "service requests with NO TYPE_LIEU_INTERV", n(nullLieu.n), 7,
    "the City populates this ~99.9996% of the time, by phone");
}

async function taxonomy() {
  log("\n\x1b[1m§2  The taxonomy is large AND it churns\x1b[0m");
  const [all] = await sql(`SELECT COUNT(DISTINCT "ACTI_NOM") AS n FROM "${R311}"`);
  expectCount("distinct ACTI_NOM, all time", n(all.n), 993);

  const [retired] = await sql(`SELECT COUNT(DISTINCT "ACTI_NOM") AS n FROM "${R311}" WHERE "ACTI_NOM" LIKE '*%'`);
  record("INFO", "RETIRED categories (leading '*')", n(retired.n), 252,
    "a classifier trained on 2022 labels would emit *Réclamation today");

  const [live] = await sql(
    `SELECT COUNT(DISTINCT "ACTI_NOM") AS n FROM "${R311}" WHERE "NATURE"='Requete' AND "DDS_DATE_CREATION" >= '2026-01-01'`
  );
  record("INFO", "categories live on 2026 service requests", n(live.n), 513, "the honest denominator");

  const [units] = await sql(`SELECT COUNT(DISTINCT "UNITE_RESP_PARENT") AS n FROM "${R311}"`);
  expectCount("distinct UNITE_RESP_PARENT", n(units.n), 52);

  // Fact 2 — the category does not name the owner. Measured on the REQUEST
  // population (not all NATURE) so it matches the population Rule A/B uses.
  const fan = await sql(
    `SELECT "ACTI_NOM", COUNT(DISTINCT "UNITE_RESP_PARENT") AS u, COUNT(*) AS n FROM "${R311}"
     WHERE "NATURE"='Requete' AND "ACTI_NOM" IN ('Nid-de-poule','Collecte de déchets','Feux de circulation - Entretien','Occupation du domaine public')
     GROUP BY 1`
  );
  for (const r of fan) record("INFO", `"${r.ACTI_NOM}" — responsible units`, `${r.u} units over ${n(r.n).toLocaleString()} requests`, null);
}

async function channelMix() {
  log("\n\x1b[1m§3  The real prize: 82% of volume is still a phone call\x1b[0m");
  const rows = await sql(`SELECT "PROVENANCE_ORIGINALE" AS c, COUNT(*) AS n FROM "${R311}" GROUP BY 1`);
  const total = rows.reduce((s, r) => s + n(r.n), 0);
  const phone = n(rows.find((r) => r.c === "Téléphone")?.n ?? 0);
  expectRate("share of all 311 volume arriving by telephone", phone / total, 0.8202);
  record("INFO", "telephone requests", phone.toLocaleString(), "2,489,180");

  // PROVENANCE_TELEPHONE is a COUNT of distinct requesters, not a flag.
  // The City already merges duplicates and keeps the vote — see FINDINGS.md.
  const [multi] = await sql(
    `SELECT COUNT(*) AS n FROM "${R311}" WHERE "NATURE"='Requete' AND ("PROVENANCE_TELEPHONE")::int > 1`
  );
  record("INFO", "requests with >1 distinct phone requester", n(multi.n).toLocaleString(), "202,271",
    "the City counts; nobody groups ACROSS requests to an asset");

  const [bam] = await sql(`SELECT COUNT(*) AS n FROM "${R311}" WHERE "LOC_ERREUR_GDT"='1'`);
  record("INFO", "requests pinned to a borough office (LOC_ERREUR_GDT=1)", n(bam.n).toLocaleString(), "62,008",
    "NOT an error flag — 1 = 'localisation au BAM de l'arrondissement'");
}

async function theFailedJoin() {
  log("\n\x1b[1m§4  The join we expected to work, and which does not\x1b[0m");

  const [ver] = await sql(`SELECT MAX("DATE_VERSION") AS v, COUNT(*) AS n FROM "${R_VOIRIE_CHAUSSEE}"`);
  record("INFO", "voirie chaussée rows", n(ver.n).toLocaleString(), "16,750");
  record(String(ver.v).startsWith("2020") ? "PASS" : "DRIFT", "voirie DATE_VERSION", ver.v, "20200530000000",
    "a 2020 snapshot — not a living registry");

  // The dictionary PERMITS these owner values...
  const dict = await sql(
    `SELECT "REFERENCE" AS v FROM "${R_VOIRIE_DICT}" WHERE "ATTRIBUT"='PROPRIETAIRE_REF'`
  );
  const permitted = new Set(dict.map((r) => r.v));
  const thirdParties = ["Ministère Transport Québec", "Société Transport Montréal", "Service des Grands Parcs", "Privé"];
  record("INFO", "third-party owners PERMITTED by the dictionary",
    thirdParties.filter((t) => permitted.has(t)).length + "/4", "4/4", "this is what fooled us");

  // ...but the actual asset rows essentially never use them.
  const owners = await sql(`SELECT "PROPRIETAIRE_REF" AS o, COUNT(*) AS n FROM "${R_VOIRIE_CHAUSSEE}" GROUP BY 1`);
  const used = Object.fromEntries(owners.map((r) => [r.o, n(r.n)]));
  const thirdPartyRows = thirdParties.reduce((s, t) => s + (used[t] ?? 0), 0);
  const totalAssets = owners.reduce((s, r) => s + n(r.n), 0);
  record(thirdPartyRows / totalAssets < 0.01 ? "PASS" : "FAIL",
    "asset rows ACTUALLY owned by a third party", `${thirdPartyRows} / ${totalAssets.toLocaleString()}`,
    "7 / 16,750", "the column is a TERRITORY tag, not an owner (chaussée table only)");

  // The proof: provincial highways are attributed to boroughs.
  const autoroutes = await sql(
    `SELECT "PROPRIETAIRE_REF" AS o, COUNT(*) AS n FROM "${R_VOIRIE_CHAUSSEE}"
     WHERE "CATEGORIECHAUSSEE_REF" IN ('Autoroute','Bretelle') GROUP BY 1 ORDER BY n DESC LIMIT 3`
  );
  for (const r of autoroutes) {
    record("INFO", `Autoroute/Bretelle segments attributed to "${r.o}"`, n(r.n), null,
      "a naive join would dispatch a PROVINCIAL highway to a borough crew");
  }
}

async function villesLiees() {
  log("\n\x1b[1m§5  The \"not ours\" demand is real (and we got this wrong at first)\x1b[0m");
  const VL = ["Westmount", "Mont-Royal", "Côte-Saint-Luc", "Hampstead", "Dorval", "Pointe-Claire",
    "Montréal-Ouest", "Montréal-Est", "Dollard-des-Ormeaux", "Senneville", "Beaconsfield",
    "Kirkland", "Baie-D'Urfé", "Sainte-Anne-de-Bellevue", "L'Île-Dorval"];
  const list = VL.map((v) => `'${v.replace(/'/g, "''")}'`).join(",");

  // ARRONDISSEMENT is "the unit assigned to fix it" — it can NEVER say Westmount,
  // so filtering on it returns a circular zero. The geographic column is the
  // right one for "where did this originate". See FINDINGS.md §"The circular zero".
  const [declared] = await sql(
    `SELECT COUNT(*) AS n FROM "${R311}" WHERE "ACTI_NOM"='Nid-de-poule' AND "ARRONDISSEMENT" IN (${list})`
  );
  record("INFO", "potholes in a ville liée — by ARRONDISSEMENT (WRONG column)", n(declared.n), 0,
    "circular: this column names who FIXES it, never a ville liée");

  const [geo] = await sql(
    `SELECT COUNT(*) AS n FROM "${R311}" WHERE "ACTI_NOM"='Nid-de-poule' AND "ARRONDISSEMENT_GEO" IN (${list})`
  );
  expectCount("potholes ORIGINATING in a ville liée — by ARRONDISSEMENT_GEO", n(geo.n), 311);

  const [org] = await sql(`SELECT COUNT(*) AS n FROM "${R311}" WHERE "ACTI_NOM"='Organisme divers'`);
  record("INFO", "'Organisme divers' — today's \"belongs to someone else\" bucket", n(org.n).toLocaleString(), "47,578",
    "our baseline to beat");
}

async function routingRules() {
  log("\n\x1b[1m§6  THE HEADLINE — routing without machine learning\x1b[0m");
  log("  pulling the grouped evaluation set (this is the slow one)…");

  const rows = await sqlPaged(
    `SELECT "ACTI_NOM" AS k, "ARRONDISSEMENT_GEO" AS g, "UNITE_RESP_PARENT" AS u,
            CASE WHEN "DDS_DATE_CREATION" < '2025-01-01' THEN 'train' ELSE 'test' END AS period,
            COUNT(*) AS n
     FROM "${R311}"
     WHERE "NATURE"='Requete' AND "LOC_ERREUR_GDT"='0'
       AND "ARRONDISSEMENT_GEO" IS NOT NULL AND "UNITE_RESP_PARENT" IS NOT NULL
     GROUP BY 1,2,3,4 ORDER BY 1,2,3,4`
  );

  const total = rows.reduce((s, r) => s + n(r.n), 0);
  expectCount("located service requests evaluated", total, 1529458);
  record("INFO", "distinct categories in the evaluation set", new Set(rows.map((r) => r.k)).size, 901);

  // ── in-sample ──
  const agg = new Map();
  let geoHits = 0;
  for (const r of rows) {
    const c = n(r.n);
    if (!agg.has(r.k)) agg.set(r.k, { geo: 0, units: new Map() });
    const d = agg.get(r.k);
    d.units.set(r.u, (d.units.get(r.u) ?? 0) + c);
    if (norm(r.g) === norm(r.u)) { d.geo += c; geoHits += c; }
  }
  expectRate("Rule A — geometry alone, in-sample", geoHits / total, 0.9033);

  let comboHits = 0, fixedCats = 0;
  for (const d of agg.values()) {
    const modal = Math.max(...d.units.values());
    if (modal > d.geo) { comboHits += modal; fixedCats++; } else comboHits += d.geo;
  }
  expectRate("Rule B — geometry + per-category switch, in-sample", comboHits / total, 0.9755);
  record("INFO", "categories where a FIXED unit beats geometry", fixedCats, 142,
    "the shared services — Rosemont runs signals/lighting island-wide");

  if (QUICK) return log("  --quick: skipping the held-out split");

  // ── held out: fit the policy on 2022–24, test on 2025–26 ──
  const policy = new Map();
  const trainAgg = new Map();
  for (const r of rows.filter((x) => x.period === "train")) {
    const c = n(r.n);
    if (!trainAgg.has(r.k)) trainAgg.set(r.k, { geo: 0, units: new Map() });
    const d = trainAgg.get(r.k);
    d.units.set(r.u, (d.units.get(r.u) ?? 0) + c);
    if (norm(r.g) === norm(r.u)) d.geo += c;
  }
  for (const [k, d] of trainAgg) {
    let best = null, bestN = -1;
    for (const [u, c] of d.units) if (c > bestN) { bestN = c; best = u; }
    policy.set(k, bestN > d.geo ? { mode: "fixed", unit: best } : { mode: "geo" });
  }

  let tTot = 0, tA = 0, tB = 0;
  for (const r of rows.filter((x) => x.period === "test")) {
    const c = n(r.n);
    tTot += c;
    const geoRight = norm(r.g) === norm(r.u);
    if (geoRight) tA += c;
    const p = policy.get(r.k) ?? { mode: "geo" };
    if (p.mode === "geo" ? geoRight : r.u === p.unit) tB += c;
  }
  log(`  \x1b[2mheld-out split: ${(total - tTot).toLocaleString()} train (2022–24) → ${tTot.toLocaleString()} test (2025–26)\x1b[0m`);
  expectRate("Rule A — geometry alone, HELD OUT", tA / tTot, 0.9095);
  expectRate("Rule B — fitted on train, HELD OUT", tB / tTot, 0.9727);
}

async function sharedServices() {
  log("\n\x1b[1m§7  The trap: shared services are not geographic\x1b[0m");
  for (const [cat, docShare, docTerr] of [
    ["Feux de circulation - Entretien", 0.747, 21],
    ["Éclairage existant - Entretien", 0.669, 23],
  ]) {
    const rows = await sql(
      `SELECT "UNITE_RESP_PARENT" AS u, "ARRONDISSEMENT_GEO" AS g, COUNT(*) AS n FROM "${R311}"
       WHERE "NATURE"='Requete' AND "LOC_ERREUR_GDT"='0' AND "ACTI_NOM"='${cat.replace(/'/g, "''")}'
         AND "ARRONDISSEMENT_GEO" IS NOT NULL GROUP BY 1,2`
    );
    const total = rows.reduce((s, r) => s + n(r.n), 0);
    const byUnit = new Map();
    for (const r of rows) byUnit.set(r.u, (byUnit.get(r.u) ?? 0) + n(r.n));
    let top = null, topN = -1;
    for (const [u, c] of byUnit) if (c > topN) { topN = c; top = u; }
    expectRate(`"${cat}" → ${top}`, topN / total, docShare, 0.02);
    const feeders = new Set(rows.filter((r) => r.u === top).map((r) => r.g)).size;
    record("INFO", `  …territories that FEED ${top}`, feeders, docTerr,
      "a model routing by geography is confidently wrong here");
  }
}

// ─────────────────────────────────────────────────────────────────────────────

(async () => {
  log("\x1b[1m\x1b[35mMontréal AI Challenge — reproduction harness\x1b[0m");
  log("\x1b[2mVerifying proposal.md against the live City of Montréal open-data API.");
  log("Documented values were measured 2026-07-15. DRIFT on counts is expected — the dataset grows daily.\x1b[0m");

  try {
    await volumeAndNature();
    await taxonomy();
    await channelMix();
    await theFailedJoin();
    await villesLiees();
    await sharedServices();
    await routingRules();
  } catch (err) {
    console.error(`\n\x1b[31mHARNESS ERROR\x1b[0m ${err.message}`);
    process.exit(2);
  }

  const failed = results.filter((r) => r.status === "FAIL");
  const drift = results.filter((r) => r.status === "DRIFT");

  if (JSON_OUT) {
    console.log(JSON.stringify({ measuredOn: "2026-07-15", results, failed: failed.length, drift: drift.length }, null, 2));
  } else {
    log(`\n${"─".repeat(78)}`);
    log(`  \x1b[32m${results.filter((r) => r.status === "PASS").length} pass\x1b[0m · ` +
        `\x1b[33m${drift.length} drift\x1b[0m · ` +
        `\x1b[31m${failed.length} fail\x1b[0m · ` +
        `${results.filter((r) => r.status === "INFO").length} informational`);
    if (drift.length) log(`  \x1b[2mDrift is expected on counts: the 311 resource is "2022 à ce jour" and grows daily.\x1b[0m`);
    if (failed.length) {
      log(`\n  \x1b[31mFAILED CHECKS — the proposal's claims no longer hold:\x1b[0m`);
      for (const f of failed) log(`    · ${f.label}: got ${f.actual}, documented ${f.documented}`);
    }
    log("");
  }

  process.exit(failed.length ? 1 : 0);
})();
