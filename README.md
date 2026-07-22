# Olochat AI Inc. × Ville de Montréal — Défi IA / AI Challenge

**⚜ Réinventer l'expérience citoyenne · Reinventing the Citizen Experience — ALL IN 2026**

🇫🇷 [Français](#français) · 🇬🇧 [English](#english)

---

<a name="français"></a>
## Français

Site de soumission pour le **Défi IA — Réinventer l'expérience citoyenne** (Ville de
Montréal, ALL IN 2026). Chaque chiffre est calculé à partir des **données ouvertes 311
de la Ville** et est reproductible de façon indépendante.

**▶ Point de départ — le pôle : [index.html](index.html)** (la page d'accueil).

- **Démo en direct** (interactive, FR + EN) : [demo.fr.html](demo.fr.html) · [demo.html](demo.html)
- **Mémoire technique** : [proposal.html](proposal.html)
- **Notes de terrain & impasses** : [findings.html](findings.html)
- **Chiffres de référence** : [SUBMISSION_NUMBERS.html](SUBMISSION_NUMBERS.html)

Le **tableau de bord en direct** (l'acheminement noté chaque jour contre les décisions
réelles de la Ville) et les **scripts reproductibles** vivent dans le dossier `shadow/`.

La thèse en une ligne : acheminer un signalement citoyen est **reproductible à ~97 %**
par un moteur déterministe et justifiable — l'IA fait la perception, l'acheminement
reste vérifiable et n'invente jamais de service.

---

<a name="english"></a>
## English

The submission site for the **AI Challenge — Reinventing the Citizen Experience** (City
of Montréal, ALL IN 2026). Every figure is computed from the City's **311 open data** and
is independently reproducible.

**▶ Start at the hub — [index.html](index.html)** (the landing page).

- **Live demo** (interactive, FR + EN): [demo.fr.html](demo.fr.html) · [demo.html](demo.html)
- **Technical memo**: [proposal.html](proposal.html)
- **Field notes & dead ends**: [findings.html](findings.html)
- **Canonical figures**: [SUBMISSION_NUMBERS.html](SUBMISSION_NUMBERS.html)

The **live routing scorecard** and the **reproducible scripts** (`shadow-run.mjs`,
`montreal-challenge-verify.mjs`) live in the `shadow/` folder — its public commit history
is the tamper-evident ledger.

The claim in one line: routing a citizen report is **~97% reproducible** with a
deterministic, citable resolver — so the AI does perception, and routing stays auditable
and never hallucinates a department.

---

Données / Data: Requêtes 311 & les jeux de données voirie / géobase / RAAV / RTSS
(`donnees.montreal.ca`, CC-BY 4.0 · © Ville de Montréal). Code: MIT.
