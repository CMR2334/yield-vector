import { App } from './app-state.js';
import { TODAY, addDays, formatCurrency, formatDateDisplay, formatMoneyInput, isoDate, parseDate, parseDateInput, parseMoneyInput, uid } from './date-format-core.js';
import { ddTransferConfig } from './dd-core.js';
import { DatePicker } from './dd-widgets.js';
import { deleteTemplate, docImportApply, docImportClear, docImportFetch, docImportParse, docImportToggle, toggleTemplatePicker, useTemplate } from './doc-import-templates.js';
import { HYPOTHETICAL_OFFER_STATUSES, clearPreV2Backup, migrateOffersToSchemaV2, restorePreV2Backup } from './migrations-catalogs.js';
import { optimizePlanner } from './optimizer-engine.js';
import { addDdRow, addRequirementRow, addSourceBank, closeModal, openActionTarget, readCommitmentForm, readEventForm, readOfferForm, removeDdRow, removeRequirementRow, removeSourceBank, showCommitmentModal, showEventModal, showOfferModal, showSyncHistoryModal } from './modals-forms.js';
import { isOfferComplete, reconcileClosedDate, shouldSuggestWaiting } from './offer-model.js';
import { convertOfferToCommitment, generateProjection, runOptimizer, summarizeProjection } from './projection-optimizer.js';
import { updateUpcomingPage } from './reminders.js';
import { diagReportText } from './render-main-views.js';
import { render } from './render-shell-overview.js';
import { offerDisplayLabel, offerToTemplate, syncRequirementsWithLegacy, templateToOffer } from './requirements-templates.js';
import { ErrCode, STORAGE_KEY, clearDiagLog, copyText, defaultAccountForSub, logError, migrateDdIds, normalizeOfferStatus } from './runtime-status.js';
import { SYNC_FILENAME, Sync, ghGet, revisionOf, updateSyncIndicator } from './sync-pwa.js';
import { toast } from './ui-utils.js';
/* ============================================================
   EVENT BINDINGS
   ============================================================ */
function bindGlobalEvents() {
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  // Open the custom date picker when a .yv-date field is clicked.
  document.addEventListener('click', (e) => {
    const inp = e.target.closest && e.target.closest('.yv-date');
    // Open the visual picker on tap/click (the owner's primary date-entry
    // path). Fields are no longer readonly, so we do NOT preventDefault —
    // the input still focuses, allowing optional typing/paste of M-D-YYYY.
    if (inp) { DatePicker.open(inp); }
  });
  // Normalize a typed/pasted yv-date value when the field loses focus:
  // parse via parseDateInput and, if understood, rewrite in canonical
  // M-D-YYYY display form (so "8/1/2026" or a pasted ISO become "8-1-2026").
  // Unparseable non-empty input is left visible so the user sees it wasn't
  // accepted; every reader independently re-parses, so state stays clean.
  document.addEventListener('blur', (e) => {
    const inp = e.target && e.target.closest && e.target.closest('.yv-date');
    if (!inp) return;
    const iso = parseDateInput(inp.value);
    if (iso) {
      const disp = formatDateDisplay(iso);
      if (disp !== inp.value) {
        inp.value = disp;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('modal-root');
      if (!modal?.dataset.strictClose) closeModal();
    }
    // Enter in the source-bank input adds the bank.
    if (e.key === 'Enter' && e.target && e.target.id === 'source-bank-input') {
      e.preventDefault();
      addSourceBank();
      return;
    }
    // Activate keyboard-focused upcoming-action rows with Enter or Space
    if (e.key === 'Enter' || e.key === ' ') {
      const row = e.target && e.target.closest && e.target.closest('.action-row.clickable');
      // Don't open the offer when the focus is on the row's completion control —
      // the <button> fires its own click (→ toggle-action-done) on Enter/Space.
      if (row && !(e.target.closest && e.target.closest('[data-action="toggle-action-done"]'))) {
        e.preventDefault();
        openActionTarget(row.dataset.targetKind, row.dataset.targetId);
      }
      // Toggle a keyboard-focused requirement checklist item (role=button).
      const reqItem = e.target && e.target.closest && e.target.closest('.offer-req-item');
      if (reqItem) {
        e.preventDefault();
        toggleRequirementDone(reqItem.dataset.id, reqItem.dataset.reqId);
      }
    }
  });
  // Close modal on backdrop click (suppressed for offer modal to prevent losing in-progress data)
  document.addEventListener('click', (e) => {
    const modal = document.getElementById('modal-root');
    if (e.target.id === 'modal-root' && !modal?.dataset.strictClose) closeModal();
  });
  // Cross-device sync: pull on focus / tab visible (throttled inside safeSync)
  window.addEventListener('focus', () => {
    if (Sync.isConfigured()) Sync.safeSync({ reason: 'focus' });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // App left open overnight or tab returning from background —
      // advance the projection start date if it's stale. Re-render so
      // the chart and timeline pick up the new "today" boundary.
      if (App.rollProjectionStartIfStale()) render();
      if (Sync.isConfigured()) Sync.safeSync({ reason: 'tab visible' });
    }
  });
  // Tick the indicator every 30s so "Synced 2m ago" stays current
  setInterval(updateSyncIndicator, 30000);
  // Every 60s, check if midnight has rolled past while the app was
  // open. Cheap call — early-returns if the date hasn't changed.
  setInterval(() => { if (App.rollProjectionStartIfStale()) render(); }, 60000);
  // Re-render on orientation change so the chart's preserveAspectRatio + CSS
  // aspect-ratio rules pick up the new orientation. Debounce so rapid
  // resize events during rotation don't thrash.
  let orientTimer = null;
  const onResize = () => {
    if (orientTimer) clearTimeout(orientTimer);
    orientTimer = setTimeout(() => render(), 120);
  };
  window.addEventListener('orientationchange', onResize);
  window.addEventListener('resize', onResize);
}

function bindViewEvents() { /* re-binding handled by event delegation */ }

function onClick(e) {
  const target = e.target.closest('[data-action], [data-view], [data-plan-segment]');
  if (!target) return;
  const view = target.dataset.view;
  if (view) {
    e.preventDefault();
    App.setView(view);
    return;
  }
  const planSegment = target.dataset.planSegment;
  if (planSegment) {
    e.preventDefault();
    setPlanSegment(planSegment);
    return;
  }
  const action = target.dataset.action;
  if (!action) return;
  const id = target.dataset.id;

  switch (action) {
    case 'add-offer': showOfferModal(); break;
    case 'edit-offer': showOfferModal(id); break;
    case 'duplicate-offer': duplicateOffer(id); break;
    case 'convert-offer': convertOffer(id); break;
    case 'delete-offer': if (confirm('Delete this offer?')) deleteOffer(id); break;
    case 'delete-offer-from-modal': if (confirm('Delete this offer?')) { deleteOffer(id); closeModal(); } break;
    case 'save-offer': saveOfferFromForm(id, target.dataset.isedit === '1'); break;
    case 'save-as-template': saveOfferAsTemplate(id); break;
    case 'save-offer-as-template-card': saveOfferAsTemplateFromCard(id); break;
    case 'use-template': useTemplate(target.dataset.tplId); break;
    case 'delete-template': deleteTemplate(target.dataset.tplId); break;
    case 'toggle-template-picker': toggleTemplatePicker(target.closest('.tpl-picker-toggle') || target); break;
    case 'toggle-advanced-form': toggleAdvancedForm(target); break;
    case 'doc-import-toggle': docImportToggle(target.closest('.doc-import-toggle') || target); break;
    case 'doc-import-parse': docImportParse(); break;
    case 'doc-import-fetch': docImportFetch(); break;
    case 'doc-import-apply': docImportApply(); break;
    case 'doc-import-clear': docImportClear(); break;
    case 'add-dd-row': addDdRow(); break;
    case 'remove-dd-row': removeDdRow(target.closest('.dd-row')); break;
    case 'add-req-row': addRequirementRow(); break;
    case 'remove-req-row': removeRequirementRow(target.dataset.reqIndex); break;
    case 'toggle-req-done': toggleRequirementDone(id, target.dataset.reqId); break;
    case 'toggle-action-done': toggleActionDone(target.dataset.feedId, target.dataset.feedKind, target.dataset.ownerId, target.dataset.reqId); break;
    case 'lifecycle-mark-waiting': lifecycleMarkWaiting(id); break;
    case 'lifecycle-dismiss-suggest': lifecycleDismissSuggest(id); break;
    case 'churn-run-again': churnRunAgain(id); break;
    case 'churn-snooze-toggle': toggleChurnSnoozeMenu(target); break;
    case 'churn-snooze': churnSnooze(id, target.dataset.snooze); break;
    case 'churn-unsnooze': churnUnsnooze(id); break;
    case 'churn-reveal-toggle': toggleChurnSnoozedReveal(target); break;
    case 'close-modal': closeModal(); break;

    case 'add-commitment': showCommitmentModal(); break;
    case 'edit-commitment': showCommitmentModal(id); break;
    case 'delete-commitment': if (confirm('Delete this commitment?')) deleteCommitment(id); break;
    case 'delete-commitment-from-modal': if (confirm('Delete this commitment?')) { deleteCommitment(id); closeModal(); } break;
    case 'save-commitment': saveCommitmentFromForm(id, target.dataset.isedit === '1'); break;

    case 'add-event': showEventModal(); break;
    case 'edit-event': showEventModal(id); break;
    case 'open-action-target': openActionTarget(target.dataset.targetKind, target.dataset.targetId); break;
    case 'delete-event': if (confirm('Delete this event?')) deleteEvent(id); break;
    case 'delete-event-from-modal': if (confirm('Delete this event?')) { deleteEvent(id); closeModal(); } break;
    case 'save-event': saveEventFromForm(id, target.dataset.isedit === '1'); break;

    case 'export-json': exportJson(); break;
    case 'reset-sample': if (confirm('Replace your data with sample data?')) { App.state = seedSampleData(App.defaultState()); App.save(); render(); toast('Sample data loaded'); } break;
    case 'clear-all': if (confirm('Erase ALL data? This cannot be undone.')) { App.state = App.defaultState(); clearPreV2Backup(); App.save(); render(); toast('All data cleared'); } break;
    case 'restore-pre-v2': if (confirm('Restore the backup taken before the schema-v2 upgrade? This replaces your current data with that snapshot and reloads. Your current data is not separately kept, so export first if unsure.')) { restorePreV2Backup(); } break;
    case 'copy-diag': copyText(diagReportText()).then(() => toast('Diagnostics copied')).catch(() => toast('Could not copy — select the text manually', 'danger')); break;
    case 'clear-diag': clearDiagLog(); render(); toast('Diagnostics cleared'); break;

    case 'run-optimizer': runOptimizerNow(); break;
    case 'clear-optimizer': App.optimizer.results = null; render(); break;
    case 'apply-combo': applyOptimizerCombo(target.dataset.mask); break;

    // Optimize segment — the constraint-based sequencer (engine proposal).
    case 'run-planner-optimizer': runPlannerOptimizerNow(); break;
    case 'clear-planner-optimizer':
      App.optimizerPlan = null; App._optimizerAltIndex = 0; App._optimizerUndo = null; render();
      break;
    case 'select-optimizer-alt':
      App._optimizerAltIndex = Math.max(0, Number(target.dataset.altIndex) || 0); render();
      break;
    case 'apply-optimizer-plan': applyOptimizerPlan(); break;
    case 'undo-optimizer-apply': undoOptimizerApply(); break;

    case 'toggle-advanced': App.filters.offersAdvanced = !App.filters.offersAdvanced; render(); break;

    case 'upcoming-prev': updateUpcomingPage(Math.max(0, (App._upcomingPage || 0) - 1)); break;
    case 'upcoming-next': updateUpcomingPage((App._upcomingPage || 0) + 1); break;

    case 'add-source-bank': addSourceBank(); break;
    case 'remove-source-bank': removeSourceBank(target.dataset.bank); break;

    // Stat-card click-throughs from the overview hero
    case 'goto-offers-included':
      App.filters.offersStatus = 'included';
      App.setView('offers');
      break;
    case 'goto-timeline':
      // Timeline now lives as a segment inside the merged Plan tab.
      App._planSegment = 'timeline';
      App.setView('planner');
      break;
    case 'goto-lowest': {
      // Stay on overview, scroll the chart into view, then surface the
      // existing tooltip exactly at the lowest day. The chart's SVG element
      // exposes a `showAtIndex` method that synthesizes the same hover the
      // user would get by mousing over that x — so the existing tooltip
      // path is reused, no duplicate rendering logic.
      const proj = generateProjection(App.state);
      const summary = summarizeProjection(proj, App.state.settings);
      if (summary.lowest && typeof summary.lowestIdx === 'number') {
        const wrap = document.getElementById('hero-chart-wrap');
        if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const showAt = summary.lowestIdx;
        // Defer until scroll likely settles; chart layout is already final.
        setTimeout(() => {
          const svg = document.getElementById('hero-chart');
          if (svg && typeof svg.showAtIndex === 'function') svg.showAtIndex(showAt);
        }, 320);
      }
      break;
    }

    // Sync actions
    case 'open-sync': App.setView('settings'); setTimeout(() => { document.getElementById('sync-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50); break;
    case 'sync-save': saveSyncConfigFromForm(); break;
    case 'doc-worker-save': saveDocWorkerUrlFromForm(); break;
    case 'sync-pull': ensureSyncConfigSaved().then(ok => { if (ok) Sync.pull(); }); break;
    case 'sync-push': guardedManualPush(); break;
    case 'sync-create-gist': createGistFromForm(); break;
    case 'sync-history': ensureSyncConfigSaved().then(ok => { if (ok) showSyncHistoryModal(); }); break;
    case 'sync-restore': {
      const v = target.dataset.version;
      const snap = App._syncHistoryCache && App._syncHistoryCache[v];
      if (!snap) { toast('That revision is not loaded', 'danger'); break; }
      const n = Array.isArray(snap.offers) ? snap.offers.length : 0;
      if (confirm(`Restore this version (${n} offer${n === 1 ? '' : 's'})? It becomes the current version on all your devices. Your present data is also kept in history, so this is reversible.`)) {
        Sync.restoreState(snap).then(() => { closeModal(); toast('Restored from cloud history'); });
      }
      break;
    }
    case 'sync-disconnect': if (confirm('Disconnect cloud sync? Your local data is kept; nothing is deleted from the Gist.')) { Sync.disconnect(); render(); toast('Disconnected'); } break;
  }

  // FAB
  if (target.id === 'fab-add') { showOfferModal(); return; }
}

function onChange(e) {
  const el = e.target;
  if (el.id === 'fab-add') return;

  // Setting fields
  if (el.dataset.setting) {
    const key = el.dataset.setting;
    // Money settings render as comma-grouped text inputs; parse via the
    // money helper. Other numerics stay type=number. Checkboxes/selects
    // pass through as before.
    const isMoneySetting = key === 'currentLiquidCapital' || key === 'minimumCashBuffer';
    let value = el.type === 'checkbox' ? el.checked
      : isMoneySetting ? (parseMoneyInput(el.value) || 0)
      : (el.type === 'number' ? Number(el.value) : el.value);
    if (isMoneySetting) value = Math.max(0, value);
    if (key === 'projectionHorizonDays') value = Math.max(30, Math.min(1825, value));
    if (key === 'maxOptimizerCandidates') value = Math.max(1, Math.min(20, value));
    // Nested settings (e.g. "ddTransfer.inDays") — clamp transfer legs 0–10.
    if (key.includes('.')) {
      const [parent, child] = key.split('.');
      value = Math.max(0, Math.min(10, Number(value) || 0));
      App.update(s => { s.settings[parent] = { ...(s.settings[parent] || {}), [child]: value }; });
      return;
    }
    App.update(s => { s.settings[key] = value; });
    return;
  }

  // Offer include checkbox
  if (el.dataset.action === 'toggle-include') {
    const id = el.dataset.id;
    App.update(s => {
      const o = s.offers.find(x => x.id === id);
      if (o) o.includeInScenario = el.checked;
    });
    return;
  }

  // Filter toggles
  if (el.dataset.action === 'toggle-filter') {
    App.filters[el.dataset.filter] = el.checked;
    render();
    return;
  }

  // Status change inline
  if (el.dataset.action === 'change-status') {
    const id = el.dataset.id;
    const newSub = el.value;
    App.update(s => {
      const o = s.offers.find(x => x.id === id);
      if (o) {
        const priorAccount = o.accountStatus; // capture BEFORE the flip
        o.subStatus = newSub;
        // Auto-set account status from the offer status, BOTH directions
        // (open for approved/on-track/met-waiting/earned/didnt-track;
        // closed for prospect/applied/denied/archived) via the shared
        // classifier, matching the modal's live auto-open/auto-close.
        o.accountStatus = defaultAccountForSub(newSub);
        normalizeOfferStatus(o);
        // Lifecycle (F3): stamp/clear closed_date on the close/reopen transition,
        // via the SAME helper the modal save path uses (reconcileClosedDate) so
        // the two never drift. Without this, closing an offer from the card left
        // closed_date null → no dated caption + an account_closed-anchored
        // churnable offer couldn't compute eligibility until re-saved in the modal.
        reconcileClosedDate(o, priorAccount);
      }
    });
    return;
  }

  // Offers status filter
  if (el.dataset.action === 'offers-status') { App.filters.offersStatus = el.value; render(); return; }

  // Offers sort order (display-only; session-scoped like the status filter)
  if (el.dataset.action === 'offers-sort') { App.filters.offersSort = el.value; render(); return; }

  // Import JSON
  if (el.dataset.action === 'import-json') {
    const file = el.files[0];
    if (file) importJsonFile(file);
    return;
  }
}

function onInput(e) {
  const el = e.target;
  // Live thousands separators in money inputs (any [data-money] field).
  // Reformat on every keystroke and restore the caret by digit count so
  // inserting a comma to the left doesn't shove the cursor around.
  if (el.hasAttribute && el.hasAttribute('data-money')) {
    reformatMoneyFieldLive(el);
    // fall through — no other onInput branch matches a money field.
  }
  if (el.dataset.action === 'offers-search') {
    App.filters.offersSearch = el.value;
    clearTimeout(window._searchTimer);
    window._searchTimer = setTimeout(() => render(), 280);
  }
  // Live-enable sync buttons as the user types credentials. No save/render
  // needed — just toggle the disabled attribute on the action buttons.
  if (el.id === 'sync-gist' || el.id === 'sync-token') {
    updateSyncButtonsLive();
  }
}

// Reformat a money <input> in place with thousands commas, keeping the
// caret at the same logical position. Strategy: count the DIGITS (and a
// leading '-') to the left of the caret in the raw value, reformat the
// whole value, then advance the caret past that same number of digits in
// the formatted string. Commas are the only chars inserted, so counting
// digits is caret-stable regardless of where groups fall.
function reformatMoneyFieldLive(el) {
  const raw = el.value;
  const caret = el.selectionStart == null ? raw.length : el.selectionStart;
  // Significant chars = digits (commas don't count); a minus at position 0
  // also anchors the caret so it survives the reflow.
  let sig = 0;
  for (let i = 0; i < caret; i++) {
    const c = raw[i];
    if (c >= '0' && c <= '9') sig++;
    else if (c === '-' && i === 0) sig++;
  }
  const formatted = formatMoneyInput(raw);
  if (formatted === raw) return; // nothing changed; leave caret alone
  el.value = formatted;
  // Walk the formatted value counting the same significant chars, then park
  // the caret right after the sig-th one.
  let seen = 0, pos = formatted.length;
  for (let i = 0; i < formatted.length; i++) {
    const c = formatted[i];
    if ((c >= '0' && c <= '9') || (c === '-' && i === 0)) {
      seen++;
      if (seen === sig) { pos = i + 1; break; }
    }
  }
  if (sig === 0) pos = 0;
  try { el.setSelectionRange(pos, pos); } catch (_) { /* non-text input types can't set range */ }
}

function toggleAdvancedForm(btn) {
  const expanded = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', String(!expanded));
  const panel = document.getElementById('advanced-fields');
  if (panel) panel.classList.toggle('open', !expanded);
}

/* ============================================================
   ACTIONS
   ============================================================ */
function saveOfferFromForm(id, isEdit) {
  const offer = readOfferForm(id, isEdit);
  if (!offer) return;
  if (!offer.bankName) { toast('Bank name is required', 'danger'); return; }
  // F5 DoC hook: read the "Also save these terms as a template" opt-in BEFORE
  // closeModal() wipes the DOM. When checked, we build the template from the
  // SAVED offer (post-save) so it reflects exactly what the user committed.
  const alsoTemplate = !!(document.getElementById('doc-save-template') || {}).checked;
  App.update(s => {
    const idx = s.offers.findIndex(o => o.id === id);
    if (idx >= 0) s.offers[idx] = offer;
    else s.offers.push(offer);
  });
  let savedTemplate = false;
  if (alsoTemplate) {
    // Silent upsert (no confirm-replace) — the DoC-imported terms are the
    // authoritative latest and shouldn't stack a second dialog on the Save.
    savedTemplate = addOrReplaceTemplate(offerToTemplate(offer), { silent: true });
  }
  closeModal();
  toast(isEdit ? 'Offer updated' : 'Offer added');
  if (savedTemplate) toast('Saved to templates');
}

function deleteOffer(id) {
  App.update(s => {
    s.offers = s.offers.filter(o => o.id !== id);
    s.commitments = s.commitments.filter(c => c.sourceBonusOfferId !== id);
  });
  toast('Offer deleted');
}

/* ---- Templates (F5) actions ------------------------------------------------ */

// Case-insensitive identity for template de-dup: two templates are "the same
// offer" when bank + offer name match (trimmed, lowercased). Empty offer names
// compare equal, so re-saving an unnamed offer for the same bank replaces.
function templateIdentity(t) {
  return `${String((t && t.bankName) || '').trim().toLowerCase()}|${String((t && t.offerName) || '').trim().toLowerCase()}`;
}

// Commit a template into state.templates, replacing any existing one with the
// same identity. In the interactive path an existing match triggers the
// confirm-replace idiom; pass {silent:true} (the DoC post-save hook) to upsert
// without a prompt — a DoC import is the authoritative latest terms and must not
// stack a second dialog on top of the offer Save. Returns true when a template
// was written, false when the user declined the replace. Shared by the modal
// button and the DoC hook so dedupe semantics never diverge.
function addOrReplaceTemplate(tpl, { silent = false } = {}) {
  if (!tpl || !tpl.bankName) { if (!silent) toast('Add a bank name before saving a template', 'danger'); return false; }
  const identity = templateIdentity(tpl);
  const existingIdx = (App.state.templates || []).findIndex(t => templateIdentity(t) === identity);
  if (existingIdx >= 0 && !silent) {
    const label = offerDisplayLabel(tpl);
    if (!confirm(`A template for "${label}" already exists. Replace it with the current terms?`)) return false;
  }
  App.update(s => {
    if (!Array.isArray(s.templates)) s.templates = [];
    const idx = s.templates.findIndex(t => templateIdentity(t) === identity);
    if (idx >= 0) s.templates[idx] = tpl;   // replace in place (keeps list order)
    else s.templates.push(tpl);
  });
  return true;
}

// Modal "Save as template": build a template from the CURRENT form state (so an
// in-progress edit is captured, matching the DoC "form is the truth" idiom),
// strip personal data via offerToTemplate, and commit with the dedupe guard.
// The offer edit modal stays open — saving a template is a side action, not a
// commit of the offer itself.
function saveOfferAsTemplate(id) {
  const offer = readOfferForm(id, true);
  if (!offer) return;
  if (!offer.bankName) { toast('Bank name is required to save a template', 'danger'); return; }
  const tpl = offerToTemplate(offer);
  if (addOrReplaceTemplate(tpl)) toast('Saved to templates');
}

// Card-context "Template" action: save a template from the STORED offer (no
// modal/form open here), reusing the same strip + dedupe path as the modal
// button so behavior is identical whether you save from the card or the editor.
function saveOfferAsTemplateFromCard(id) {
  const offer = (App.state.offers || []).find(o => o && o.id === id);
  if (!offer) { toast('Offer not found', 'danger'); return; }
  if (!offer.bankName) { toast('Bank name is required to save a template', 'danger'); return; }
  if (addOrReplaceTemplate(offerToTemplate(offer))) toast('Saved to templates');
}

// Toggle a requirement row's completion from the card checklist (step 3).
// Flips `done`, stamping `done_date` = today (ISO date) when completing and
// clearing it when un-completing. This is a state edit, so it rides the normal
// App.update → save (debounced push) path — no special feed handling needed;
// the feed rebuild on push drops done user rows automatically.
function toggleRequirementDone(offerId, rowId) {
  if (!offerId || !rowId) return;
  App.update(s => {
    const o = (s.offers || []).find(x => x.id === offerId);
    if (!o || !Array.isArray(o.requirements)) return;
    const row = o.requirements.find(r => r && r.id === rowId);
    if (!row) return;
    row.done = !row.done;
    row.done_date = row.done ? isoDate(TODAY) : null;
  });
}

// Toggle completion of an Upcoming-actions row. requirement-deadline WRITES
// THROUGH to the requirement row's done/done_date (two-way: the offer-card
// checklist and this control are the same source of truth). Every other
// completable kind toggles an entry in state.action_done (feedId → doneDateISO).
// Rides App.update, so it persists, re-renders, AND schedules a push — the push
// recomputes the feed, which excludes the now-done item and tombstones it, so
// the iOS Shortcut marks the reminder complete (identical to requirement-done).
function toggleActionDone(feedId, feedKind, ownerId, reqId) {
  if (!feedId) return;
  if (feedKind === 'requirement-deadline') {
    toggleRequirementDone(ownerId, reqId);
    return;
  }
  App.update(s => {
    if (!s.action_done || typeof s.action_done !== 'object' || Array.isArray(s.action_done)) s.action_done = {};
    if (Object.prototype.hasOwnProperty.call(s.action_done, feedId)) {
      delete s.action_done[feedId];            // un-complete → resurrects in feed
    } else {
      s.action_done[feedId] = isoDate(TODAY);  // complete
    }
  });
}

// Auto-suggest one-tap: advance an offer whose requirements are all met from
// approved/on-track → met-waiting (via the same status field + normalize the
// modal uses). No-op unless the suggestion actually applies (guards against a
// stale click). Rides App.update so it persists + re-renders like any edit.
function lifecycleMarkWaiting(offerId) {
  if (!offerId) return;
  App.update(s => {
    const o = (s.offers || []).find(x => x.id === offerId);
    if (!o || !shouldSuggestWaiting(o)) return;
    o.subStatus = 'met-waiting';
    normalizeOfferStatus(o); // keep accountStatus + legacy shadow in sync
  });
  toast('Marked as Waiting for Bonus');
}

// Dismiss the auto-suggest for an offer (persist a per-offer flag so it never
// nags again). Purely a UI preference; no status change.
function lifecycleDismissSuggest(offerId) {
  if (!offerId) return;
  App.update(s => {
    const o = (s.offers || []).find(x => x.id === offerId);
    if (!o) return;
    o.lifecycle_suggest_dismissed = true;
  });
}

/* ---- Churn snooze (F6) actions --------------------------------------------- */
// Toggle a row's inline snooze-duration menu open/closed. LOCAL DOM only (no
// re-render) — mirrors toggleTemplatePicker: flip aria-expanded + the menu's
// hidden attribute. The menu re-renders closed on the next full render anyway.
function toggleChurnSnoozeMenu(btn) {
  if (!btn) return;
  const menu = document.getElementById(btn.getAttribute('aria-controls'));
  if (!menu) return;
  const open = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', String(!open));
  menu.hidden = open;
}

// Toggle the bottom "N snoozed — show" reveal. LOCAL DOM only.
function toggleChurnSnoozedReveal(btn) {
  if (!btn) return;
  const list = document.getElementById(btn.getAttribute('aria-controls'));
  if (!list) return;
  const open = btn.getAttribute('aria-expanded') === 'true';
  btn.setAttribute('aria-expanded', String(!open));
  list.hidden = open;
  // Swap the affordance copy between show/hide without disturbing the count.
  const n = list.querySelectorAll('.churn-row-wrap').length;
  btn.textContent = open ? `${n} snoozed — show` : `${n} snoozed — hide`;
}

// Snooze an offer's churn: 'forever' (indefinite) or a day-count ('30'/'90')
// → today+N ISO. Rides App.update so it persists (debounced Gist push) and
// re-renders (the row leaves the buckets, the reveal count updates). No-op on
// an unknown offer or an unrecognized duration.
function churnSnooze(offerId, dur) {
  if (!offerId || !dur) return;
  let value;
  if (dur === 'forever') {
    value = 'forever';
  } else {
    const days = Number(dur);
    if (!Number.isFinite(days) || days <= 0) return;
    value = isoDate(addDays(TODAY, days));
  }
  App.update(s => {
    const o = (s.offers || []).find(x => x.id === offerId);
    if (!o) return;
    o.churn_snoozed_until = value;
  });
  toast(dur === 'forever' ? 'Churn snoozed indefinitely' : `Churn snoozed ${dur} days`);
}

// Clear an offer's churn snooze (back to the active buckets + feed). App.update
// path — persists + re-renders like any edit.
function churnUnsnooze(offerId) {
  if (!offerId) return;
  App.update(s => {
    const o = (s.offers || []).find(x => x.id === offerId);
    if (!o) return;
    o.churn_snoozed_until = null;
  });
  toast('Churn unsnoozed');
}

// R69 (Item C): "Run again" on a churn row — spin up a FRESH, unsaved offer from
// this one's saved terms via the EXACT template-Use pipeline (offerToTemplate →
// templateToOffer → showOfferModal(null, seed)), tagged with a re-run note for
// provenance. The prior offer is untouched — nothing saves until the user
// confirms the new modal. No App.update here; showOfferModal owns the render.
function churnRunAgain(offerId) {
  if (!offerId) return;
  const o = (App.state.offers || []).find(x => x && x.id === offerId);
  if (!o) return;
  const seed = templateToOffer(offerToTemplate(o));
  const reRun = `Re-run of ${offerDisplayLabel(o)}`;
  seed.notes = seed.notes ? `${seed.notes}\n${reRun}` : reRun;
  showOfferModal(null, seed);
}

function duplicateOffer(id) {
  const o = App.state.offers.find(x => x.id === id);
  if (!o) return;
  const dup = JSON.parse(JSON.stringify(o));
  dup.id = uid('off');
  dup.bankName = o.bankName + ' (copy)';
  dup.status = 'prospect';
  App.update(s => { s.offers.push(dup); });
  toast('Offer duplicated');
}

function convertOffer(id) {
  const o = App.state.offers.find(x => x.id === id);
  if (!o) return;
  if (!isOfferComplete(o)) { toast('Offer is incomplete', 'danger'); return; }
  if (App.state.commitments.some(c => c.sourceBonusOfferId === id && c.status !== 'cancelled')) {
    toast('Already converted'); return;
  }
  const cmt = convertOfferToCommitment(o);
  if (!cmt) { toast('Could not derive dates', 'danger'); return; }
  App.update(s => { s.commitments.push(cmt); });
  toast('Offer converted to commitment');
}

function saveCommitmentFromForm(id, isEdit) {
  const c = readCommitmentForm(id);
  if (!c) return;
  if (!c.commitmentName) { toast('Name required', 'danger'); return; }
  if (!c.startDate || !c.endDate || parseDate(c.startDate) >= parseDate(c.endDate)) { toast('End date must be after start date', 'danger'); return; }
  App.update(s => {
    const idx = s.commitments.findIndex(x => x.id === id);
    if (idx >= 0) s.commitments[idx] = c;
    else s.commitments.push(c);
  });
  closeModal();
  toast(isEdit ? 'Commitment saved' : 'Commitment added');
}

function deleteCommitment(id) {
  App.update(s => { s.commitments = s.commitments.filter(c => c.id !== id); });
  toast('Commitment deleted');
}

function saveEventFromForm(id, isEdit) {
  const ev = readEventForm(id);
  if (!ev) return;
  if (!ev.eventName) { toast('Name required', 'danger'); return; }
  if (!ev.date || !parseDate(ev.date)) { toast('Date required', 'danger'); return; }
  // Bonus-payout events must link to an offer so the chart marker name
  // and the offer-color dot stay in sync with the underlying offer card.
  if (ev.category === 'bonus payout' && !ev.sourceBonusOfferId) {
    toast('Bonus payout must be linked to an offer', 'danger');
    return;
  }
  App.update(s => {
    const idx = s.events.findIndex(x => x.id === id);
    if (idx >= 0) s.events[idx] = ev;
    else s.events.push(ev);
  });
  closeModal();
  toast(isEdit ? 'Event saved' : 'Event added');
}

function deleteEvent(id) {
  App.update(s => { s.events = s.events.filter(e => e.id !== id); });
  toast('Event deleted');
}

// Switch the active segment of the merged Plan tab. No-op if unchanged.
// Scrolls to top so a longer segment doesn't land mid-content, mirroring
// App.setView's feel for a same-tab context switch.
function setPlanSegment(seg) {
  if (App._planSegment === seg) return;
  App._planSegment = seg;
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// Build the fully self-contained snapshot the pure engine consumes (§7.1).
// Every App.state read the evaluation graph needs is injected here — the
// engine never touches App/DOM/Sync. ddTransfer comes from the LIVE config
// resolver so the engine's projection matches the in-app one byte-for-byte.
function buildOptimizerInput() {
  const s = App.state;
  const settings = s.settings || {};
  const candidateIds = (s.offers || [])
    .filter(o => HYPOTHETICAL_OFFER_STATUSES.has(o.status) && isOfferComplete(o))
    .map(o => o.id);
  return {
    today: isoDate(TODAY),
    settings: {
      ddTransfer: ddTransferConfig(),
      minimumCashBuffer: Number(settings.minimumCashBuffer) || 0,
      currentLiquidCapital: Number(settings.currentLiquidCapital) || 0,
      projectionStartDate: settings.projectionStartDate || isoDate(TODAY)
    },
    offers: s.offers || [],
    commitments: s.commitments || [],
    events: s.events || [],
    candidateIds,
    options: { includeChurn: true }
  };
}

// Run the constraint-based sequencer and stash the TRANSIENT proposal on
// App (never persisted). A fresh run resets the focused-alternative index
// and clears any stale undo snapshot from a prior apply.
function runPlannerOptimizerNow() {
  let plan;
  try {
    plan = optimizePlanner(buildOptimizerInput());
  } catch (e) {
    logError(ErrCode.RENDER, e, 'runPlannerOptimizer');
    toast('Optimizer failed — see diagnostics', 'danger');
    return;
  }
  App.optimizerPlan = plan;
  App._optimizerAltIndex = 0;
  App._optimizerUndo = null;
  render();
  if (plan.tooMany) {
    toast(`Too many candidates (${plan.candidateCount}). Mark some as skipped or convert to commitments.`, 'danger');
  } else if ((plan.candidateCount || 0) === 0) {
    toast('No candidate offers to optimize yet');
  } else if (!plan.valid) {
    toast('No fully feasible plan — see what pinned each date below', 'danger');
  } else {
    const n = (plan.includedIds || []).length;
    toast(`Proposed a plan with ${n} offer${n === 1 ? '' : 's'} · ${formatCurrency(plan.objective.grossBonus)} gross`);
  }
}

// JSON deep clone — offers are plain JSON (ISO-string dates, no functions), so
// a round-trip is a faithful snapshot for the one-shot undo.
function optDeepClone(o) { return JSON.parse(JSON.stringify(o)); }

// Apply an engine schedule to an EXISTING offer (op 'update'), in place.
// Mirrors modal-save semantics: last_edited stamp, reconcileClosedDate (no-op
// with no status change), syncRequirementsWithLegacy (re-dates derived rows in
// place, preserving done/done_date/notes). DD ids are PRESERVED — feed items
// key on them — so planned dates are moved by id, never rebuilt.
function applyScheduleToOffer(o, sched, now) {
  o.plannedSignupDate = sched.plannedSignupDate || '';
  o.optionalPlannedFundingDate = sched.optionalPlannedFundingDate || '';
  const byId = new Map((sched.directDeposits || []).map(d => [d.id, d.plannedDate]));
  for (const dd of (o.directDeposits || [])) {
    if (dd && dd.id && byId.has(dd.id)) dd.plannedDate = byId.get(dd.id);
  }
  o.includeInScenario = true;
  o.last_edited = now;
  reconcileClosedDate(o, o.accountStatus);
  syncRequirementsWithLegacy(o);
}

// Materialize a synthesized churn candidate (op 'create') into a REAL Run-again
// offer with full create-fidelity (step-3 inherited issue). The engine used a
// stable churn_<sourceId> id + a capital-faithful hand-rolled offer purely for
// deterministic evaluation; APPLY reconciles it to the canonical run-again
// object — templateToOffer(offerToTemplate(source)) — the exact fidelity the
// manual "Run again" button produces (bankName, offerName, color, hold anchor
// preserved via TEMPLATE_TERMS_KEYS), then overlays the optimizer-chosen
// schedule. DDs (templates carry none) are reconstructed at the engine's
// scheduled dates with the same even funding split the engine used.
function materializeChurnOffer(source, sched, now) {
  const seed = templateToOffer(offerToTemplate(source));
  seed.plannedSignupDate = sched.plannedSignupDate || '';
  seed.optionalPlannedFundingDate = sched.optionalPlannedFundingDate || '';
  const schedDds = (sched.directDeposits || []).filter(d => d && d.plannedDate);
  if (schedDds.length) {
    const fund = Number(seed.requiredFundingAmount) || 0;
    const per = Math.round(fund / schedDds.length);
    seed.directDeposits = schedDds.map(d => ({ amount: per, plannedDate: d.plannedDate }));
  }
  const reRun = `Re-run of ${offerDisplayLabel(source)}`;
  seed.notes = seed.notes ? `${seed.notes}\n${reRun}` : reRun;
  seed.last_edited = now;
  normalizeOfferStatus(seed);
  reconcileClosedDate(seed, undefined);
  migrateDdIds(seed);
  syncRequirementsWithLegacy(seed);
  return seed;
}

// Apply the focused proposal (P2-6). ONE batched App.update → one save → one
// render; a one-shot undo snapshot (deep clone of every touched offer + the ids
// of any created offers) is captured BEFORE mutation. Op model: update (mutate
// in place), create (push a materialized run-again offer). delete never fires
// on apply — undo of a create IS a delete.
function applyOptimizerPlan() {
  const top = App.optimizerPlan;
  if (!top || top.tooMany) return;
  const plans = (top.alternatives && top.alternatives.length) ? top.alternatives : [top];
  const idx = Math.min(Math.max(0, App._optimizerAltIndex || 0), plans.length - 1);
  const focused = plans[idx];
  if (!focused || !(focused.includedIds || []).length) { toast('This plan has no offers to apply'); return; }
  if (!focused.valid) { toast('This plan is not feasible — adjust and re-run', 'danger'); return; }

  const undo = { updated: {}, createdOfferIds: [] };
  const now = new Date().toISOString();
  const includedSet = new Set(focused.includedIds);
  let created = 0, updated = 0, excluded = 0;
  try {
    App.update(s => {
      for (const id of focused.includedIds) {
        const sched = focused.schedule[id];
        if (!sched) continue;
        if (sched.op === 'create') {
          const cand = (top.candidates || []).find(c => c.id === id);
          const source = s.offers.find(o => o.id === (cand ? cand.sourceOfferId : id));
          if (!source) continue;
          const off = materializeChurnOffer(source, sched, now);
          s.offers.push(off);
          undo.createdOfferIds.push(off.id);
          created++;
        } else {
          const o = s.offers.find(x => x.id === id);
          if (!o) continue;
          undo.updated[id] = optDeepClone(o);
          applyScheduleToOffer(o, sched, now);
          updated++;
        }
      }
      // De-select any candidate the optimizer chose NOT to include but that is
      // currently in the scenario. The engine's evaluated set is baseline
      // (active non-candidates) + selected candidates, so a dropped-but-
      // included hypothetical must leave includeInScenario — otherwise the
      // applied capital curve won't match the proposal (P1-1 parity). Mirrors
      // applyOptimizerCombo's include toggle: no last_edited stamp, since only
      // the scenario flag changes. Create candidates aren't in state.offers.
      for (const cand of (top.candidates || [])) {
        if (cand.op !== 'update' || includedSet.has(cand.id)) continue;
        const o = s.offers.find(x => x.id === cand.originalOfferId);
        if (!o || o.includeInScenario !== true) continue;
        if (!undo.updated[o.id]) undo.updated[o.id] = optDeepClone(o);
        o.includeInScenario = false;
        excluded++;
      }
    });
  } catch (e) {
    logError(ErrCode.RENDER, e, 'applyOptimizerPlan');
    toast('Could not apply the plan — see diagnostics', 'danger');
    return;
  }
  App._optimizerUndo = undo;
  render();
  const parts = [];
  if (updated) parts.push(`${updated} rescheduled`);
  if (created) parts.push(`${created} new re-run${created === 1 ? '' : 's'}`);
  if (excluded) parts.push(`${excluded} de-selected`);
  toast(`Plan applied — ${parts.join(', ') || 'no changes'}. Dates & inclusion updated (no reminders fire until an offer is committed).`);
}

// One-shot inverse of applyOptimizerPlan: restore each updated offer from its
// pre-apply deep clone, and splice out every created offer. One batched update.
function undoOptimizerApply() {
  const undo = App._optimizerUndo;
  if (!undo) return;
  App.update(s => {
    for (const id of Object.keys(undo.updated || {})) {
      const i = s.offers.findIndex(o => o.id === id);
      if (i >= 0) s.offers[i] = optDeepClone(undo.updated[id]);
    }
    if ((undo.createdOfferIds || []).length) {
      const del = new Set(undo.createdOfferIds);
      s.offers = s.offers.filter(o => !del.has(o.id));
    }
  });
  App._optimizerUndo = null;
  render();
  toast('Apply undone');
}

function runOptimizerNow() {
  const result = runOptimizer(App.state);
  App.optimizer.results = result;
  render();
  if (result.tooMany) toast(`Too many candidates (${result.candidateCount}). Mark some as skipped.`, 'danger');
  else if (result.results.length === 0) toast('No feasible combinations found', 'danger');
  else toast(`Found ${result.results.length} feasible combination${result.results.length === 1 ? '' : 's'}`);
}

function applyOptimizerCombo(maskStr) {
  const result = App.optimizer.results;
  if (!result) return;
  const mask = Number(maskStr);
  const candidates = result.candidates;
  App.update(s => {
    for (let i = 0; i < candidates.length; i++) {
      const o = s.offers.find(x => x.id === candidates[i].id);
      if (!o) continue;
      o.includeInScenario = Boolean(mask & (1 << i));
    }
  });
  toast('Combination applied');
}

/* ============================================================
   SYNC FORM HANDLERS
   ============================================================ */
// If the user has typed credentials but hasn't clicked "Save & test" yet,
// persist them to localStorage on first Pull/Push so the call goes
// through. Returns true if Sync is configured (or just got configured),
// false if the user hasn't typed enough to save (in which case the
// caller should bail and let the toast guide them).
// Manual "Push now". Routes through the UNFORCED CAS push — it must NOT do
// its own timestamp check and force past the guard: a stale device that
// re-stamped _lastModified would pass a timestamp warning and force-PATCH
// straight over newer cloud data (the exact clobber this fix exists to stop).
// The CAS handles divergence properly: if the cloud moved off our lineage it
// either adopts silently (this device was just stale) or, if this device has
// unsynced edits, shows the adopt-vs-overwrite conflict dialog. `force:true`
// is reachable ONLY from that dialog's Overwrite branch and from
// restoreState (an explicit make-this-the-truth action) — never from here.
async function guardedManualPush() {
  const ok = await ensureSyncConfigSaved();
  if (!ok) return;
  Sync.push();
}

async function ensureSyncConfigSaved() {
  if (Sync.isConfigured()) return true;
  const gistInput = document.getElementById('sync-gist');
  const tokenInput = document.getElementById('sync-token');
  const gistId = gistInput ? gistInput.value.trim() : '';
  const token = tokenInput ? tokenInput.value.trim() : '';
  if (!gistId || !token) {
    toast('Enter Gist ID and token first, then click Save & test', 'danger');
    return false;
  }
  Sync.setConfig({ gistId, token });
  return true;
}

// Live-enable the Pull/Push/Disconnect buttons as soon as the user has
// typed both credentials, even before "Save & test" is clicked. Called
// from onInput() whenever a sync field changes. Without this, the
// buttons stay disabled until first save and the user thinks the whole
// thing is broken.
function updateSyncButtonsLive() {
  const gistInput = document.getElementById('sync-gist');
  const tokenInput = document.getElementById('sync-token');
  if (!gistInput || !tokenInput) return;
  const hasInputCreds = Boolean(gistInput.value.trim() && tokenInput.value.trim());
  const enabled = Sync.isConfigured() || hasInputCreds;
  document.querySelectorAll('#sync-buttons [data-action="sync-pull"], #sync-buttons [data-action="sync-push"], #sync-buttons [data-action="sync-disconnect"]')
    .forEach(b => b.toggleAttribute('disabled', !enabled));
}

async function saveSyncConfigFromForm() {
  const gistInput = document.getElementById('sync-gist');
  const tokenInput = document.getElementById('sync-token');
  if (!gistInput || !tokenInput) return;
  const gistId = gistInput.value.trim();
  const token = tokenInput.value.trim();
  if (!token) { toast('Token is required', 'danger'); return; }
  if (!gistId) { toast('Gist ID is required (or use "Create new Gist")', 'danger'); return; }
  // LOCAL-ORIGIN SYNC GUARD (mirrors js/sync-pwa.js): the "Save & test" join flow
  // does its own raw ghGet pull below, outside the Sync.* method guards, so cover
  // it here too — a localhost/127.0.0.1 test instance must never pull the owner's
  // real cloud data. Opt in with localStorage yv-allow-local-sync="1".
  if (Sync._localOriginBlocked()) return;
  Sync.setConfig({ gistId, token });
  Sync.setStatus('syncing');
  // "Save & test" semantic: this device is joining sync. If the Gist has
  // valid existing state, adopt it (pull). If empty or fresh, push local up.
  try {
    const data = await ghGet(`https://api.github.com/gists/${gistId}`, token);
    const file = data.files[SYNC_FILENAME] || Object.values(data.files || {})[0];
    let remote = null;
    if (file) {
      const content = file.truncated
        ? await (await fetch(file.raw_url)).text()
        : file.content;
      if (content && content.trim()) {
        try { remote = JSON.parse(content); } catch (e) { logError(ErrCode.PARSE, e, 'sync precheck: cloud payload'); }
      }
    }
    if (remote && remote.settings && typeof remote.settings === 'object') {
      // Adopt the cloud state — this device joins the existing sync. Record
      // the cloud head as our lineage so later CAS pushes compare correctly.
      App.state = remote;
      // Cloud payload may predate v2 — migrate before persist/render.
      migrateOffersToSchemaV2(App.state);
      App.state._baseRevision = revisionOf(data);
      Sync.markClean();
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(App.state)); } catch {}
      Sync.lastSyncAt = Date.now();
      Sync.setStatus('synced');
      Sync.startupDone = true;
      toast('Synced — pulled cloud data');
    } else {
      // Empty/new Gist: seed it with our local state
      await Sync.push({ silent: true });
      Sync.startupDone = true;
      toast('Synced — pushed local data to cloud');
    }
  } catch (e) {
    Sync.setStatus('error', e.message);
    toast('Sync test failed: ' + e.message, 'danger');
  }
  render();
}

// Save (or clear) the optional DoC-import Worker URL + secret. Validates
// https:// on the URL so a mistyped/downgraded URL can't be stored (the Worker
// is only ever called over https; a non-https value would be dead weight and a
// footgun). The secret is independent — persisted verbatim (or cleared when
// blank) regardless of the URL. Re-renders so the gated "Fetch from URL" UI in
// the offer modal reflects the new configured/unconfigured state immediately.
function saveDocWorkerUrlFromForm() {
  const input = document.getElementById('sync-doc-worker');
  const secretInput = document.getElementById('sync-doc-worker-secret');
  if (!input) return;
  const raw = input.value.trim();
  // Persist the secret first (independent of URL validity so a valid secret
  // isn't lost if the URL is being cleared or re-entered).
  const secret = secretInput ? secretInput.value.trim() : '';
  Sync.setDocWorkerSecret(secret);
  if (!raw) {
    Sync.setDocWorkerUrl('');
    toast('Worker URL cleared — URL import disabled');
    render();
    return;
  }
  let u;
  try { u = new URL(raw); } catch { toast('That is not a valid URL', 'danger'); return; }
  if (u.protocol !== 'https:') { toast('Worker URL must start with https://', 'danger'); return; }
  Sync.setDocWorkerUrl(u.toString());
  toast(secret ? 'Worker settings saved — URL import enabled (secret set)' : 'Worker URL saved — URL import enabled');
  render();
}

async function createGistFromForm() {
  const tokenInput = document.getElementById('sync-token');
  if (!tokenInput) return;
  const token = tokenInput.value.trim();
  if (!token) { toast('Token is required first', 'danger'); return; }
  Sync.setStatus('syncing');
  try {
    const gistId = await Sync.createGist(token);
    Sync.setConfig({ gistId, token });
    Sync.lastSyncAt = Date.now();
    Sync.setStatus('synced');
    toast('Created and linked Gist');
    render();
  } catch (e) {
    Sync.setStatus('error', e.message);
    toast('Could not create Gist: ' + e.message, 'danger');
  }
}

/* ============================================================
   IMPORT / EXPORT
   ============================================================ */
function exportJson() {
  const blob = new Blob([JSON.stringify(App.state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `capital-planner-${isoDate(TODAY)}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  toast('Exported');
}

function importJsonFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed.settings || !Array.isArray(parsed.offers)) throw new Error('Invalid shape');
      App.state = parsed;
      // Imported JSON may be a pre-v2 export — migrate before save/render so the
      // requirements[] layer + scalars exist (idempotent; a v2 import is a no-op).
      migrateOffersToSchemaV2(App.state);
      App.save();
      render();
      toast('Imported');
    } catch (err) {
      toast('Invalid JSON: ' + err.message, 'danger');
    }
  };
  reader.readAsText(file);
}

/* ============================================================
   SEED DATA — realistic bank churning scenario
   ============================================================ */
function seedSampleData(state) {
  const today = TODAY;
  const settings = state.settings;
  settings.currentLiquidCapital = 200000;
  settings.minimumCashBuffer = 20000;
  settings.projectionStartDate = isoDate(today);
  settings.projectionHorizonMode = 'auto';
  settings.projectionHorizonDays = 365;
  settings.maxOptimizerCandidates = 15;

  const inDays = (n) => isoDate(addDays(today, n));

  state.offers = [
    {
      id: uid('off'),
      bankName: 'US Bank',
      offerName: 'Smartly Checking $450',
      requiredFundingAmount: 25000,
      signupBonusAmount: 450,
      offerExpirationDate: inDays(45),
      plannedSignupDate: inDays(-25),  // opened 25 days ago
      daysAfterSignupAllowedBeforeDeposit: 30,
      daysFundsMustRemain: 60,         // 60 days FROM OPEN DATE
      optionalPlannedFundingDate: inDays(0),  // funded today
      lockStartsFrom: 'open date',     // anchor on open, not funded → lock is ~35d, not 60
      status: 'funded',
      includeInScenario: true,
      confidence: 'confirmed',
      notes: 'Hold period is 60 days from account open. Funding later shortens the actual lock.',
      docUrl: '',
      entityUsed: 'Collin Rekowski (Ind - SSN)',
      emailUsed: 'collinrekowski1@gmail.com',
      // Schema-v2 churnability example: re-eligible 12 months after the bonus
      // posts. Intentionally left otherwise legacy-shaped (no requirements[]) so
      // it still exercises the v2 migration + derivation on load.
      churnable: true,
      churn_wait_months: 12,
      churn_anchor: 'bonus_received',
      churn_notes: 'US Bank Smartly — reopen allowed 12 months after prior bonus posts.',
      // Lifecycle (F3) showcase: an EXPLICIT bonus-posting window (US Bank
      // Smartly typically posts the bonus ~35–45 days after the qualifying
      // period) so the expected-bonus window renders the stated range rather
      // than the DEFAULT_BONUS_POST_* fallback. Other seeds omit these to
      // exercise the fallback path.
      bonus_post_min_days: 35,
      bonus_post_max_days: 45
    },
    {
      id: uid('off'),
      bankName: 'Citi',
      offerName: 'Priority Checking $1500',
      requiredFundingAmount: 50000,
      signupBonusAmount: 1500,
      offerExpirationDate: inDays(60),
      plannedSignupDate: inDays(7),
      daysAfterSignupAllowedBeforeDeposit: 21,
      daysFundsMustRemain: 60,
      optionalPlannedFundingDate: '',
      lockStartsFrom: 'funded date',
      status: 'selected',
      includeInScenario: true,
      confidence: 'likely',
      notes: '$50k tier',
      docUrl: 'https://www.doctorofcredit.com/',
      entityUsed: 'Collin Rekowski (Ind - SSN)',
      emailUsed: ''
    },
    {
      id: uid('off'),
      bankName: 'BMO',
      offerName: 'Premier Checking $600',
      requiredFundingAmount: 25000,
      signupBonusAmount: 600,
      offerExpirationDate: inDays(75),
      plannedSignupDate: inDays(20),
      daysAfterSignupAllowedBeforeDeposit: 30,
      daysFundsMustRemain: 90,
      optionalPlannedFundingDate: '',
      lockStartsFrom: 'funded date',
      status: 'prospect',
      includeInScenario: false,
      confidence: 'likely',
      notes: '',
      docUrl: '',
      entityUsed: 'Collin Rekowski (Ind - SSN)',
      emailUsed: ''
    },
    {
      id: uid('off'),
      bankName: 'HSBC',
      offerName: 'Premier $2500',
      requiredFundingAmount: 100000,
      signupBonusAmount: 2500,
      offerExpirationDate: inDays(90),
      plannedSignupDate: inDays(45),
      daysAfterSignupAllowedBeforeDeposit: 30,
      daysFundsMustRemain: 90,
      optionalPlannedFundingDate: '',
      lockStartsFrom: 'funded date',
      status: 'prospect',
      includeInScenario: false,
      confidence: 'likely',
      notes: '',
      docUrl: '',
      entityUsed: 'Collin Rekowski (Ind - SSN)',
      emailUsed: ''
    },
    {
      id: uid('off'),
      bankName: 'Charles Schwab',
      offerName: 'Brokerage $1000',
      requiredFundingAmount: 100000,
      signupBonusAmount: 1000,
      offerExpirationDate: inDays(120),
      plannedSignupDate: inDays(30),
      daysAfterSignupAllowedBeforeDeposit: 45,
      daysFundsMustRemain: 365,
      optionalPlannedFundingDate: '',
      lockStartsFrom: 'funded date',
      status: 'prospect',
      includeInScenario: false,
      confidence: 'uncertain',
      notes: 'Requires holding for 1 year',
      docUrl: '',
      entityUsed: '',
      emailUsed: ''
    },
    {
      id: uid('off'),
      bankName: 'Chase',
      offerName: 'Private Client $3000',
      requiredFundingAmount: 250000,
      signupBonusAmount: 3000,
      offerExpirationDate: inDays(60),
      plannedSignupDate: inDays(14),
      daysAfterSignupAllowedBeforeDeposit: 45,
      daysFundsMustRemain: 90,
      optionalPlannedFundingDate: '',
      lockStartsFrom: 'funded date',
      status: 'prospect',
      includeInScenario: false,
      confidence: 'uncertain',
      notes: 'Insufficient capital alone',
      docUrl: '',
      entityUsed: '',
      emailUsed: ''
    },
    {
      id: uid('off'),
      bankName: 'PNC',
      offerName: 'Virtual Wallet Plus $400',
      requiredFundingAmount: 5000,
      signupBonusAmount: 400,
      offerExpirationDate: inDays(50),
      plannedSignupDate: inDays(10),
      daysAfterSignupAllowedBeforeDeposit: 60,
      daysFundsMustRemain: 60,
      optionalPlannedFundingDate: '',
      lockStartsFrom: 'funded date',
      status: 'prospect',
      includeInScenario: false,
      confidence: 'likely',
      notes: 'Mostly DD requirement',
      docUrl: '',
      entityUsed: '',
      emailUsed: '',
      // Schema-v2 promoted-fields example: a monthly service fee waived by a
      // qualifying DD, plus the enrollment promo code. Left legacy-shaped
      // otherwise (no requirements[]) so it also exercises v2 migration on load.
      promo_code: 'PNC400',
      monthly_fee: 7,
      fee_waiver_condition: 'Waived with $500+ in monthly direct deposits.',
      churnable: false,
      churn_notes: 'PNC Virtual Wallet — one bonus per customer; not churnable.'
    }
  ];

  state.commitments = [];

  state.events = [
    {
      id: uid('evt'),
      eventName: 'US Bank bonus payout',
      date: inDays(75),
      amount: 450,
      category: 'bonus payout',
      sourceBonusOfferId: state.offers[0].id,
      includeInProjection: true,
      notes: 'Estimated payout from US Bank Smartly bonus'
    },
    {
      id: uid('evt'),
      eventName: 'Quarterly tax payment',
      date: inDays(35),
      amount: -15000,
      category: 'outflow',
      sourceBonusOfferId: null,
      includeInProjection: true,
      notes: 'Q2 estimated tax'
    },
    {
      id: uid('evt'),
      eventName: 'Consulting payment',
      date: inDays(50),
      amount: 12000,
      category: 'inflow',
      sourceBonusOfferId: null,
      includeInProjection: true,
      notes: ''
    }
  ];

  return state;
}

export { bindGlobalEvents, bindViewEvents, onClick, onChange, onInput, reformatMoneyFieldLive, toggleAdvancedForm, saveOfferFromForm, deleteOffer, templateIdentity, addOrReplaceTemplate, saveOfferAsTemplate, saveOfferAsTemplateFromCard, toggleRequirementDone, toggleActionDone, lifecycleMarkWaiting, lifecycleDismissSuggest, toggleChurnSnoozeMenu, toggleChurnSnoozedReveal, churnSnooze, churnUnsnooze, churnRunAgain, duplicateOffer, convertOffer, saveCommitmentFromForm, deleteCommitment, saveEventFromForm, deleteEvent, runOptimizerNow, applyOptimizerCombo, guardedManualPush, ensureSyncConfigSaved, updateSyncButtonsLive, saveSyncConfigFromForm, saveDocWorkerUrlFromForm, createGistFromForm, exportJson, importJsonFile, seedSampleData };
