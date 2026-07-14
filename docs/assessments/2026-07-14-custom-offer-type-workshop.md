# "Custom (from requirements)" offer type — workshop doc (2026-07-14)

STATUS: WORKSHOP — owner explicitly wants to iterate on this over time; nothing
here self-dispatches. This doc accumulates decisions so no session re-asks.
Successor to the phase-C sketch in docs/BACKLOG.md and the family-model design
in docs/assessments/2026-07-13-requirements-driven-paths.md (Step 2 of run
2026-07-13-capital-event-picker-chart-bonusmet — that lands first and is the
plumbing this builds on).

## Owner's problem statement (2026-07-14, near-verbatim)
- Brex ground truth: "Brex was either a new funds held (only for 1 day) …
  or card spend" — DD was NEVER part of it. The offer model must not be
  "locked into either one of new funds vs direct deposit, as it could be a
  requirement for either or both in any one offer or various separate ones."
- Wants "more degrees of freedom/flexibility built within the structure that
  encompasses what is most common in offer types."
- Concrete ask: "add a 4th category next to 'Held + DD' that maps in
  dynamically a field from Requirements … present the input fields from
  requirements below Offer type selection banner after the dynamic 4th field
  is selected, then allowing for selection of whether requirement is on vs
  the other(s), multiple, and which option I intend to select."

## Decisions so far (owner-answered 2026-07-14)
1. **Capital derivation: FROM REQUIREMENT ROWS.** A deposit/maintain-balance
   row carrying amount + days IS the hold; no hold-implying row on the chosen
   path → nothing tied up. One source of truth; the Custom type gets no
   duplicate funding/hold fields.
2. **Grouping: MULTIPLE GROUPS (full generality).** Rows are either
   always-required or members of a named pick-one group; groups combine with
   AND — expresses "(A or B) and (C or D)". Owner chose this over the
   single-group simplification.
3. **End state vs the three named types: DECIDE AFTER USING IT.** Build as an
   escape hatch first; revisit whether the named types become presets that
   pre-fill requirement rows.

## Data-model sketch (v0 — to refine in workshop)
- Per-row: `groupId: null | string` (null = always required).
- Per-offer: `requirementGroups: [{ id, label, logic: 'one-of' }]` +
  `groupPicks: { [groupId]: rowId | null }` (the "which option I intend"
  selection; null = undecided → offer un-modeled, consistent with today's
  decide-later semantics; the optimizer NEVER auto-picks — standing rule).
- Derived: activeRequirements(offer) = always-required rows + each group's
  picked row; dormant rows excluded from capital, checklist, deadlines,
  reminders (reuses Step 2's path-aware consumer gating).
- Back-compat: Step 2's family model (requirementLogic 'any' + plannedPath
  'dd'|'debit'|'hold') maps to ONE group containing the family rows;
  migration deferred until the Custom type ships.

## UI sketch (v0)
- 4th offer-type radio: "Custom (from requirements)" next to Held + DD.
- On selection, the Requirements editor renders DIRECTLY BELOW the offer-type
  banner (it IS the offer definition for this type; stays in its current
  lower position for the three named types).
- Per-row role control (subtle, chip-like per owner density rules): Always ·
  Group A · Group B · … (+ new group). Groups render a one-line "pick one:"
  with the member rows + intended-pick radio.
- Brex under this model: Group A = { hold $X for 1 day (deposit row), spend
  $Y (spend row) }, no always-required rows; pick = whichever Collin does.

## Open workshop items (ask, don't assume)
- Group creation UX: explicit "new group" affordance vs auto-grouping the
  first two "option" rows?
- N-of-M within a group (e.g. "any 2 of 3")? Parked unless a real offer
  demands it.
- How the Optimize engine should treat undecided groups in candidate plans
  (today: un-modeled/excluded — confirm that stays acceptable).
- Whether the three named types eventually become presets (decision 3
  deferred).
- Interaction with DoC import: parser mapping of "or" clauses into groups.
