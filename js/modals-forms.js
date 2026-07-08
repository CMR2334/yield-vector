import { App } from './app-state.js';
import { TODAY, addBusinessDays, addDays, formatDateDisplay, formatDateMedium, formatMoneyInput, isUsBankHoliday, isoDate, parseDate, parseDateInput, parseMoneyInput, uid } from './date-format-core.js';
import { ddRoundTrip, directDepositEffectiveDate, suggestedFundingDate } from './dd-widgets.js';
import { _docUserChecks, docImportUpdateApplyCount, docTierSelect, filterTemplateList, renderTemplatePicker } from './doc-import-templates.js';
import { COMMITMENT_TYPES, EMAIL_OPTIONS, ENTITY_OPTIONS, EVENT_CATEGORIES, OFFER_COLOR_PALETTE, applyCategorySign, firstUnusedOfferColor, usedOfferColors } from './migrations-catalogs.js';
import { debitDeadlineISO, reconcileClosedDate } from './offer-model.js';
import { renderLifecycleInfo, renderPipelineStrip } from './render-main-views.js';
import { render } from './render-shell-overview.js';
import { REQUIREMENT_FREQUENCIES, REQUIREMENT_FREQ_LABELS, REQUIREMENT_TYPES, REQUIREMENT_TYPE_META, displayOfferName, makeRequirementRow, requirementDeadlineISO, syncRequirementsWithLegacy } from './requirements-templates.js';
import { ACCOUNT_STATUSES, ACCOUNT_STATUS_LABELS, PRE_ACCOUNT_SUB_STATUSES, SUB_STATUSES, SUB_STATUS_LABELS, defaultAccountForSub, normalizeOfferStatus } from './runtime-status.js';
import { Sync } from './sync-pwa.js';
import { escapeAttr, escapeHtml } from './ui-utils.js';
/* ============================================================
   MODAL: ADD/EDIT OFFER
   ============================================================ */
function showOfferModal(offerId = null, seed = null) {
  const isEdit = Boolean(offerId);
  // Auto-assign the first unused palette color on new offers so the
  // chart/timeline picks up identity coding without making the user
  // hunt for a swatch. User can clear or change it in the modal.
  const autoColor = isEdit ? '' : firstUnusedOfferColor(null);
  // The blank-slate default offer for a brand-new "Add an offer" (no seed).
  const blankOffer = {
    id: uid('off'),
    bankName: '',
    offerName: '',
    color: autoColor,
    offerType: 'new-funds-held',
    directDeposits: [],
    debitRequirement: { required: false, count: null, withinDays: null, byDate: '', byDateLegacy: '' },
    requiredFundingAmount: null,
    signupBonusAmount: null,
    offerExpirationDate: '',
    plannedSignupDate: isoDate(addDays(TODAY, 7)),
    daysAfterSignupAllowedBeforeDeposit: 30,
    daysFundsMustRemain: 60,
    optionalPlannedFundingDate: '',
    lockStartsFrom: App.state.settings.defaultLockStartsFrom || 'funded date',
    status: 'prospect',
    accountStatus: 'closed',
    subStatus: 'prospect',
    includeInScenario: true,
    confidence: 'likely',
    notes: '',
    docUrl: '',
    entityUsed: '',
    emailUsed: ''
  };
  // F5: `seed` is a fresh, unsaved offer built by templateToOffer() — the
  // "Start from a template → Use" path. It carries all the terms with prospect
  // defaults + no invented dates; the NEW-offer modal renders populated from it
  // (the whole form render below reads `o`, so a seeded `o` fills every field,
  // DD/requirement section included). A seed with no color of its own (template
  // saved without one) inherits the auto swatch so the chart still colour-codes.
  if (seed && !isEdit && !seed.color) seed.color = autoColor;
  const o = isEdit
    ? App.state.offers.find(x => x.id === offerId)
    : (seed || blankOffer);
  // Back-compat defaults for older offers loaded from storage.
  if (!o.offerType || o.offerType === 'other') o.offerType = 'new-funds-held';
  if (!Array.isArray(o.directDeposits)) o.directDeposits = [];
  if (!o.debitRequirement) o.debitRequirement = { required: false, count: null, withinDays: null, byDate: '', byDateLegacy: '' };
  // DD-requirement RENDER default (step-3 fix #2): do NOT write a default
  // ddRequirement onto the live offer object here. The old
  // `if (!o.ddRequirement) o.ddRequirement = {…count:1…}` mutated the actual
  // state offer on open, so opening + saving a new-funds-held offer that never
  // had a DD requirement grew a phantom derived req-ddreq row. Keep a purely-
  // local view for rendering the (hidden-for-non-DD) requirement controls; the
  // real ddRequirement is only ever materialized by readOfferForm when the user
  // saves a DD-family offer (and deriveRequirementsFromLegacy now gates req-ddreq
  // on the DD-family offerType, so a stray default can't produce a row anyway).
  const ddReqView = o.ddRequirement || { mode: 'count', count: o.directDeposits.length || 1, freqEvery: 'month', freqPeriods: 3 };
  const modal = document.getElementById('modal-root');
  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">${isEdit ? 'Edit offer' : 'Add an offer'}</div>
        <button class="btn-icon" data-action="close-modal" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg></button>
      </div>
      <form class="modal-body" id="offer-form">
        <div class="form-grid">
          ${!isEdit ? renderTemplatePicker() : ''}
          <div class="field" style="grid-column: 1 / -1;">
            <div class="field-box">
              <label for="f-bank">Bank name *</label>
              <input id="f-bank" class="input" type="text" required placeholder="Chase, Citi, US Bank…" value="${escapeAttr(o.bankName)}" name="bankName" />
            </div>
          </div>
          <div class="field" style="grid-column: 1 / -1;">
            <div class="field-box">
              <label for="f-offer">Offer name (optional)</label>
              <input id="f-offer" class="input" type="text" placeholder="Sapphire Banking, Priority $1500…" value="${escapeAttr(o.offerName)}" name="offerName" />
            </div>
          </div>
          <div class="field" style="grid-column: 1 / -1;">
            <label>Color</label>
            <input type="hidden" id="f-color" name="color" value="${escapeAttr(o.color || '')}" />
            <div class="color-picker" id="color-picker">
              <button type="button" class="color-swatch swatch-none ${!o.color ? 'selected' : ''}" data-color="" title="No color" aria-label="No color">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="3" y1="3" x2="13" y2="13"/><line x1="13" y1="3" x2="3" y2="13"/></svg>
              </button>
              ${(() => {
                const used = usedOfferColors(o.id);
                // Only render colors that are AVAILABLE (not used by another
                // offer) plus this offer's own current color. Taken colors
                // are removed from the pane entirely so what you see is
                // exactly what you can pick.
                const available = OFFER_COLOR_PALETTE.filter(c => !used.has(c.name) || o.color === c.name);
                if (available.length === 0) {
                  return `<span style="font-size:12px;color:var(--text-tertiary);align-self:center;">All colors in use — clear one from another offer to free it up.</span>`;
                }
                return available.map(c => {
                  const sel = o.color === c.name;
                  return `<button type="button"
                    class="color-swatch ${sel ? 'selected' : ''}"
                    data-color="${c.name}"
                    style="background:${c.hex};"
                    aria-label="${c.label}"
                    title="${c.label}"></button>`;
                }).join('');
              })()}
            </div>
            <span class="field-hint">Identity color for the card border, timeline bar, and chart marker stroke. Colors already used by other offers are hidden until freed.</span>
          </div>
          <div class="field">
            <div class="field-box">
              <label for="f-bonus">Bonus amount *</label>
              <div class="input-group"><span class="input-prefix">$</span>
                <input id="f-bonus" class="input" type="text" inputmode="decimal" data-money required value="${formatMoneyInput(o.signupBonusAmount ?? '')}" name="signupBonusAmount" />
              </div>
            </div>
          </div>
          <div class="field" style="grid-column: 1 / -1;">
            <label>Offer type *</label>
            <div class="radio-group">
              <input type="radio" id="ot-held" name="offerType" value="new-funds-held" ${o.offerType === 'new-funds-held' ? 'checked' : ''} data-toggles-dd-section />
              <label for="ot-held">New funds held</label>
              <input type="radio" id="ot-dd" name="offerType" value="direct-deposit" ${o.offerType === 'direct-deposit' ? 'checked' : ''} data-toggles-dd-section />
              <label for="ot-dd">Direct deposit</label>
              <input type="radio" id="ot-hdd" name="offerType" value="held-and-dd" ${o.offerType === 'held-and-dd' ? 'checked' : ''} data-toggles-dd-section />
              <label for="ot-hdd">Held + DD</label>
            </div>
            <span class="field-hint"><strong>New funds held</strong>: lump-sum deposit kept for N days. <strong>Direct deposit</strong>: qualifying DDs only, no hold — money just round-trips through the account. <strong>Held + DD</strong>: minimum deposit held for N days <em>and</em> qualifying DDs required (e.g. Associated Bank).</span>
          </div>
          <div class="field dd-section" style="grid-column: 1 / -1;${(o.offerType === 'direct-deposit' || o.offerType === 'held-and-dd') ? '' : 'display:none;'}">
            <label>Direct deposit requirement *</label>
            <div class="radio-group" style="margin-bottom:8px;">
              <input type="radio" id="ddreq-count" name="ddReqMode" value="count" ${ddReqView.mode !== 'frequency' ? 'checked' : ''} />
              <label for="ddreq-count">Minimum total #</label>
              <input type="radio" id="ddreq-freq" name="ddReqMode" value="frequency" ${ddReqView.mode === 'frequency' ? 'checked' : ''} />
              <label for="ddreq-freq">Required frequency</label>
            </div>
            <div id="ddreq-count-fields" style="${ddReqView.mode !== 'frequency' ? '' : 'display:none;'}margin-bottom:8px;">
              <div class="input-group with-suffix" style="max-width:200px;">
                <input id="ddreq-count-n" class="input" type="number" min="1" max="24" step="1" value="${ddReqView.count || 1}" />
                <span class="input-suffix">deposits</span>
              </div>
            </div>
            <div id="ddreq-freq-fields" style="${ddReqView.mode === 'frequency' ? '' : 'display:none;'}margin-bottom:8px;display:${ddReqView.mode === 'frequency' ? 'flex' : 'none'};gap:8px;flex-wrap:wrap;align-items:center;">
              <span style="font-size:13px;color:var(--text-secondary);">Once per</span>
              <select id="ddreq-freq-every" class="select" style="max-width:130px;">
                <option value="week" ${ddReqView.freqEvery === 'week' ? 'selected' : ''}>week</option>
                <option value="2weeks" ${ddReqView.freqEvery === '2weeks' ? 'selected' : ''}>2 weeks</option>
                <option value="month" ${(ddReqView.freqEvery || 'month') === 'month' ? 'selected' : ''}>month</option>
              </select>
              <span style="font-size:13px;color:var(--text-secondary);">for</span>
              <div class="input-group with-suffix" style="max-width:160px;">
                <input id="ddreq-freq-periods" class="input" type="number" min="1" max="24" step="1" value="${ddReqView.freqPeriods || 3}" style="padding-right:72px;" />
                <span class="input-suffix" id="ddreq-freq-unit">${ddReqView.freqEvery === 'week' ? 'weeks' : ddReqView.freqEvery === '2weeks' ? 'cycles' : 'months'}</span>
              </div>
              <button type="button" class="btn btn-secondary btn-sm" id="ddreq-generate">Generate dates</button>
            </div>
            <label style="margin-top:4px;">Planned direct deposits *</label>
            <div id="dd-entries">${(o.directDeposits || []).map((dd, i) => renderDdRow(dd, i)).join('')}</div>
            <button type="button" class="btn btn-secondary btn-sm" data-action="add-dd-row" style="align-self:flex-start;margin-top:6px;">+ Add deposit</button>
            <span class="field-hint" id="dd-section-hint">Plan each DD's <strong>initiation</strong> date. Standard DD ties up the money only for its transfer round trip; plan the first DD early so you have time to retry from another bank if it doesn't code as a direct deposit. Dates auto-shift to the next business day if they land on a weekend or federal holiday.</span>
          </div>
          <div class="field" style="grid-column: 1 / -1;">
            <label>Debit-card transaction requirement?</label>
            <div class="radio-group" style="max-width:260px;">
              <input type="radio" id="debit-no" name="debitRequired" value="no" ${o.debitRequirement.required ? '' : 'checked'} />
              <label for="debit-no">No</label>
              <input type="radio" id="debit-yes" name="debitRequired" value="yes" ${o.debitRequirement.required ? 'checked' : ''} />
              <label for="debit-yes">Yes</label>
            </div>
          </div>
          <div class="field" id="debit-fields-wrap" style="grid-column: 1 / -1;${o.debitRequirement.required ? '' : 'display:none;'}">
            <div class="form-grid">
              <div class="field">
                <div class="field-box">
                  <label for="f-debit-count">Qualifying debit purchases *</label>
                  <div class="input-group with-suffix">
                    <input id="f-debit-count" class="input" type="number" min="1" max="99" step="1" value="${o.debitRequirement.count ?? ''}" name="debitCount" />
                    <span class="input-suffix">txns</span>
                  </div>
                </div>
              </div>
              <div class="field">
                <div class="field-box">
                  <label for="f-debit-within">Complete debits within X days of sign up</label>
                  <div class="input-group with-suffix">
                    <input id="f-debit-within" class="input" type="number" min="1" step="1" value="${o.debitRequirement.withinDays ?? ''}" name="debitWithinDays" />
                    <span class="input-suffix">days</span>
                  </div>
                </div>
                <span class="field-hint" id="f-debit-deadline">${(() => {
                  const dl = debitDeadlineISO(o);
                  return dl ? `Complete by: <strong style="color:var(--text-secondary);">${formatDateMedium(dl)}</strong>` : '';
                })()}</span>
              </div>
            </div>
            <span class="field-hint">Some SUBs require N qualifying debit-card purchases within a set number of days of signing up. Counts toward "Actions required" on the Overview.</span>
          </div>
          <div class="field">
            <div class="field-box">
              <label for="f-funding">Required funding *</label>
              <div class="input-group"><span class="input-prefix">$</span>
                <input id="f-funding" class="input" type="text" inputmode="decimal" data-money required value="${formatMoneyInput(o.requiredFundingAmount ?? '')}" name="requiredFundingAmount" />
              </div>
            </div>
          </div>
          <div class="field">
            <div class="field-box">
              <label for="f-expires">Offer expires</label>
              <input id="f-expires" class="input yv-date" type="text" inputmode="numeric" autocomplete="off" placeholder="M-D-YYYY" value="${escapeAttr(formatDateDisplay(o.offerExpirationDate))}" name="offerExpirationDate" data-picker-mode="plain" />
            </div>
          </div>
          <div class="field">
            <div class="field-box">
              <label for="f-signup">${o.accountStatus === 'open' ? 'Sign up date *' : 'Planned sign up date *'}</label>
              <input id="f-signup" class="input yv-date" type="text" inputmode="numeric" autocomplete="off" required placeholder="M-D-YYYY" value="${escapeAttr(formatDateDisplay(o.plannedSignupDate))}" name="plannedSignupDate" data-picker-mode="plain" />
            </div>
          </div>
          <div class="field">
            <div class="field-box">
              <label for="f-days-deposit" id="days-deposit-label">${o.offerType === 'direct-deposit' ? 'Complete DDs within X days of sign up' : 'Days after sign up to deposit'}</label>
              <div class="input-group with-suffix">
                <input id="f-days-deposit" class="input" type="number" min="0" step="1" value="${o.daysAfterSignupAllowedBeforeDeposit ?? ''}" name="daysAfterSignupAllowedBeforeDeposit" />
                <span class="input-suffix">days</span>
              </div>
            </div>
          </div>
          <div class="field" id="days-remain-field" style="${o.offerType === 'direct-deposit' ? 'display:none;' : ''}">
            <div class="field-box">
              <label for="f-days-remain" id="days-remain-label">Funds must remain deposited through day * (from ${o.lockStartsFrom === 'open date' ? 'account opening' : 'funded date'})</label>
              <div class="input-group with-suffix">
                <input id="f-days-remain" class="input" type="number" min="0" step="1" value="${o.daysFundsMustRemain ?? ''}" name="daysFundsMustRemain" />
                <span class="input-suffix">days</span>
              </div>
            </div>
          </div>
          <div class="field" id="funding-date-field" style="${o.offerType === 'direct-deposit' ? 'display:none;' : ''}">
            <div class="field-box">
              <label for="f-funded" id="f-funded-label">Planned funding date${o.offerType === 'held-and-dd' ? ' *' : ' (optional)'}</label>
              <input id="f-funded" class="input yv-date" type="text" inputmode="numeric" autocomplete="off" placeholder="M-D-YYYY" value="${escapeAttr(formatDateDisplay(o.optionalPlannedFundingDate))}" name="optionalPlannedFundingDate" data-picker-mode="plain" />
            </div>
            <span class="field-hint" id="f-funded-suggest">${(() => {
              const sug = suggestedFundingDate(o.plannedSignupDate, o.daysAfterSignupAllowedBeforeDeposit);
              return sug ? `Latest safe funding: <strong style="color:var(--text-secondary);">${formatDateMedium(sug)}</strong> (1-day buffer before the deposit deadline, on a business day)` : '';
            })()}</span>
          </div>
          <div class="field" id="lock-from-field" style="${o.offerType === 'direct-deposit' ? 'display:none;' : ''}">
            <label>Days counted from</label>
            <div class="radio-group">
              <input type="radio" id="lsf-fund" name="lockStartsFrom" value="funded date" ${o.lockStartsFrom !== 'open date' ? 'checked' : ''}
                onchange="document.getElementById('days-remain-label').textContent='Funds must remain deposited through day * (from funded date)'" />
              <label for="lsf-fund">Funded date</label>
              <input type="radio" id="lsf-open" name="lockStartsFrom" value="open date" ${o.lockStartsFrom === 'open date' ? 'checked' : ''}
                onchange="document.getElementById('days-remain-label').textContent='Funds must remain deposited through day * (from account opening)'" />
              <label for="lsf-open">Open date</label>
            </div>
            <span class="field-hint">Where the bank measures the hold from. <strong>Open date</strong> = e.g. US Bank "60 days from open" — funding later means a shorter actual lock. <strong>Funded date</strong> = e.g. Citi "keep $50k for 60 days from deposit". Money is always treated as tied up only from when you actually deposit.</span>
          </div>
          <div class="field" style="grid-column: 1 / -1;" id="f-lifecycle-strip">${renderPipelineStrip(o, { slim: true })}${renderLifecycleInfo(o)}</div>
          <div class="field">
            <div class="field-box">
              <label for="f-substatus">Offer status</label>
              <select id="f-substatus" class="select" name="subStatus">
                ${SUB_STATUSES.map(s => `<option value="${s}" ${o.subStatus === s ? 'selected' : ''}>${SUB_STATUS_LABELS[s]}</option>`).join('')}
              </select>
            </div>
            <span class="field-hint">Where this offer is in its lifecycle. Selecting Approved, On-Track, Met (Waiting), Earned, or Didn't Track auto-sets the account to Open; Prospect, Applied, Denied, or Archived auto-sets it back to Closed.</span>
          </div>
          <div class="field">
            <div class="field-box">
              <label for="f-accountstatus">Account status</label>
              <select id="f-accountstatus" class="select" name="accountStatus">
                ${ACCOUNT_STATUSES.map(s => `<option value="${s}" ${o.accountStatus === s ? 'selected' : ''}>${ACCOUNT_STATUS_LABELS[s]}</option>`).join('')}
              </select>
            </div>
            <span class="field-hint">Closed force-excludes the offer from the cash projection (money is back).</span>
          </div>
          <div class="field" id="f-closed-date-field" style="display:${(o.accountStatus === 'closed' && !PRE_ACCOUNT_SUB_STATUSES.has(o.subStatus)) ? '' : 'none'};">
            <div class="field-box">
              <label for="f-closed">Closed date</label>
              <input id="f-closed" class="input yv-date" type="text" inputmode="numeric" autocomplete="off" placeholder="M-D-YYYY" value="${escapeAttr(formatDateDisplay(o.closed_date))}" name="closed_date" data-picker-mode="plain" data-stored="${escapeAttr(o.closed_date || '')}" ${(o.accountStatus === 'closed' && !PRE_ACCOUNT_SUB_STATUSES.has(o.subStatus)) ? '' : 'disabled'} />
            </div>
            <span class="field-hint">When the account was closed — anchors churn eligibility when the churn anchor is "account closed". Backdate freely; leave blank to default to today on save.</span>
          </div>
          <div class="field">
            <div class="field-box">
              <label for="f-confidence">Confidence</label>
              <select id="f-confidence" class="select" name="confidence">
                <option value="confirmed" ${o.confidence === 'confirmed' ? 'selected' : ''}>Confirmed</option>
                <option value="likely" ${o.confidence === 'likely' ? 'selected' : ''}>Likely</option>
                <option value="uncertain" ${o.confidence === 'uncertain' ? 'selected' : ''}>Uncertain</option>
              </select>
            </div>
          </div>
          <div class="field" style="grid-column: 1 / -1;">
            <label class="checkbox-row">
              <input type="checkbox" name="includeInScenario" ${o.includeInScenario ? 'checked' : ''} />
              <span>Include in projection scenario</span>
            </label>
          </div>
          <div class="field req-section" style="grid-column: 1 / -1;">
            <label>Requirements</label>
            <div id="req-rows">${renderRequirementRows(o)}</div>
            <div class="req-add-row">
              <select id="req-add-type" class="select" aria-label="New requirement type">
                ${REQUIREMENT_TYPES.map(t => `<option value="${t}">${escapeHtml(REQUIREMENT_TYPE_META[t] ? REQUIREMENT_TYPE_META[t].label : t)}</option>`).join('')}
              </select>
              <button type="button" class="btn btn-secondary btn-sm" data-action="add-req-row">+ Add requirement</button>
            </div>
            <span class="field-hint">Every obligation for this bonus. <strong>Auto</strong> rows mirror the fields above (funding, DDs, debit) — edit their amount/count/deadline here or above, either updates both. Add rows for anything else (e-statements, promo code, extra spend). The date beside each row is computed from the sign-up date + its deadline.</span>
          </div>
        </div>

        <button type="button" class="advanced-toggle" data-action="toggle-advanced-form" aria-expanded="false">
          <span>Advanced fields (DD, fees, links, entity)</span>
          <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="advanced-fields" id="advanced-fields">
          <div class="form-grid">
            <div class="field"><div class="field-box"><label for="f-doc">DoC / source URL</label><input id="f-doc" class="input" type="url" placeholder="https://doctorofcredit.com/..." value="${escapeAttr(o.docUrl)}" name="docUrl" /></div></div>
            <div class="field" style="grid-column: 1 / -1;">
              <div class="doc-import" id="doc-import">
                <button type="button" class="doc-import-toggle" data-action="doc-import-toggle" aria-expanded="false" aria-controls="doc-import-body">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  <span>Import from Doctor of Credit</span>
                </button>
                <div class="doc-import-body" id="doc-import-body" hidden>
                  ${Sync.getDocWorkerUrl() ? `
                  <div class="doc-fetch" id="doc-fetch">
                    <p class="doc-import-help">Fetch the post straight from its URL — the configured Worker retrieves it and runs an AI pass on the fuzzy fields (each shown with the exact quote it came from). Results fill the form for review; nothing saves.</p>
                    <div class="doc-fetch-row">
                      <input id="doc-fetch-url" class="input doc-fetch-url" type="url" placeholder="https://www.doctorofcredit.com/…" value="${escapeAttr(o.docUrl || '')}" autocomplete="off" spellcheck="false" />
                      <button type="button" class="btn btn-primary btn-sm doc-fetch-btn" id="doc-fetch-btn" data-action="doc-import-fetch">Fetch &amp; Parse</button>
                    </div>
                    <div class="doc-fetch-err" id="doc-fetch-err" role="status" aria-live="polite"></div>
                  </div>
                  <div class="doc-fetch-or">or paste the post text</div>
                  ` : ''}
                  <p class="doc-import-help">Paste the full Doctor of Credit post text or HTML below, then Parse. Nothing is saved — parsed values fill the form for you to review and confirm.</p>
                  <textarea id="doc-import-paste" class="textarea doc-import-paste" rows="5" placeholder="Paste the Doctor of Credit post here…" autocomplete="off" spellcheck="false"></textarea>
                  <div class="doc-import-actions">
                    <button type="button" class="btn btn-primary btn-sm" data-action="doc-import-parse">Parse</button>
                    <button type="button" class="btn btn-secondary btn-sm" data-action="doc-import-clear">Clear</button>
                    <span class="doc-import-status" id="doc-import-status" role="status" aria-live="polite"></span>
                  </div>
                  <div class="doc-import-preview" id="doc-import-preview"></div>
                </div>
              </div>
            </div>
            <div class="field">
              <div class="field-box">
                <label for="f-entity">Entity used</label>
                <select id="f-entity" class="select" name="entityUsed">
                  <option value="" ${!o.entityUsed ? 'selected' : ''}>—</option>
                  ${ENTITY_OPTIONS.map(e => `<option value="${escapeAttr(e)}" ${o.entityUsed === e ? 'selected' : ''}>${escapeHtml(e)}</option>`).join('')}
                  ${o.entityUsed && !ENTITY_OPTIONS.includes(o.entityUsed) ? `<option value="${escapeAttr(o.entityUsed)}" selected>${escapeHtml(o.entityUsed)} (legacy)</option>` : ''}
                </select>
              </div>
            </div>
            <div class="field">
              <div class="field-box">
                <label for="f-email">Email used</label>
                <select id="f-email" class="select" name="emailUsed">
                  <option value="" ${!o.emailUsed ? 'selected' : ''}>—</option>
                  ${EMAIL_OPTIONS.map(e => `<option value="${escapeAttr(e)}" ${o.emailUsed === e ? 'selected' : ''}>${escapeHtml(e)}</option>`).join('')}
                  ${o.emailUsed && !EMAIL_OPTIONS.includes(o.emailUsed) ? `<option value="${escapeAttr(o.emailUsed)}" selected>${escapeHtml(o.emailUsed)} (legacy)</option>` : ''}
                </select>
              </div>
            </div>
            <div class="field">
              <div class="field-box">
                <label for="f-bonus-received">Bonus received date</label>
                <input id="f-bonus-received" class="input yv-date" type="text" inputmode="numeric" autocomplete="off" placeholder="M-D-YYYY" value="${escapeAttr(formatDateDisplay(o.bonus_received_date))}" name="bonus_received_date" data-picker-mode="plain" />
              </div>
              <span class="field-hint">When the sign-up bonus actually posted. Set it once you're marked Earned — it anchors the safe-to-close date and, when the anchor below is "bonus received", churn eligibility.</span>
            </div>
          </div>
          <div class="field" style="grid-column: 1 / -1;">
            <label>Fees &amp; terms</label>
            <div class="form-grid" style="margin-top: var(--space-2);">
              <div class="field">
                <div class="field-box">
                  <label for="f-monthly-fee">Monthly fee</label>
                  <div class="input-group">
                    <span class="input-prefix">$</span>
                    <input id="f-monthly-fee" class="input" type="text" inputmode="decimal" data-money autocomplete="off" placeholder="0" value="${escapeAttr(formatMoneyInput(o.monthly_fee))}" name="monthly_fee" />
                  </div>
                </div>
              </div>
              <div class="field">
                <div class="field-box">
                  <label for="f-fee-waiver">Fee waiver condition</label>
                  <input id="f-fee-waiver" class="input" type="text" autocomplete="off" placeholder="e.g. $500+ monthly direct deposits" value="${escapeAttr(o.fee_waiver_condition || '')}" name="fee_waiver_condition" />
                </div>
              </div>
              <div class="field">
                <div class="field-box">
                  <label for="f-promo-code">Promo code</label>
                  <input id="f-promo-code" class="input" type="text" autocomplete="off" placeholder="e.g. BONUS400" value="${escapeAttr(o.promo_code || '')}" name="promo_code" />
                </div>
              </div>
              <div class="field">
                <div class="field-box">
                  <label for="f-etf">Early termination fee</label>
                  <div class="input-group">
                    <span class="input-prefix">$</span>
                    <input id="f-etf" class="input" type="text" inputmode="decimal" data-money autocomplete="off" placeholder="0" value="${escapeAttr(formatMoneyInput(o.early_termination_fee))}" name="early_termination_fee" />
                  </div>
                </div>
              </div>
              <div class="field">
                <div class="field-box">
                  <label for="f-etf-window">ETF window (days)</label>
                  <input id="f-etf-window" class="input" type="number" min="0" step="1" inputmode="numeric" autocomplete="off" placeholder="e.g. 180" value="${o.etf_window_days == null || o.etf_window_days === '' ? '' : escapeAttr(o.etf_window_days)}" name="etf_window_days" />
                </div>
                <span class="field-hint">Days from account open before closing avoids the early-termination fee. Extends the safe-to-close date.</span>
              </div>
              <div class="field">
                <div class="field-box">
                  <label>Bonus posting window (days after requirements)</label>
                  <div class="dd-timing-row">
                    <input id="f-bonus-post-min" class="input" type="number" min="0" step="1" inputmode="numeric" autocomplete="off" placeholder="min" aria-label="Bonus posting min days" value="${o.bonus_post_min_days == null || o.bonus_post_min_days === '' ? '' : escapeAttr(o.bonus_post_min_days)}" name="bonus_post_min_days" />
                    <span style="color:var(--text-tertiary);font-size:13px;">to</span>
                    <input id="f-bonus-post-max" class="input" type="number" min="0" step="1" inputmode="numeric" autocomplete="off" placeholder="max" aria-label="Bonus posting max days" value="${o.bonus_post_max_days == null || o.bonus_post_max_days === '' ? '' : escapeAttr(o.bonus_post_max_days)}" name="bonus_post_max_days" />
                  </div>
                </div>
                <span class="field-hint">Typical range the bonus posts after you meet requirements. Drives the expected-bonus window and safe-to-close date.</span>
              </div>
            </div>
            <span class="field-hint">Optional account economics — monthly fee (shows as $N/mo on the card), waiver condition, enrollment promo code, and the early-termination-fee window.</span>
          </div>
          <div class="field" style="grid-column: 1 / -1;">
            <label>Churnability</label>
            <div class="form-grid" style="margin-top: var(--space-2);">
              <div class="field">
                <div class="field-box">
                  <label for="f-churnable">Can be churned</label>
                  <select id="f-churnable" class="select" name="churnable">
                    <option value="" ${o.churnable == null ? 'selected' : ''}>Unknown</option>
                    <option value="true" ${o.churnable === true ? 'selected' : ''}>Yes</option>
                    <option value="false" ${o.churnable === false ? 'selected' : ''}>No</option>
                  </select>
                </div>
              </div>
              <div class="field">
                <div class="field-box">
                  <label for="f-churn-wait">Wait before re-run (months)</label>
                  <input id="f-churn-wait" class="input" type="number" min="0" step="1" inputmode="numeric" autocomplete="off" placeholder="e.g. 12" value="${o.churn_wait_months == null ? '' : escapeAttr(o.churn_wait_months)}" name="churn_wait_months" />
                </div>
              </div>
              <div class="field">
                <div class="field-box">
                  <label for="f-churn-anchor">Counted from</label>
                  <select id="f-churn-anchor" class="select" name="churn_anchor">
                    <option value="bonus_received" ${o.churn_anchor === 'bonus_received' || !o.churn_anchor ? 'selected' : ''}>From bonus received</option>
                    <option value="account_closed" ${o.churn_anchor === 'account_closed' ? 'selected' : ''}>From account closed</option>
                    <option value="account_opened" ${o.churn_anchor === 'account_opened' ? 'selected' : ''}>From account opened</option>
                  </select>
                </div>
              </div>
              <div class="field">
                <div class="field-box">
                  <label for="f-churn-notes">Churn notes</label>
                  <input id="f-churn-notes" class="input" type="text" autocomplete="off" placeholder="e.g. once per 12 months" value="${escapeAttr(o.churn_notes || '')}" name="churn_notes" />
                </div>
              </div>
            </div>
            <span class="field-hint">Mark whether this bonus can be earned again later. The eligible-again date (wait months added to the chosen anchor date) shows on the card and in "Upcoming churn dates" on the Overview.</span>
          </div>
          <div class="field"><div class="field-box"><label for="f-notes">Notes</label><textarea id="f-notes" class="textarea" name="notes">${escapeHtml(o.notes || '')}</textarea></div></div>
        </div>
      </form>
      <div class="modal-footer">
        ${isEdit ? `<button class="btn btn-ghost btn-danger" data-action="delete-offer-from-modal" data-id="${o.id}">Delete</button>` : '<span></span>'}
        <div style="display:flex;gap:var(--space-2);">
          ${isEdit ? `<button class="btn btn-secondary" data-action="save-as-template" data-id="${o.id}" title="Save these offer terms as a reusable template (your personal dates, notes and status are not saved)">Save as template</button>` : ''}
          <button class="btn btn-secondary" data-action="close-modal">Cancel</button>
          <button class="btn btn-primary" data-action="save-offer" data-id="${o.id}" data-isedit="${isEdit ? '1' : '0'}">${isEdit ? 'Save changes' : 'Add offer'}</button>
        </div>
      </div>
    </div>
  `;
  modal.classList.add('open');
  modal.dataset.strictClose = '1'; // Require explicit X — don't close on backdrop click or Escape
  setTimeout(() => {
    document.getElementById('f-bank')?.focus();
    // F5: live-filter the template picker list as the user types. Bound here
    // (local DOM target) rather than via the global dispatcher, mirroring the
    // DD-section wiring below. Present only when the picker rendered (templates
    // exist); the ?. guard no-ops on the new-install / edit modal.
    document.getElementById('tpl-search')?.addEventListener('input', filterTemplateList);
    // Wire the offer-type radios to show/hide the DD entries section.
    // Bound here rather than via the global onChange dispatcher because
    // the DOM target — the .dd-section div — is local to this modal.
    const form = document.getElementById('offer-form');
    if (!form) return;
    // Reflect offer-type, DD-requirement, and frequency-unit changes.
    const syncDdSectionUI = () => {
      const type = (form.querySelector('[name="offerType"]:checked') || {}).value;
      const stdDD = type === 'direct-deposit';
      const ddSection = form.querySelector('.dd-section');
      const daysRemain = form.querySelector('#days-remain-field');
      const fundingField = form.querySelector('#funding-date-field');
      const lockFromField = form.querySelector('#lock-from-field');
      const daysLabel = form.querySelector('#days-deposit-label');
      if (ddSection) ddSection.style.display = (type === 'direct-deposit' || type === 'held-and-dd') ? '' : 'none';
      // Standard DD has no hold and no single funding date → hide the
      // hold-day, funding-date, and lock-anchor fields (all held concepts).
      if (daysRemain) daysRemain.style.display = stdDD ? 'none' : '';
      if (fundingField) fundingField.style.display = stdDD ? 'none' : '';
      // Funding date is REQUIRED for Held + DD (it's when the held lump sum is
      // deposited — drives the chart + hold), but optional for new-funds-held
      // (falls back to the signup date).
      const fundedLabel = form.querySelector('#f-funded-label');
      if (fundedLabel) fundedLabel.textContent = (type === 'held-and-dd') ? 'Planned funding date *' : 'Planned funding date (optional)';
      if (lockFromField) lockFromField.style.display = stdDD ? 'none' : '';
      // The deposit-deadline field is a DD-completion deadline for DD
      // offers, a deposit deadline otherwise.
      if (daysLabel) daysLabel.textContent = stdDD ? 'Complete DDs within X days of sign up' : 'Days after sign up to deposit';
      const hint = form.querySelector('#dd-section-hint');
      if (hint) {
        hint.innerHTML = (type === 'held-and-dd')
          ? `Plan each DD's <strong>initiation</strong> date. For Held + DD the DDs are qualifying transactions; the hold period set below still governs when funds release. Dates auto-shift to the next business day on a weekend/holiday.`
          : `Plan each DD's <strong>initiation</strong> date. Standard DD ties up the money only for its transfer round trip; plan the first DD early so you have time to retry from another bank if it doesn't code as a direct deposit. Dates auto-shift to the next business day on a weekend/holiday.`;
      }
      // When a DD-type section is shown with no rows yet, auto-populate
      // from the requirement controls. This fires both at open (for an
      // already-DD offer) AND when the user switches the type TO a DD
      // variant — which is the case the open-time check missed.
      const entries = form.querySelector('#dd-entries');
      if ((type === 'direct-deposit' || type === 'held-and-dd') && entries && !entries.querySelector('.dd-row')) {
        generateDdDatesFromRequirement();
      }
    };
    const syncReqMode = () => {
      const mode = (form.querySelector('[name="ddReqMode"]:checked') || {}).value || 'count';
      const cf = form.querySelector('#ddreq-count-fields');
      const ff = form.querySelector('#ddreq-freq-fields');
      if (cf) cf.style.display = mode === 'count' ? '' : 'none';
      if (ff) ff.style.display = mode === 'frequency' ? 'flex' : 'none';
    };
    const syncFreqUnit = () => {
      const every = (form.querySelector('#ddreq-freq-every') || {}).value || 'month';
      const unit = form.querySelector('#ddreq-freq-unit');
      if (unit) unit.textContent = every === 'week' ? 'weeks' : every === '2weeks' ? 'cycles' : 'months';
    };
    // Once the account is open the signup already happened; drop "Planned".
    const syncSignupLabel = () => {
      const acct = form.querySelector('#f-accountstatus');
      const lbl = form.querySelector('label[for="f-signup"]');
      if (acct && lbl) lbl.textContent = acct.value === 'open' ? 'Sign up date *' : 'Planned sign up date *';
    };
    form.addEventListener('change', (ev) => {
      if (!ev.target) return;
      // DoC-import preview checkbox toggled → live-update the "Apply N" count.
      if (ev.target.classList && ev.target.classList.contains('doc-check')) {
        // Record the user's explicit choice so it survives tier switches (P2b).
        const row = ev.target.closest('.doc-field');
        const key = row ? row.getAttribute('data-doc-key') : null;
        if (key) _docUserChecks[key] = ev.target.checked;
        docImportUpdateApplyCount();
        return;
      }
      // DoC-import tier radio chosen → re-render the preview from the new
      // selection (updates bonus/funding rows + their checked state live).
      if (ev.target.classList && ev.target.classList.contains('doc-tier-radio')) { docTierSelect(Number(ev.target.value)); return; }
      if (ev.target.name === 'offerType') syncDdSectionUI();
      if (ev.target.name === 'ddReqMode') { syncReqMode(); generateDdDatesFromRequirement(); }
      if (ev.target.id === 'ddreq-freq-every') syncFreqUnit();
      // Auto-set account status from the offer status, BOTH directions:
      // an auto-open status (approved/on-track/met-waiting/earned/didnt-track)
      // flips the account Open; any other status (prospect/applied/denied/
      // archived) reverts it Closed — via defaultAccountForSub, the single
      // source of the open/closed classification. Updates the dependent
      // control live, same UX as before.
      if (ev.target.id === 'f-substatus') {
        const acct = form.querySelector('#f-accountstatus');
        if (acct) acct.value = defaultAccountForSub(ev.target.value);
      }
      if (ev.target.id === 'f-substatus' || ev.target.id === 'f-accountstatus') { syncSignupLabel(); refreshLifecycleStrip(); refreshClosedDateField(); }
      // Debit-requirement Yes/No → show or hide the count/deadline fields.
      if (ev.target.name === 'debitRequired') {
        const wrap = form.querySelector('#debit-fields-wrap');
        if (wrap) wrap.style.display = ev.target.value === 'yes' ? '' : 'none';
      }
      // Auto-populate the DD rows when the requirement count/frequency
      // changes, so the right number of dated rows appears without an
      // extra click. (The explicit "Generate dates" button stays too.)
      if (ev.target.id === 'ddreq-count-n' || ev.target.id === 'ddreq-freq-every' || ev.target.id === 'ddreq-freq-periods') {
        generateDdDatesFromRequirement();
      }
      // Re-render DD rows when a date changes so the round-trip info
      // (posts/back-by/tied-up days) updates. Re-render from the live
      // snapshot so amounts entered are preserved.
      if (ev.target.dataset && ev.target.dataset.ddField === 'plannedDate') {
        const entries = form.querySelector('#dd-entries');
        if (entries) {
          const snap = readDdRowsFromForm();
          entries.innerHTML = snap.map((dd, i) => renderDdRow(dd, i)).join('');
        }
      }
      // Requirements section — forward write-through on a select change
      // (type/frequency); text/number selects fire change on commit.
      if (ev.target.classList && ev.target.classList.contains('req-input')) {
        handleRequirementInput(ev.target);
      }
      // Reverse write-through: a legacy field that a derived row mirrors
      // changed → rebuild the section so its auto rows reflect the new value
      // (design §B, both directions). On `change` (commit), not per keystroke,
      // to avoid feedback with the forward path's dispatched input events.
      // Also covers structural changes (offer type, DD-req mode, debit Yes/No)
      // that add/remove derived rows.
      if (ev.target.id === 'f-funding' || ev.target.id === 'f-days-deposit' ||
          ev.target.id === 'f-days-remain' || ev.target.id === 'f-debit-count' ||
          ev.target.id === 'f-debit-within' || ev.target.id === 'ddreq-count-n' ||
          ev.target.id === 'ddreq-freq-periods' || ev.target.id === 'ddreq-freq-every' ||
          ev.target.name === 'offerType' || ev.target.name === 'ddReqMode' ||
          ev.target.name === 'debitRequired' ||
          (ev.target.dataset && (ev.target.dataset.ddField === 'amount' || ev.target.dataset.ddField === 'plannedDate'))) {
        refreshRequirementsSection();
      }
    });
    // Generate-dates button (delegated click).
    form.addEventListener('click', (ev) => {
      if (ev.target && ev.target.id === 'ddreq-generate') {
        ev.preventDefault();
        generateDdDatesFromRequirement();
      }
    });
    // Color swatch picker — click swaps the selected swatch and writes
    // the new color name into the hidden #f-color input so FormData
    // picks it up at save time. Disabled swatches (in-use by another
    // offer) ignore clicks.
    form.addEventListener('click', (ev) => {
      const sw = ev.target.closest('.color-swatch');
      if (!sw || sw.disabled) return;
      ev.preventDefault();
      const val = sw.dataset.color || '';
      const hidden = form.querySelector('#f-color');
      if (hidden) hidden.value = val;
      form.querySelectorAll('.color-swatch').forEach(s => s.classList.toggle('selected', s === sw));
    });
    // Live "latest safe funding date" hint — recompute whenever the
    // planned sign-up date or the days-after-sign-up window changes.
    // #f-signup holds a M-D-YYYY DISPLAY string (R62), so parse it back to
    // ISO via parseDateInput before handing it to suggestedFundingDate
    // (which expects ISO) — without this the hint silently stopped updating
    // on a typed date. #f-days-deposit is a type=number field, so its raw
    // value is already a plain number string.
    const refreshFundingSuggest = () => {
      const sEl = form.querySelector('#f-signup');
      const dEl = form.querySelector('#f-days-deposit');
      const out = form.querySelector('#f-funded-suggest');
      if (!out) return;
      const sug = suggestedFundingDate(parseDateInput((sEl && sEl.value) || ''), dEl && dEl.value);
      out.innerHTML = sug
        ? `Latest safe funding: <strong style="color:var(--text-secondary);">${formatDateMedium(sug)}</strong> (1-day buffer before the deposit deadline, on a business day)`
        : '';
    };
    // Live derived debit-completion deadline — recompute whenever the
    // planned sign-up date or the debit day-count changes. Nothing shown
    // until a sign-up date exists (matches debitDeadlineISO's underivable
    // → '' rule). Parse the sign-up field via parseDateInput because it
    // holds a M-D-YYYY display string, not raw ISO.
    const refreshDebitDeadline = () => {
      const out = form.querySelector('#f-debit-deadline');
      if (!out) return;
      const sEl = form.querySelector('#f-signup');
      const dEl = form.querySelector('#f-debit-within');
      const dl = debitDeadlineISO({
        plannedSignupDate: parseDateInput((sEl && sEl.value) || ''),
        debitRequirement: { required: true, withinDays: dEl && dEl.value }
      });
      out.innerHTML = dl
        ? `Complete by: <strong style="color:var(--text-secondary);">${formatDateMedium(dl)}</strong>`
        : '';
    };
    form.addEventListener('input', (ev) => {
      if (ev.target && (ev.target.id === 'f-signup' || ev.target.id === 'f-days-deposit')) {
        refreshFundingSuggest();
      }
      if (ev.target && (ev.target.id === 'f-signup' || ev.target.id === 'f-debit-within')) {
        refreshDebitDeadline();
      }
      // Requirements: forward write-through per keystroke for text/number/money
      // inputs inside the section (updates the row's legacy target + live date
      // in place, preserving caret). Selects are handled on `change` above.
      if (ev.target && ev.target.classList && ev.target.classList.contains('req-input') && ev.target.tagName !== 'SELECT') {
        handleRequirementInput(ev.target);
      }
      // Sign-up date changed → re-date every requirement row (derived deadlines
      // are stored as day-counts, so only the computed absolute date moves).
      if (ev.target && ev.target.id === 'f-signup') {
        refreshRequirementDates();
      }
    });
    // Run the section sync once at open. This shows/hides the DD section
    // for the current type AND auto-populates DD rows if the section is
    // visible but empty (covers an already-DD offer opened fresh).
    syncDdSectionUI();
  }, 50);
}

// One row in the planned-DD list inside the Add-Offer modal. Each row
// carries its planned date + amount; the effective (business-day-aware)
// date is computed and shown as a subtle hint when the two differ. The
// row's index is used by remove-dd-row to find which row to delete.
function renderDdRow(dd, i) {
  const planned = dd && dd.plannedDate ? parseDate(dd.plannedDate) : null;
  const effISO = directDepositEffectiveDate(dd || {});
  const eff = effISO ? parseDate(effISO) : null;
  const adjusted = planned && eff && planned.getTime() !== eff.getTime();
  const rt = (dd && dd.plannedDate) ? ddRoundTrip(dd) : null;
  let info = '';
  if (rt) {
    info = `Posts ${formatDateMedium(rt.post)} · back by ${formatDateMedium(rt.returnDate)} · tied up ${rt.heldDays}d`
      + (adjusted ? ` · initiation shifted from ${formatDateMedium(planned)} (${isUsBankHoliday(planned) ? 'holiday' : 'weekend'})` : '');
  }
  return `
    <div class="dd-row" data-dd-index="${i}" data-dd-id="${escapeAttr((dd && dd.id) || '')}" style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:start;margin-bottom:6px;">
      <input type="text" inputmode="numeric" autocomplete="off" placeholder="M-D-YYYY" class="input dd-field yv-date" data-dd-field="plannedDate" data-picker-mode="dd" value="${escapeAttr(formatDateDisplay(dd && dd.plannedDate || ''))}" aria-label="Initiation date for DD ${i + 1}" />
      <div class="input-group"><span class="input-prefix">$</span>
        <input type="text" inputmode="decimal" data-money class="input dd-field" data-dd-field="amount" value="${dd && dd.amount != null ? formatMoneyInput(dd.amount) : ''}" aria-label="Amount for DD ${i + 1}" />
      </div>
      <button type="button" class="btn-icon" data-action="remove-dd-row" aria-label="Remove DD ${i + 1}" title="Remove">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
      </button>
      ${info ? `<div style="grid-column:1 / -1;font-size:11px;color:var(--text-tertiary);margin-top:-2px;">${info}</div>` : ''}
    </div>
  `;
}

/* ============================================================
   REQUIREMENTS SECTION (step 3): offer-modal editor
   ============================================================
   Renders every requirement row (derived + user) with a live computed
   calendar deadline. Derived rows REFLECT the legacy inputs elsewhere in the
   form: editing a derived row's amount/count/deadline WRITES THROUGH to the
   canonical legacy input (design §B), so readOfferForm's normal flow captures
   it and syncRequirementsWithLegacy re-derives consistently. done/done_date/
   notes live on the row (toggled from the card, not here). User rows have no
   legacy equivalent — they ride in a hidden JSON field (#f-user-reqs) so new
   ones survive to readOfferForm, which merges them back into requirements[]. */

// The legacy form input a derived row's field writes through to (design §B).
// Returns { sel, kind } where kind is 'money' | 'number' | null (null → the
// field is not writable-through here, e.g. a per-DD deadline that is derived
// from the DD's own planned date and edited in the DD list, not here).
function requirementWriteThroughTarget(row, field) {
  if (!row || row.source !== 'derived') return null;
  if (row.id === 'req-funding') {
    if (field === 'amount') return { sel: '#f-funding', kind: 'money' };
    if (field === 'deadline_days') return { sel: '#f-days-deposit', kind: 'number' };
  } else if (row.id === 'req-debit') {
    if (field === 'count') return { sel: '#f-debit-count', kind: 'number' };
    if (field === 'deadline_days') return { sel: '#f-debit-within', kind: 'number' };
  } else if (row.id === 'req-ddreq') {
    // The derived DD-count row mirrors the DD requirement's count. In count
    // mode that's #ddreq-count-n; in frequency mode the count is the number of
    // periods (#ddreq-freq-periods), and #ddreq-count-n is hidden + ignored by
    // readOfferForm — so writing there would be silently discarded. Route to
    // whichever input is actually live so the edit round-trips.
    if (field === 'count') {
      const freqOn = document.querySelector('#ddreq-freq');
      const sel = (freqOn && freqOn.checked) ? '#ddreq-freq-periods' : '#ddreq-count-n';
      return { sel, kind: 'number' };
    }
  } else if (row.id && row.id.indexOf('req-dd-') === 0) {
    if (field === 'amount') return { sel: `.dd-row[data-dd-id="${row.id.slice('req-dd-'.length)}"] [data-dd-field="amount"]`, kind: 'money' };
    // per-DD deadline is derived from the DD's planned date → not editable here.
  }
  return null;
}

// True when a derived row's field is editable in this section (has a write-
// through target). User-row fields are always editable for their type.
function requirementFieldEditable(row, field) {
  if (!row) return false;
  if (row.source === 'user') return true;
  return requirementWriteThroughTarget(row, field) != null;
}

// One requirement row in the modal editor. `i` indexes user rows within the
// hidden JSON payload (derived rows pass i = -1). Renders type, optional custom
// label, amount and/or count (only the inputs the type uses), deadline_days,
// frequency, a live computed date, and (user rows only) a remove button.
function renderRequirementRow(row, offer, i) {
  const meta = REQUIREMENT_TYPE_META[row.type] || REQUIREMENT_TYPE_META.custom;
  const isDerived = row.source === 'derived';
  const idAttr = escapeAttr(row.id || '');
  const dataAttrs = `data-req-id="${idAttr}" data-req-source="${row.source}" data-req-index="${i}"`;
  // Amount/count exposure: derived rows show whatever numeric they carry
  // (so a per-DD amount shows even though its meta says money); user rows use
  // their type meta.
  const showMoney = isDerived ? (row.amount != null || meta.money) : meta.money;
  const showCount = isDerived ? (row.count != null || meta.count) : meta.count;
  const dlISO = requirementDeadlineISO(offer, row);
  const typeCell = isDerived
    ? `<span class="req-type-label">${escapeHtml(meta.label)}<span class="req-auto-tag" title="Mirrors a field above — edit here or there.">auto</span></span>`
    : `<select class="select req-input" ${dataAttrs} data-req-field="type" aria-label="Requirement type">
         ${REQUIREMENT_TYPES.map(t => `<option value="${t}" ${row.type === t ? 'selected' : ''}>${escapeHtml(REQUIREMENT_TYPE_META[t] ? REQUIREMENT_TYPE_META[t].label : t)}</option>`).join('')}
       </select>`;
  const labelCell = (!isDerived && row.type === 'custom')
    ? `<input type="text" class="input req-input" ${dataAttrs} data-req-field="label" placeholder="Label" value="${escapeAttr(row.label || '')}" aria-label="Custom requirement label" />`
    : '';
  const amountCell = showMoney
    ? `<div class="input-group"><span class="input-prefix">$</span>
         <input type="text" inputmode="decimal" data-money class="input req-input" ${dataAttrs} data-req-field="amount" value="${row.amount != null ? formatMoneyInput(row.amount) : ''}" aria-label="Amount" />
       </div>`
    : '';
  const countCell = showCount
    ? `<div class="input-group with-suffix">
         <input type="number" min="0" step="1" class="input req-input" ${dataAttrs} data-req-field="count" value="${row.count != null ? escapeAttr(row.count) : ''}" aria-label="Count" />
         <span class="input-suffix">×</span>
       </div>`
    : '';
  // Per-DD deadline is DD-derived (read-only here); all others are editable.
  const deadlineEditable = requirementFieldEditable(row, 'deadline_days');
  const deadlineCell = deadlineEditable
    ? `<div class="input-group with-suffix">
         <input type="number" min="0" step="1" class="input req-input" ${dataAttrs} data-req-field="deadline_days" value="${row.deadline_days != null ? escapeAttr(row.deadline_days) : ''}" aria-label="Deadline (days after sign up)" />
         <span class="input-suffix">d</span>
       </div>`
    : `<span class="req-deadline-ro" title="Derived from this deposit's planned date">${row.deadline_days != null ? `+${row.deadline_days}d` : '—'}</span>`;
  const freqCell = (showCount || (!isDerived && row.type === 'custom'))
    ? `<select class="select req-input" ${dataAttrs} data-req-field="frequency" aria-label="Frequency">
         ${REQUIREMENT_FREQUENCIES.map(f => `<option value="${f}" ${row.frequency === f ? 'selected' : ''}>${REQUIREMENT_FREQ_LABELS[f]}</option>`).join('')}
       </select>`
    : '';
  const removeCell = isDerived
    ? ''
    : `<button type="button" class="btn-icon" data-action="remove-req-row" data-req-index="${i}" aria-label="Remove requirement" title="Remove">
         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
       </button>`;
  return `
    <div class="req-row ${isDerived ? 'req-derived' : 'req-user'}" ${dataAttrs}>
      <div class="req-row-main">
        <div class="req-cell req-cell-type">${typeCell}</div>
        ${labelCell ? `<div class="req-cell req-cell-label">${labelCell}</div>` : ''}
        ${amountCell ? `<div class="req-cell req-cell-amount">${amountCell}</div>` : ''}
        ${countCell ? `<div class="req-cell req-cell-count">${countCell}</div>` : ''}
        <div class="req-cell req-cell-deadline">${deadlineCell}</div>
        ${freqCell ? `<div class="req-cell req-cell-freq">${freqCell}</div>` : ''}
        <div class="req-cell req-cell-remove">${removeCell}</div>
      </div>
      <div class="req-row-date" data-req-date-for="${idAttr}">${dlISO ? `Due <strong>${formatDateMedium(dlISO)}</strong>` : `<span class="req-nodate">No date${row.deadline_days == null ? ' — set a deadline' : ' — set a sign-up date'}</span>`}</div>
    </div>`;
}

// Render all requirement rows for the modal + the hidden user-rows JSON field.
// Order: derived rows in derive() order (already how requirements[] is stored),
// then user rows. User rows are indexed for the hidden-payload/remove wiring.
function renderRequirementRows(offer) {
  const reqs = Array.isArray(offer.requirements) ? offer.requirements : [];
  const derived = reqs.filter(r => r && r.source === 'derived');
  const user = reqs.filter(r => r && r.source === 'user');
  const rowsHtml = derived.map(r => renderRequirementRow(r, offer, -1)).join('')
    + user.map((r, i) => renderRequirementRow(r, offer, i)).join('');
  const empty = (derived.length + user.length) === 0
    ? `<div class="req-empty">No requirements yet — the fields above populate these automatically, or add one below.</div>`
    : '';
  const hidden = `<input type="hidden" id="f-user-reqs" name="userReqs" value="${escapeAttr(JSON.stringify(user))}" />`;
  return rowsHtml + empty + hidden;
}

// Parse the hidden user-rows JSON payload (#f-user-reqs). Never throws — a
// corrupt/absent value yields []. Each row is normalized through
// makeRequirementRow so downstream code sees a full row shape.
function readUserReqsFromForm() {
  const el = document.getElementById('f-user-reqs');
  if (!el) return [];
  let arr;
  try { arr = JSON.parse(el.value || '[]'); } catch (e) { arr = []; }
  if (!Array.isArray(arr)) return [];
  return arr.map(r => makeRequirementRow(Object.assign({}, r, { source: 'user' })));
}

// Serialize user rows back into the hidden payload so they survive to
// readOfferForm (which merges them into requirements[] before the derived sync).
function writeUserReqsToForm(rows) {
  const el = document.getElementById('f-user-reqs');
  if (el) el.value = JSON.stringify(rows || []);
}

// Build a minimal offer object from the CURRENT form values (legacy fields +
// user rows) and run syncRequirementsWithLegacy so the derived rows reflect the
// live inputs. Used to re-render the requirements section after a change and to
// recompute live deadline dates against the currently-typed sign-up date.
function buildLiveRequirementsOffer() {
  const form = document.getElementById('offer-form');
  if (!form) return { requirements: [] };
  const qv = (sel) => { const el = form.querySelector(sel); return el ? el.value : ''; };
  const offerType = (form.querySelector('[name="offerType"]:checked') || {}).value || 'new-funds-held';
  const debitRequired = (form.querySelector('[name="debitRequired"]:checked') || {}).value === 'yes';
  const ddReqMode = (form.querySelector('[name="ddReqMode"]:checked') || {}).value === 'frequency' ? 'frequency' : 'count';
  const numOrNull = (v) => (v === '' || v == null) ? null : Number(v);
  const offer = {
    offerType,
    plannedSignupDate: parseDateInput(qv('#f-signup')) || '',
    requiredFundingAmount: parseMoneyInput(qv('#f-funding')),
    daysAfterSignupAllowedBeforeDeposit: numOrNull(qv('#f-days-deposit')),
    daysFundsMustRemain: offerType === 'direct-deposit' ? null : numOrNull(qv('#f-days-remain')),
    directDeposits: readDdRowsFromForm(),
    ddRequirement: {
      mode: ddReqMode,
      count: Math.max(1, Math.min(24, Number(qv('#ddreq-count-n')) || 1)),
      freqEvery: qv('#ddreq-freq-every') || 'month',
      freqPeriods: Math.max(1, Math.min(24, Number(qv('#ddreq-freq-periods')) || 3))
    },
    debitRequirement: {
      required: debitRequired,
      count: debitRequired ? (numOrNull(qv('#f-debit-count'))) : null,
      withinDays: debitRequired ? numOrNull(qv('#f-debit-within')) : null,
      byDate: '', byDateLegacy: ''
    },
    // Seed with the user rows so syncRequirementsWithLegacy preserves them
    // (it only touches derived rows) and appends fresh derived rows around them.
    requirements: readUserReqsFromForm()
  };
  syncRequirementsWithLegacy(offer);
  return offer;
}

// Full re-render of the modal requirements section from the live form state.
// Used after add/remove and after a legacy field changes (reverse write-
// through). Forward per-keystroke edits inside the section update in place
// instead (see the modal input handler) so focus/caret are preserved.
function refreshRequirementsSection() {
  const host = document.getElementById('req-rows');
  if (!host) return;
  const offer = buildLiveRequirementsOffer();
  host.innerHTML = renderRequirementRows(offer);
}

// Live re-render of the modal's slim lifecycle strip + info block when the
// status selects change, so the pipeline advances in place without reopening
// the modal. Builds a status-aware live offer (the requirements offer extended
// with the currently-selected accountStatus/subStatus + bonus-received field)
// and feeds it through the same render path the card uses. The expected-bonus
// anchor is approximate here (modal req rows aren't done-toggled), which is fine
// for a live preview; the card recomputes authoritatively after save.
function refreshLifecycleStrip() {
  const host = document.getElementById('f-lifecycle-strip');
  if (!host) return;
  const form = document.getElementById('offer-form');
  if (!form) return;
  const sub = (form.querySelector('#f-substatus') || {}).value || 'prospect';
  const acct = (form.querySelector('#f-accountstatus') || {}).value || 'closed';
  const brEl = form.querySelector('#f-bonus-received');
  const offer = Object.assign(buildLiveRequirementsOffer(), {
    subStatus: sub,
    accountStatus: acct,
    bonus_received_date: brEl ? (parseDateInput(brEl.value) || null) : null
  });
  host.innerHTML = renderPipelineStrip(offer, { slim: true }) + renderLifecycleInfo(offer);
}

// R69 (Item A): show/hide the conditional "Closed date" field to mirror EXACTLY
// the reconcileClosedDate stamp guard — visible iff the account is closed AND the
// sub-status isn't a pre-account one — so what the user sees is exactly what
// anchors churn. On a fresh flip-to-closed with no date yet, default to today
// (still editable/backdatable). When hidden, clear the value so a stale date can
// never submit ("what's visible = what anchors").
function refreshClosedDateField() {
  const form = document.getElementById('offer-form');
  if (!form) return;
  const wrap = form.querySelector('#f-closed-date-field');
  const input = form.querySelector('#f-closed');
  if (!wrap || !input) return;
  const sub = (form.querySelector('#f-substatus') || {}).value || 'prospect';
  const acct = (form.querySelector('#f-accountstatus') || {}).value || 'closed';
  const show = acct === 'closed' && !PRE_ACCOUNT_SUB_STATUSES.has(sub);
  if (show) {
    // Prefill precedence when the field is empty: (1) the input's OWN preserved
    // value — implicit: we never clear on hide, so a Closed→Open→Closed flap
    // keeps the user's backdate; (2) the offer's stored closed_date (data-stored);
    // (3) today, only when truly nothing exists yet (a genuine fresh close).
    if (!input.value.trim()) {
      const stored = input.getAttribute('data-stored') || '';
      input.value = stored ? formatDateDisplay(stored) : formatDateDisplay(isoDate(TODAY));
    }
    input.disabled = false;
    wrap.style.display = '';
  } else {
    // Hide by DISABLING, not clearing (P1 fix): a disabled input is absent from
    // FormData — so a stale/hidden date can never submit — while KEEPING its typed
    // value, so toggling Closed→Open→Closed restores the user's backdate instead
    // of silently stamping today. The reopen→SAVE clear still works: the disabled
    // field is absent from FormData, `readOfferForm` sets `closed_date:
    // dateIso(undefined) || null` → null (overriding the prior-offer spread), and
    // reconcileClosedDate's closed→open branch confirms the null.
    input.disabled = true;
    wrap.style.display = 'none';
  }
}

// Recompute ONLY the live deadline-date lines in the section (no re-render), so
// changing the sign-up date re-dates every row without disturbing focus.
function refreshRequirementDates() {
  const host = document.getElementById('req-rows');
  if (!host) return;
  const offer = buildLiveRequirementsOffer();
  const byId = new Map((offer.requirements || []).map(r => [r.id, r]));
  host.querySelectorAll('.req-row-date').forEach(node => {
    const id = node.getAttribute('data-req-date-for');
    const row = byId.get(id);
    if (!row) return;
    const dlISO = requirementDeadlineISO(offer, row);
    node.innerHTML = dlISO
      ? `Due <strong>${formatDateMedium(dlISO)}</strong>`
      : `<span class="req-nodate">No date${row.deadline_days == null ? ' — set a deadline' : ' — set a sign-up date'}</span>`;
  });
}

// Forward write-through for an in-section edit (fired on input/change of a
// .req-input). Derived rows mirror the new value into their canonical legacy
// input (design §B) so readOfferForm captures it; user rows persist into the
// hidden JSON payload. Either way the edited row's live date is recomputed in
// place (no full re-render → caret/focus preserved). `el` is the changed input.
function handleRequirementInput(el) {
  if (!el || !el.dataset) return;
  const id = el.dataset.reqId || '';
  const field = el.dataset.reqField;
  const source = el.dataset.reqSource;
  if (!field) return;

  if (source === 'derived') {
    // Mirror to the legacy input. Money fields carry a comma-grouped display;
    // parse to a plain-number string before writing so the legacy field (also
    // data-money) reformats cleanly and readOfferForm parses it back.
    const tgt = requirementWriteThroughTarget({ id, source: 'derived' }, field);
    if (tgt) {
      const legacy = document.querySelector(tgt.sel);
      if (legacy) {
        if (tgt.kind === 'money') {
          const n = parseMoneyInput(el.value);
          legacy.value = n == null ? '' : formatMoneyInput(n);
        } else {
          legacy.value = el.value;
        }
        // Let dependent hints (funding-suggest, debit-deadline) update too.
        legacy.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  } else if (source === 'user') {
    // Persist the edit into the hidden user-rows payload by index.
    const idx = Number(el.dataset.reqIndex);
    const rows = readUserReqsFromForm();
    if (Number.isFinite(idx) && idx >= 0 && idx < rows.length) {
      const row = rows[idx];
      if (field === 'amount') row.amount = parseMoneyInput(el.value);
      else if (field === 'count') row.count = (el.value === '' ? null : Number(el.value));
      else if (field === 'deadline_days') row.deadline_days = (el.value === '' ? null : Number(el.value));
      else if (field === 'label') row.label = el.value;
      else if (field === 'frequency') row.frequency = el.value;
      else if (field === 'type') {
        row.type = el.value;
        // Type change alters which inputs a user row shows → full re-render.
        writeUserReqsToForm(rows);
        refreshRequirementsSection();
        return;
      }
      writeUserReqsToForm(rows);
    }
  }
  // Recompute just this row's live date line.
  const dateNode = el.closest('.req-row') && el.closest('.req-row').querySelector('.req-row-date');
  if (dateNode) {
    const offer = buildLiveRequirementsOffer();
    const row = (offer.requirements || []).find(r => r.id === id) ||
      (source === 'user' ? (offer.requirements || []).filter(r => r.source === 'user')[Number(el.dataset.reqIndex)] : null);
    if (row) {
      const dlISO = requirementDeadlineISO(offer, row);
      dateNode.innerHTML = dlISO
        ? `Due <strong>${formatDateMedium(dlISO)}</strong>`
        : `<span class="req-nodate">No date${row.deadline_days == null ? ' — set a deadline' : ' — set a sign-up date'}</span>`;
    }
  }
}

// Add a new user requirement row of the chosen type (from #req-add-type).
function addRequirementRow() {
  const sel = document.getElementById('req-add-type');
  const type = (sel && sel.value) || 'custom';
  const rows = readUserReqsFromForm();
  rows.push(makeRequirementRow({ id: uid('req'), type, source: 'user' }));
  writeUserReqsToForm(rows);
  refreshRequirementsSection();
}

// Remove the user requirement row at the given hidden-payload index.
function removeRequirementRow(idx) {
  const i = Number(idx);
  const rows = readUserReqsFromForm();
  if (Number.isFinite(i) && i >= 0 && i < rows.length) {
    rows.splice(i, 1);
    writeUserReqsToForm(rows);
    refreshRequirementsSection();
  }
}

// Build DD rows from the requirement controls + planned signup date.
// First DD is planned EARLY (next business day on/after signup) so
// there's runway to retry from another bank. Subsequent DDs are spaced
// by the chosen cadence. Existing amounts are preserved positionally;
// new rows inherit the prior row's amount (or required funding ÷ count).
function generateDdDatesFromRequirement() {
  const form = document.getElementById('offer-form');
  if (!form) return;
  const entries = form.querySelector('#dd-entries');
  if (!entries) return;
  const mode = (form.querySelector('[name="ddReqMode"]:checked') || {}).value || 'count';
  // #f-signup shows M-D-YYYY display; parse via the date-input helper
  // (parseDate alone would reject the non-ISO string and lose the seed).
  const signup = parseDate(parseDateInput((form.querySelector('#f-signup') || {}).value));
  const baseStart = signup ? addBusinessDays(signup, 1) : addBusinessDays(TODAY, 1);
  const existing = readDdRowsFromForm();
  const fundingEl = form.querySelector('#f-funding');
  // #f-funding shows comma-grouped money; strip commas before dividing.
  const funding = fundingEl && fundingEl.value.trim() ? parseMoneyInput(fundingEl.value) : null;

  let count, stepDays = 0, monthly = false;
  if (mode === 'frequency') {
    const every = (form.querySelector('#ddreq-freq-every') || {}).value || 'month';
    const periods = Math.max(1, Math.min(24, Number((form.querySelector('#ddreq-freq-periods') || {}).value) || 1));
    count = periods;
    if (every === 'week') stepDays = 7;
    else if (every === '2weeks') stepDays = 14;
    else monthly = true;
  } else {
    count = Math.max(1, Math.min(24, Number((form.querySelector('#ddreq-count-n') || {}).value) || 1));
  }
  const defaultAmt = (existing[0] && existing[0].amount) || (funding && count ? Math.round(funding / count) : null);
  const rows = [];
  let cursor = new Date(baseStart);
  for (let k = 0; k < count; k++) {
    const amt = (existing[k] && existing[k].amount != null) ? existing[k].amount : defaultAmt;
    // Keep the existing row's stable id positionally (mint a new one for
    // rows the regenerate adds) so per-DD feed ids don't churn.
    const id = (existing[k] && existing[k].id) || uid('dd');
    rows.push({ id, plannedDate: isoDate(cursor), amount: amt });
    // Advance the cursor for the NEXT deposit.
    if (monthly) cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate());
    else if (stepDays > 0) cursor = addDays(cursor, stepDays);
    else cursor = addBusinessDays(cursor, 3); // count mode: a few business days apart
  }
  entries.innerHTML = rows.map((dd, i) => renderDdRow(dd, i)).join('');
}

// Re-read every .dd-row in the form and return the canonical
// directDeposits[] payload. Called both by readOfferForm() at save
// time and by the add/remove-dd-row handlers when they mutate the
// list (they re-render the section from this snapshot).
function readDdRowsFromForm() {
  const rows = document.querySelectorAll('#dd-entries .dd-row');
  const out = [];
  rows.forEach(row => {
    const dateEl = row.querySelector('[data-dd-field="plannedDate"]');
    const amtEl  = row.querySelector('[data-dd-field="amount"]');
    // Preserve (or mint) the per-DD stable id so feed items keyed
    // `yv-<offerId>-dd-<ddId>` never migrate completion state onto the
    // wrong DD across insert/reorder/delete (step-6 amendment 5). The id
    // lives in the row's data-dd-id and is re-read on every form mutation.
    const ddId = (row.dataset.ddId && row.dataset.ddId.trim()) ? row.dataset.ddId.trim() : uid('dd');
    // Date field shows M-D-YYYY; amount shows comma-grouped money.
    // Parse both back to storage form (ISO string / plain Number).
    out.push({
      id: ddId,
      plannedDate: dateEl ? (parseDateInput(dateEl.value) || '') : '',
      amount: amtEl && amtEl.value.trim() !== '' ? parseMoneyInput(amtEl.value) : null
    });
  });
  return out;
}

function addDdRow() {
  const entries = document.getElementById('dd-entries');
  if (!entries) return;
  const current = readDdRowsFromForm();
  current.push({ id: uid('dd'), plannedDate: '', amount: null });
  entries.innerHTML = current.map((dd, i) => renderDdRow(dd, i)).join('');
}

function removeDdRow(rowEl) {
  const entries = document.getElementById('dd-entries');
  if (!entries || !rowEl) return;
  const idx = Number(rowEl.dataset.ddIndex);
  const current = readDdRowsFromForm();
  if (Number.isFinite(idx) && idx >= 0 && idx < current.length) {
    current.splice(idx, 1);
  }
  entries.innerHTML = current.map((dd, i) => renderDdRow(dd, i)).join('');
}

function readOfferForm(idArg, isEdit) {
  const form = document.getElementById('offer-form');
  if (!form) return null;
  const fd = new FormData(form);
  const data = Object.fromEntries(fd.entries());
  const num = (v) => (v === '' || v == null) ? null : Number(v);
  // Money fields render with thousands commas ("25,000"); strip to a
  // plain Number so a comma can never poison the stored value.
  const money = (v) => parseMoneyInput(v);
  // yv-date fields now hold M-D-YYYY display strings; parse back to
  // canonical ISO for storage (empty/unparseable -> '' as before).
  const dateIso = (v) => parseDateInput(v) || '';

  const offerType = data.offerType || 'new-funds-held';
  // DD requirement controls aren't form-named (id-only), so read directly.
  const qval = (sel) => { const el = form.querySelector(sel); return el ? el.value : ''; };
  const ddRequirement = {
    mode: (data.ddReqMode === 'frequency') ? 'frequency' : 'count',
    count: Math.max(1, Math.min(24, Number(qval('#ddreq-count-n')) || 1)),
    freqEvery: qval('#ddreq-freq-every') || 'month',
    freqPeriods: Math.max(1, Math.min(24, Number(qval('#ddreq-freq-periods')) || 3))
  };
  // Standard DD has no bank hold — null out daysFundsMustRemain so the
  // round-trip model governs and validation doesn't demand it.
  const daysRemain = offerType === 'direct-deposit' ? null : num(data.daysFundsMustRemain);
  // Debit deadline is now a day-count from sign-up (withinDays), not an
  // absolute date. Carry forward any preserved legacy absolute deadline
  // (byDateLegacy) from the offer being edited so a constraint saved before
  // this offer had a sign-up date is never lost on re-save; byDate itself is
  // retired (kept as '' for backward-compatible payload shape).
  const prior = isEdit ? (App.state.offers || []).find(x => x.id === idArg) : null;
  const priorLegacy = (prior && prior.debitRequirement && prior.debitRequirement.byDateLegacy) || '';
  const debitRequirement = {
    required: data.debitRequired === 'yes',
    count: data.debitRequired === 'yes' ? (num(data.debitCount) || null) : null,
    withinDays: data.debitRequired === 'yes' ? num(data.debitWithinDays) : null,
    byDate: '',
    byDateLegacy: data.debitRequired === 'yes' ? priorLegacy : ''
  };

  const offer = {
    // v2 scalar defaults FIRST, then the prior offer over them: unknown / schema-
    // v2 keys (requirements[], churn/fee/promo, last_edited) on the prior survive
    // a form save, AND any v2 scalar the prior predates (an offer last written
    // before v2, e.g. one adopted from an older cloud/import) is backfilled rather
    // than left undefined. The fixed field reads below overwrite every KNOWN
    // field, so both spreads are inert for them — minimal-diff, no behavior change
    // for known fields. requirements[] is filled by syncRequirementsWithLegacy().
    ...schemaV2Defaults(),
    ...(prior || {}),
    id: idArg,
    bankName: (data.bankName || '').trim(),
    offerName: (data.offerName || '').trim(),
    offerType,
    ddRequirement,
    debitRequirement,
    color: data.color || '',
    directDeposits: readDdRowsFromForm()
      .filter(dd => dd.plannedDate || (dd.amount != null && dd.amount > 0)),
    requiredFundingAmount: money(data.requiredFundingAmount),
    signupBonusAmount: money(data.signupBonusAmount),
    offerExpirationDate: dateIso(data.offerExpirationDate),
    plannedSignupDate: dateIso(data.plannedSignupDate),
    daysAfterSignupAllowedBeforeDeposit: num(data.daysAfterSignupAllowedBeforeDeposit) ?? 30,
    daysFundsMustRemain: daysRemain,
    optionalPlannedFundingDate: dateIso(data.optionalPlannedFundingDate),
    lockStartsFrom: data.lockStartsFrom || 'funded date',
    accountStatus: data.accountStatus || 'closed',
    subStatus: data.subStatus || 'prospect',
    // status is the derived shadow — set below via normalizeOfferStatus.
    status: 'prospect',
    includeInScenario: form.querySelector('[name="includeInScenario"]').checked,
    confidence: data.confidence || 'likely',
    notes: data.notes || '',
    docUrl: data.docUrl || '',
    entityUsed: data.entityUsed || '',
    emailUsed: data.emailUsed || '',
    // Lifecycle (F3): the bonus-received anchor date, read from the Advanced
    // field. dateIso → '' when empty; store null (not '') so the "no date"
    // consumers (expectedBonusWindow, safeToCloseDate) treat it uniformly.
    bonus_received_date: dateIso(data.bonus_received_date) || null,
    // Lifecycle (F3 / R69 Item A): the account-closed anchor date, read from the
    // conditional "Closed date" field by the status selects. Overrides the prior
    // spread so the user's value is authoritative; reconcileClosedDate (below)
    // only fills it when left blank on a fresh close, so a backdate always wins.
    closed_date: dateIso(data.closed_date) || null,
    // Churnability (F6): read the Advanced churn sub-group. churnable is a
    // tri-state select ('' → null unknown, 'true' → true, 'false' → false), NOT
    // a money/number field. Wait-months is a plain null-safe number; anchor
    // defaults to bonus_received; notes is trimmed text. These overwrite the
    // spread-in defaults/prior so the inputs are authoritative on every save.
    churnable: data.churnable === 'true' ? true : (data.churnable === 'false' ? false : null),
    churn_wait_months: num(data.churn_wait_months),
    churn_anchor: data.churn_anchor || 'bonus_received',
    churn_notes: (data.churn_notes || '').trim(),
    // Promoted scalars (F4): the Advanced "Fees & terms" group. Money fields go
    // through parseMoneyInput (empty → null, comma-safe); day-counts through the
    // null-safe num(); text fields trimmed to '' when blank. These overwrite the
    // spread-in defaults/prior so the inputs are authoritative on every save. The
    // lifecycle/close-safety code already consumes bonus_post_*_days and
    // etf_window_days; monthly_fee/fee_waiver_condition/promo_code are display.
    monthly_fee: money(data.monthly_fee),
    fee_waiver_condition: (data.fee_waiver_condition || '').trim(),
    promo_code: (data.promo_code || '').trim(),
    early_termination_fee: money(data.early_termination_fee),
    etf_window_days: num(data.etf_window_days),
    bonus_post_min_days: num(data.bonus_post_min_days),
    bonus_post_max_days: num(data.bonus_post_max_days),
    // Schema v2: stamp the edit time on every save (overwrites any spread-in
    // prior value). Migrated offers carry last_edited:null until first edited.
    last_edited: new Date().toISOString()
  };
  normalizeOfferStatus(offer); // sync the legacy shadow status
  // Lifecycle (F3): keep closed_date consistent with the account state on the
  // save path (no migration needed — this fires on the status change itself).
  // Shared with the inline 'change-status' handler via reconcileClosedDate so
  // the close/reopen semantics can't drift. `prior` is undefined for a NEW
  // offer → the reopen branch can't fire, and a brand-new closed offer still
  // stamps (matches the pre-helper behavior exactly).
  reconcileClosedDate(offer, prior && prior.accountStatus);
  // Schema v2 (step 3): assemble requirements[] before the derived sync.
  //   • User rows come from the modal's hidden #f-user-reqs payload — that's
  //     the authoritative latest state of every user-added/edited row (their
  //     done/done_date carry through from when the modal serialized them).
  //   • Prior DERIVED rows are kept as the sync's starting point so their
  //     done/done_date/notes survive re-derivation (syncRequirementsWithLegacy
  //     preserves those on rows it refreshes in place); the spread-in prior
  //     supplied them, we just drop the prior USER rows in favor of the form's.
  const priorDerived = (prior && Array.isArray(prior.requirements))
    ? prior.requirements.filter(r => r && r.source === 'derived')
    : [];
  offer.requirements = priorDerived.concat(readUserReqsFromForm());
  // Refresh the derived rows from the freshly-read legacy fields (preserving
  // done/done_date/notes on survivors); user rows are left untouched.
  syncRequirementsWithLegacy(offer);
  return offer;
}

/* ============================================================
   MODAL: COMMITMENT
   ============================================================ */
function showCommitmentModal(commitmentId = null) {
  const isEdit = Boolean(commitmentId);
  const c = isEdit ? App.state.commitments.find(x => x.id === commitmentId) : {
    id: uid('cmt'),
    commitmentName: '',
    sourceBonusOfferId: null,
    amount: null,
    startDate: isoDate(TODAY),
    endDate: isoDate(addDays(TODAY, 90)),
    type: 'manual hold',
    status: 'confirmed',
    includeInProjection: true,
    expectedBonus: 0,
    notes: ''
  };
  const modal = document.getElementById('modal-root');
  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">${isEdit ? 'Edit commitment' : 'Add capital commitment'}</div>
        <button class="btn-icon" data-action="close-modal"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg></button>
      </div>
      <form class="modal-body" id="commitment-form">
        <div class="form-grid">
          <div class="field" style="grid-column: 1 / -1;">
            <div class="field-box">
              <label for="c-name">Name *</label>
              <input id="c-name" class="input" type="text" required value="${escapeAttr(c.commitmentName)}" name="commitmentName" />
            </div>
          </div>
          <div class="field">
            <div class="field-box">
              <label for="c-amount">Amount *</label>
              <div class="input-group"><span class="input-prefix">$</span>
                <input id="c-amount" class="input" type="text" inputmode="decimal" data-money required value="${formatMoneyInput(c.amount ?? '')}" name="amount" />
              </div>
            </div>
          </div>
          <div class="field">
            <div class="field-box">
              <label for="c-type">Type</label>
              <select id="c-type" class="select" name="type">
                ${COMMITMENT_TYPES.map(t => `<option value="${t.value}" ${c.type === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="field"><div class="field-box"><label for="c-start">Start date *</label><input id="c-start" class="input" type="date" required value="${c.startDate}" name="startDate" /></div></div>
          <div class="field"><div class="field-box"><label for="c-end">End date *</label><input id="c-end" class="input" type="date" required value="${c.endDate}" name="endDate" /></div></div>
          <div class="field"><div class="field-box"><label for="c-status">Status</label><select id="c-status" class="select" name="status">
            <option value="confirmed" ${c.status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
            <option value="hypothetical" ${c.status === 'hypothetical' ? 'selected' : ''}>Hypothetical</option>
            <option value="completed" ${c.status === 'completed' ? 'selected' : ''}>Completed</option>
            <option value="cancelled" ${c.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
          </select></div></div>
          <div class="field"><div class="field-box"><label for="c-bonus">Expected bonus</label>
            <div class="input-group"><span class="input-prefix">$</span>
              <input id="c-bonus" class="input" type="text" inputmode="decimal" data-money value="${formatMoneyInput(c.expectedBonus ?? 0)}" name="expectedBonus" />
            </div>
          </div></div>
          <div class="field" style="grid-column:1/-1;"><label class="checkbox-row"><input type="checkbox" name="includeInProjection" ${c.includeInProjection ? 'checked' : ''} /><span>Include in projection</span></label></div>
          <div class="field" style="grid-column:1/-1;"><div class="field-box"><label for="c-notes">Notes</label><textarea id="c-notes" class="textarea" name="notes">${escapeHtml(c.notes || '')}</textarea></div></div>
        </div>
      </form>
      <div class="modal-footer">
        ${isEdit ? `<button class="btn btn-ghost btn-danger" data-action="delete-commitment-from-modal" data-id="${c.id}">Delete</button>` : '<span></span>'}
        <div style="display:flex;gap:var(--space-2);"><button class="btn btn-secondary" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="save-commitment" data-id="${c.id}" data-isedit="${isEdit ? '1' : '0'}">${isEdit ? 'Save changes' : 'Add commitment'}</button></div>
      </div>
    </div>
  `;
  modal.classList.add('open');
  setTimeout(() => document.getElementById('c-name')?.focus(), 50);
}

function readCommitmentForm(idArg) {
  const form = document.getElementById('commitment-form');
  if (!form) return null;
  const fd = new FormData(form);
  const data = Object.fromEntries(fd.entries());
  const orig = App.state.commitments.find(c => c.id === idArg);
  return {
    id: idArg,
    commitmentName: (data.commitmentName || '').trim(),
    sourceBonusOfferId: orig ? orig.sourceBonusOfferId : null,
    // Money fields render with commas; strip to plain Number. Dates
    // (startDate/endDate) are native <input type="date"> — already ISO.
    amount: parseMoneyInput(data.amount),
    startDate: data.startDate,
    endDate: data.endDate,
    type: data.type,
    status: data.status,
    includeInProjection: form.querySelector('[name="includeInProjection"]').checked,
    expectedBonus: parseMoneyInput(data.expectedBonus) || 0,
    notes: data.notes || ''
  };
}

/* ============================================================
   MODAL: EVENT
   ============================================================ */
function showEventModal(eventId = null) {
  const isEdit = Boolean(eventId);
  const e = isEdit ? App.state.events.find(x => x.id === eventId) : {
    id: uid('evt'),
    eventName: '',
    date: isoDate(addDays(TODAY, 14)),
    amount: 0,
    category: 'inflow',
    sourceBonusOfferId: null,
    recurrence: { kind: 'none', everyDays: 7, endDate: '' },
    includeInProjection: true,
    // New events affect the running balance by default but stay OUT of
    // the chart + Upcoming actions until explicitly opted in (most events
    // are paychecks/bills the user doesn't want cluttering those views).
    showOnChart: false,
    showInUpcoming: false,
    notes: ''
  };
  // Back-compat defaults for events saved before these fields existed
  if (!e.recurrence) e.recurrence = { kind: 'none', everyDays: 7, endDate: '' };
  if (e.showOnChart === undefined) e.showOnChart = true;
  if (e.showInUpcoming === undefined) e.showInUpcoming = true;
  const modal = document.getElementById('modal-root');
  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">${isEdit ? 'Edit event' : 'Add capital event'}</div>
        <button class="btn-icon" data-action="close-modal"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg></button>
      </div>
      <form class="modal-body" id="event-form">
        <div class="form-grid">
          <div class="field"><div class="field-box"><label for="e-cat">Category</label><select id="e-cat" class="select" name="category">${EVENT_CATEGORIES.map(c => `<option value="${c.value}" ${e.category === c.value ? 'selected' : ''}>${c.label}</option>`).join('')}</select></div></div>
          <div class="field"><div class="field-box"><label for="e-date">Date *</label><input id="e-date" class="input" type="date" required value="${e.date}" name="date" /></div></div>
          <!-- Linked-offer selector: required when category = bonus payout
               (visibility toggled via JS on the change event below). Auto-
               fills the Name field with the offer's bank/offer name on
               selection so the chart marker matches the offer card. -->
          <div class="field" id="e-offer-field" style="grid-column:1/-1;${e.category === 'bonus payout' ? '' : 'display:none;'}">
            <div class="field-box">
              <label for="e-offer">Linked offer *</label>
              <select id="e-offer" class="select" name="sourceBonusOfferId">
                <option value="">— Select offer —</option>
                ${App.state.offers.filter(o => o.status !== 'skipped').map(o => {
                  const dn = displayOfferName(o.offerName);
                  const lbl = o.bankName + (dn ? ' — ' + dn : '');
                  return `<option value="${o.id}" ${e.sourceBonusOfferId === o.id ? 'selected' : ''}>${escapeHtml(lbl)}</option>`;
                }).join('')}
              </select>
            </div>
            <span class="field-hint">Bonus payouts must match an existing offer so naming and identity color stay in sync with the offer card.</span>
          </div>
          <div class="field" style="grid-column: 1 / -1;"><div class="field-box"><label for="e-name">Name *</label><input id="e-name" class="input" type="text" required value="${escapeAttr(e.eventName)}" name="eventName" placeholder="Paycheck, Tax payment, etc." /></div></div>
          <div class="field"><div class="field-box"><label for="e-amount">Amount *</label>
            <div class="input-group"><span class="input-prefix">$</span>
              <input id="e-amount" class="input" type="text" inputmode="decimal" data-money required value="${formatMoneyInput(e.amount)}" name="amount" />
            </div>
          </div>
            <span class="field-hint">Sign is set automatically from the category — Inflow / Bonus payout are positive; Outflow / Fee are negative. Correction and Other use whatever sign you enter.</span>
          </div>
          <div class="field" style="grid-column:1/-1;">
            <label class="checkbox-row"><input type="checkbox" name="includeInProjection" ${e.includeInProjection ? 'checked' : ''} /><span>Include in projection</span></label>
            <label class="checkbox-row" style="margin-top:6px;"><input type="checkbox" name="showOnChart" ${e.showOnChart !== false ? 'checked' : ''} /><span>Display on Overview chart</span></label>
            <label class="checkbox-row" style="margin-top:6px;"><input type="checkbox" name="showInUpcoming" ${e.showInUpcoming !== false ? 'checked' : ''} /><span>Show in Upcoming actions</span></label>
            <span class="field-hint">All three are independent. Uncheck "Display on chart" and/or "Show in Upcoming actions" to keep an event in your running balance without cluttering those views — useful for paychecks and recurring bills.</span>
          </div>
          <div class="field">
            <div class="field-box">
              <label for="e-recur">Recurrence</label>
              <select id="e-recur" class="select" name="recurrenceKind">
                <option value="none" ${(e.recurrence?.kind || 'none') === 'none' ? 'selected' : ''}>One-time</option>
                <option value="weekly" ${e.recurrence?.kind === 'weekly' ? 'selected' : ''}>Weekly</option>
                <option value="biweekly" ${e.recurrence?.kind === 'biweekly' ? 'selected' : ''}>Bi-weekly</option>
                <option value="monthly" ${e.recurrence?.kind === 'monthly' ? 'selected' : ''}>Monthly</option>
                <option value="custom" ${e.recurrence?.kind === 'custom' ? 'selected' : ''}>Custom (every N days)</option>
              </select>
            </div>
            <span class="field-hint">Used for paychecks, recurring bills, and other repeating cash flows. The "Date" above is the first occurrence.</span>
          </div>
          <div class="field" id="e-recur-every-field" style="${e.recurrence?.kind === 'custom' ? '' : 'display:none;'}">
            <div class="field-box">
              <label for="e-recur-every">Every</label>
              <div class="input-group with-suffix">
                <input id="e-recur-every" class="input" type="number" min="1" max="365" step="1" name="recurrenceEveryDays" value="${e.recurrence?.everyDays || 7}" />
                <span class="input-suffix">days</span>
              </div>
            </div>
          </div>
          <div class="field" id="e-recur-end-field" style="grid-column:1/-1;${(e.recurrence?.kind && e.recurrence.kind !== 'none') ? '' : 'display:none;'}">
            <div class="field-box">
              <label for="e-recur-end">Ends (optional)</label>
              <input id="e-recur-end" class="input" type="date" name="recurrenceEndDate" value="${escapeAttr(e.recurrence?.endDate || '')}" />
            </div>
            <span class="field-hint">Leave blank to repeat through the projection horizon.</span>
          </div>
          <div class="field" style="grid-column:1/-1;"><div class="field-box"><label for="e-notes">Notes</label><textarea id="e-notes" class="textarea" name="notes">${escapeHtml(e.notes || '')}</textarea></div></div>
        </div>
      </form>
      <div class="modal-footer">
        ${isEdit ? `<button class="btn btn-ghost btn-danger" data-action="delete-event-from-modal" data-id="${e.id}">Delete</button>` : '<span></span>'}
        <div style="display:flex;gap:var(--space-2);"><button class="btn btn-secondary" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="save-event" data-id="${e.id}" data-isedit="${isEdit ? '1' : '0'}">${isEdit ? 'Save changes' : 'Add event'}</button></div>
      </div>
    </div>
  `;
  modal.classList.add('open');
  setTimeout(() => {
    document.getElementById('e-name')?.focus();
    // Show/hide the linked-offer field based on category; auto-fill the
    // Name when an offer is picked under "bonus payout" so the chart
    // marker and the offer card stay name-consistent without the user
    // having to retype the bank name.
    const form = document.getElementById('event-form');
    if (!form) return;
    const offerField = form.querySelector('#e-offer-field');
    const offerSelect = form.querySelector('#e-offer');
    const nameInput = form.querySelector('#e-name');
    form.addEventListener('change', (ev) => {
      if (ev.target.id === 'e-cat') {
        const isBonus = ev.target.value === 'bonus payout';
        if (offerField) offerField.style.display = isBonus ? '' : 'none';
        if (offerSelect) offerSelect.required = isBonus;
        // Auto-flip the amount's sign to match the chosen category.
        // Outflow/Fee → negative; Inflow/Bonus payout → positive.
        // Correction/Other stay untouched. Empty/zero amounts skip.
        const amtEl = form.querySelector('#e-amount');
        if (amtEl && amtEl.value.trim() !== '') {
          // Value carries commas; parse to Number, flip sign, then
          // re-render with commas so the field stays formatted.
          const cur = parseMoneyInput(amtEl.value);
          if (Number.isFinite(cur) && cur !== 0) {
            const next = applyCategorySign(cur, ev.target.value);
            if (next !== cur) amtEl.value = formatMoneyInput(next);
          }
        }
      }
      if (ev.target.id === 'e-offer') {
        const opt = ev.target.selectedOptions[0];
        const catEl = form.querySelector('#e-cat');
        if (opt && opt.value && catEl && catEl.value === 'bonus payout' && nameInput) {
          nameInput.value = opt.textContent.trim();
        }
      }
      // Recurrence kind drives visibility of the "every N days" and
      // "ends" fields. Custom shows both; weekly/biweekly/monthly show
      // only the end-date; one-time hides both.
      if (ev.target.id === 'e-recur') {
        const kind = ev.target.value;
        const everyField = form.querySelector('#e-recur-every-field');
        const endField = form.querySelector('#e-recur-end-field');
        if (everyField) everyField.style.display = kind === 'custom' ? '' : 'none';
        if (endField) endField.style.display = kind !== 'none' ? '' : 'none';
      }
    });
  }, 50);
}

function readEventForm(idArg) {
  const form = document.getElementById('event-form');
  if (!form) return null;
  const fd = new FormData(form);
  const data = Object.fromEntries(fd.entries());
  const recKind = data.recurrenceKind || 'none';
  // Apply the category's auto-sign at save time too — covers the case
  // where the user typed an amount AFTER picking the category and the
  // sign is wrong. Categories with no implied sign (Correction, Other)
  // pass through untouched.
  // Amount renders with commas and may be negative/decimal; strip to a
  // plain Number before applying the category sign. Date fields here are
  // native <input type="date"> (already ISO) so they need no parsing.
  const signedAmount = applyCategorySign(parseMoneyInput(data.amount), data.category);
  return {
    id: idArg,
    eventName: (data.eventName || '').trim(),
    date: data.date,
    amount: signedAmount,
    category: data.category,
    sourceBonusOfferId: data.sourceBonusOfferId || null,
    recurrence: {
      kind: recKind,
      everyDays: Math.max(1, Math.min(365, Number(data.recurrenceEveryDays) || 7)),
      endDate: data.recurrenceEndDate || ''
    },
    includeInProjection: form.querySelector('[name="includeInProjection"]').checked,
    showOnChart: form.querySelector('[name="showOnChart"]').checked,
    showInUpcoming: form.querySelector('[name="showInUpcoming"]').checked,
    notes: data.notes || ''
  };
}

// Recovery UI: list the Gist's saved revisions (newest first) with a
// summary of each (offers / commitments / events counts + timestamp) and a
// Restore button. Fetches each recent revision's content so the user can
// recognize the version they want by its contents, not just a date.
async function showSyncHistoryModal() {
  const modal = document.getElementById('modal-root');
  modal.dataset.strictClose = '1'; // don't dismiss on backdrop click mid-load
  modal.classList.add('open');
  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">Restore from cloud history</div>
        <button class="btn-icon" data-action="close-modal" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg></button>
      </div>
      <div class="modal-body" id="sync-history-body">
        <p style="color:var(--text-secondary);font-size:13px;">Loading revision history…</p>
      </div>
    </div>`;
  try {
    const hist = await Sync.listHistory();
    const recent = hist.slice(0, 20); // cap API calls; 20 revisions is plenty
    App._syncHistoryCache = {};
    const rows = [];
    for (const h of recent) {
      let snap = null;
      try { snap = await Sync.fetchRevision(h.version); } catch {}
      if (snap) App._syncHistoryCache[h.version] = snap;
      rows.push({
        version: h.version,
        when: h.committed_at,
        offers: snap && Array.isArray(snap.offers) ? snap.offers.length : 0,
        commits: snap && Array.isArray(snap.commitments) ? snap.commitments.length : 0,
        events: snap && Array.isArray(snap.events) ? snap.events.length : 0,
        ok: !!snap
      });
    }
    const body = document.getElementById('sync-history-body');
    if (!body) return; // modal was closed while loading
    if (rows.length === 0) {
      body.innerHTML = `<p style="color:var(--text-secondary);font-size:13px;">No revision history found for this Gist.</p>`;
      return;
    }
    body.innerHTML = `
      <p style="color:var(--text-secondary);font-size:13px;margin-bottom:var(--space-3);">Each row is a saved cloud version (newest first). Find the one whose counts match what you expect, then <strong>Restore</strong> — it becomes the current version on every device. Restoring is reversible: your present version stays in this history too.</p>
      <div class="sync-hist-list">
        ${rows.map((r, idx) => `
          <div class="sync-hist-row">
            <div class="sync-hist-meta">
              <div class="sync-hist-when">${r.when ? new Date(r.when).toLocaleString() : '—'}${idx === 0 ? ' <span class="chip chip-muted" style="margin-left:6px;">current</span>' : ''}</div>
              <div class="sync-hist-counts">${r.ok ? `${r.offers} offer${r.offers === 1 ? '' : 's'} · ${r.commits} commitment${r.commits === 1 ? '' : 's'} · ${r.events} event${r.events === 1 ? '' : 's'}` : 'could not read this revision'}</div>
            </div>
            ${r.ok ? `<button class="btn btn-secondary btn-sm" data-action="sync-restore" data-version="${r.version}">Restore</button>` : ''}
          </div>
        `).join('')}
      </div>`;
  } catch (e) {
    const body = document.getElementById('sync-history-body');
    if (body) body.innerHTML = `<p style="color:var(--danger);font-size:13px;">Could not load history: ${escapeHtml(e.message)}</p>`;
  }
}

function closeModal() {
  const modal = document.getElementById('modal-root');
  modal.classList.remove('open');
  modal.innerHTML = '';
  delete modal.dataset.strictClose;
}

// Route an "Upcoming actions" row click to the right edit-modal opener.
// Offers go to the offers tab + open their card (so the user sees their
// other offers as context); commitments and events open their edit modal
// in place over the current view, since there's no dedicated tab for
// either and the user just wants to fix the date or amount.
function addSourceBank() {
  const input = document.getElementById('source-bank-input');
  if (!input) return;
  const name = input.value.trim();
  if (!name) return;
  App.update(s => {
    if (!Array.isArray(s.settings.sourceBanks)) s.settings.sourceBanks = [];
    // Case-insensitive dedupe.
    if (!s.settings.sourceBanks.some(b => b.toLowerCase() === name.toLowerCase())) {
      s.settings.sourceBanks.push(name);
      s.settings.sourceBanks.sort((a, b) => a.localeCompare(b));
    }
  });
  render();
}
function removeSourceBank(name) {
  if (!name) return;
  App.update(s => {
    s.settings.sourceBanks = (s.settings.sourceBanks || []).filter(b => b !== name);
  });
  render();
}

function openActionTarget(kind, id) {
  if (!kind || !id) return;
  // Open the edit modal in place over the CURRENT view (don't switch
  // tabs). The modal floats above whatever view you're on, so an
  // Upcoming-actions click on the Overview stays on the Overview.
  if (kind === 'offer') showOfferModal(id);
  else if (kind === 'commitment') showCommitmentModal(id);
  else if (kind === 'event') showEventModal(id);
}

export { showOfferModal, renderDdRow, requirementWriteThroughTarget, requirementFieldEditable, renderRequirementRow, renderRequirementRows, readUserReqsFromForm, writeUserReqsToForm, buildLiveRequirementsOffer, refreshRequirementsSection, refreshLifecycleStrip, refreshClosedDateField, refreshRequirementDates, handleRequirementInput, addRequirementRow, removeRequirementRow, generateDdDatesFromRequirement, readDdRowsFromForm, addDdRow, removeDdRow, readOfferForm, showCommitmentModal, readCommitmentForm, showEventModal, readEventForm, showSyncHistoryModal, closeModal, addSourceBank, removeSourceBank, openActionTarget };
