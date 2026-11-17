// project.js — the project editor. A working copy (draft) per project id lives in this module, so switching tabs or
// leaving and coming back never loses edits; Save writes it (PUT), Discard drops it. Tabs: data | explore |
// signatures | roi | run. There is no Parameters tab any more: a run does what every dataset needs (the base run; its
// few switches are in the Run tab, the quality-control thresholds in the Explore tab) and the questions are asked,
// each with its own settings, in the Analysis tab of the finished run.
import {
  h, api, mount, icon, button, card, field, tabs, switchToggle, loading, emptyState, errorPanel, banner, toast,
  confirmDialog, fmt, clone, navigate, setPathSilently, resolveRoute, statusBadge, poll, state, refreshHealth,
} from '../core.js';
import { openFolderPicker } from '../components/folder-picker.js';
import { uploadPanel } from '../components/upload-panel.js';
import { chooseDetectedSamples, applyDetectedSamples, reportPanel, binLabel, platformName, unitWord } from '../components/sample-editor.js';
import { signatureEditor, geneCoverage } from '../components/signature-editor.js';
import { tissuePanel, applyTissueConfig, undoTissueConfig, mayAutoApply, appliedMessage } from '../components/tissue-panel.js';
import { roiEditor } from '../components/roi-editor.js';
import { dataExplorer, exploreState } from '../components/data-explorer.js';

const TABS = [
  { id: 'data', label: 'Data', icon: 'folder' },
  { id: 'explore', label: 'Explore', icon: 'eye' },
  { id: 'signatures', label: 'Cell Settings', icon: 'dna' },
  { id: 'roi', label: 'Region of interest', icon: 'polygon' },
  { id: 'run', label: 'Run', icon: 'play' },
];
// addresses kept from before: the quality-control thresholds of the former Parameters tab are in the Explore tab
const TAB_ALIASES = { parameters: 'explore' };
// what every run does, whatever its switches (the base run; pipeline_config.APP_STEPS lists the steps it may switch)
const ALWAYS_STEPS = ['Load the sections and quality control', 'Normalization', 'Gene-set scores and positivity calls',
  'Region of interest', 'Per-bin table and summary'];
const DEFAULT_BINS = ['002um', '008um', '016um'];
const VALIDATE_DELAY_MS = 800;
const DRAFT_CHECK_DELAY_MS = 300;   // the configuration check of the unsaved settings (no data access, fast)
const RUNS_POLL_MS = 4000;

const drafts = new Map();
let defaultsPromise = null;
let guardInstalled = false;

const enc = encodeURIComponent;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const uniq = (list) => [...new Set(list)];

// ------------------------------------------------------------------------------------------------ drafts
// A new project has no samples until its data is uploaded: the server's "at least one sample is required" is not shown
// while the project is set up (checks, badges, banners); pressing Run says so instead (start()).
const NO_SAMPLES_ERROR = 'at least one sample is required';
const shownErrors = (list) => (Array.isArray(list) ? list : []).filter((t) => t !== NO_SAMPLES_ERROR);
const hasSamples = (cfg) => Array.isArray(cfg && cfg.samples) && cfg.samples.length > 0;

function normValidation(v) {
  return {
    errors: shownErrors(v && v.errors),
    warnings: v && Array.isArray(v.warnings) ? v.warnings : [],
  };
}

// the data check without the hidden error; ok is "no errors", as the server computes it
function normReport(r) {
  if (!r || typeof r !== 'object') return null;
  const errors = shownErrors(r.errors);
  return { ...r, errors, ok: errors.length === 0 };
}

const snapshot = (name, config) => JSON.stringify({ name, config });

function setRois(d, list) {
  d.rois.clear();
  (Array.isArray(list) ? list : []).forEach((sid) => d.rois.add(sid));
}

/** The server's project becomes the saved state and the working copy. Report, UI state and regions are kept. */
function adopt(d, project) {
  d.name = project.name || '';
  d.config = clone(project.config || {});
  d.saved = { name: d.name, config: clone(d.config) };
  d.savedJson = snapshot(d.name, d.config);
  d.dirty = false;
  d.validation = normValidation(project.validation);
  d.created = project.created;
  d.updated = project.updated;
  d.remoteUpdated = project.updated;
  if (Array.isArray(project.rois)) setRois(d, project.rois);
  d.originalIds = new WeakMap((Array.isArray(d.config.samples) ? d.config.samples : [])
    .filter((s) => s && typeof s === 'object').map((s) => [s, s.id]));
}

function newDraft(project) {
  const d = {
    id: project.id, rois: new Set(), report: null, reportKey: null, reportAt: null, reportError: null, checking: false,
    saving: false, ui: { signature: null, runLabel: '', exploreFocus: null }, roi: {},
    explore: null,
  };
  adopt(d, project);
  return d;
}

function roiUnsaved(d) {
  // only sections that still exist: drawings of a removed section can be neither saved nor discarded
  const ids = new Set((Array.isArray(d.config.samples) ? d.config.samples : []).map((s) => s && s.id));
  return Object.entries((d.roi && d.roi.entries) || {})
    .filter(([sid, en]) => ids.has(sid) && en && en.loaded && JSON.stringify(en.polys) !== en.saved).map(([sid]) => sid);
}

/** True while a project has unsaved settings or regions in this browser tab. */
export function hasUnsavedChanges(id) {
  const d = drafts.get(id);
  return !!d && (d.dirty || roiUnsaved(d).length > 0);
}

/** Drop the working copy of a deleted project. */
export function forgetDraft(id) {
  drafts.delete(id);
}

function installGuard() {
  if (guardInstalled) return;
  guardInstalled = true;
  window.addEventListener('beforeunload', (e) => {
    for (const d of drafts.values()) {
      if (d.dirty || roiUnsaved(d).length) {
        e.preventDefault();
        e.returnValue = '';
        return;
      }
    }
  });
}

function getDefaults() {
  if (!defaultsPromise) defaultsPromise = api('/api/defaults').catch((e) => { defaultsPromise = null; throw e; });
  return defaultsPromise;
}

/** What a data check depends on; a report made for another key is stale. */
function dataKey(cfg) {
  return JSON.stringify([cfg.data_root, (Array.isArray(cfg.samples) ? cfg.samples : []).map((s) => [s.id, s.path, s.microns_per_pixel]),
    cfg.bin_size, cfg.qc_bin_size]);
}

/** What the Explore tab reads depends on: the data settings and the quality-control thresholds (bins passing QC). */
function exploreKey(cfg) {
  const qc = cfg.qc && typeof cfg.qc === 'object' ? cfg.qc : {};
  return JSON.stringify([dataKey(cfg), qc.min_genes, qc.min_counts, qc.max_pct_mt]);
}

// ------------------------------------------------------------------------------------------------ view
export async function renderProject(container, { id, tab }) {
  installGuard();
  const wanted = TAB_ALIASES[tab] || tab;
  const active = TABS.some((t) => t.id === wanted) ? wanted : 'data';
  if (active !== tab) setPathSilently(`/projects/${enc(id)}/${active}`);
  mount(container, h('div', { class: 'page' }, loading('Loading the project…')));

  let defaults;
  let project;
  try {
    // the Data tab differs on a hosted server (uploads instead of a data root): know which one this is first
    if (!state.health) await refreshHealth();
    [defaults, project] = await Promise.all([getDefaults(), api(`/api/projects/${enc(id)}`)]);
  } catch (e) {
    if (e.status === 404) {
      drafts.delete(id);
      mount(container, h('div', { class: 'page' }, emptyState({
        icon: 'folder', title: 'Project not found', text: `There is no project “${id}”. It may have been deleted.`,
        action: h('a', { class: 'btn primary', href: '#/projects' }, 'All projects'),
      })));
    } else {
      mount(container, h('div', { class: 'page' }, errorPanel(e, { retry: resolveRoute })));
    }
    return null;
  }

  let d = drafts.get(id);
  if (!d) {
    d = newDraft(project);
    drafts.set(id, d);
  } else if (!d.dirty) {
    adopt(d, project);
  } else {
    d.remoteUpdated = project.updated;
    d.validation = normValidation(project.validation);
    if (Array.isArray(project.rois)) setRois(d, project.rois);
  }
  return projectView(container, d, defaults, active);
}

function projectView(container, d, defaults, initialTab) {
  let alive = true;
  let current = initialTab;
  let tabApi = {};
  let vOpen = false;
  let validateTimer = null;
  let validateAbort = null;
  let draftTimer = null;
  let draftAbort = null;
  const defCfg = (defaults && defaults.config) || {};

  // ---------------------------------------------------------------- header
  const nameInput = h('input', { class: 'title-input', value: d.name, 'aria-label': 'Project name', spellcheck: false, autocomplete: 'off', maxlength: 200 });
  const crumbName = h('span', { class: 'truncate' });
  const meta = h('div', { class: 'subtitle project-meta' });
  const conflict = h('div');
  const tabsHost = h('div', { class: 'project-tabs' });
  const body = h('div', { class: 'project-body' });

  // The header holds one control: the status chip of the configuration check. It is built once and updated in place
  // (paintChips), so it keeps the focus while it opens and closes the check panel below the header. The panel lists
  // the errors and warnings and holds the manual data check (the former "Validate data" button).
  const vpanelId = `vpanel-${d.id}`;
  const vchip = h('button', {
    type: 'button', class: 'vchip', 'aria-expanded': 'false', 'aria-controls': vpanelId,
    onClick: () => { vOpen = !vOpen; paintChips(); },
  });
  const vScope = h('span', { class: 'muted small' });
  const vClose = button({ icon: 'x', kind: 'ghost', small: true, title: 'Close', onClick: () => { vOpen = false; paintChips(); vchip.focus(); } });
  vClose.setAttribute('aria-label', 'Close the configuration check');
  const vList = h('div', { class: 'stack' });
  const vData = h('span', { class: 'muted small' });
  // aria-disabled rather than disabled while a check runs, so that the focus stays on the button
  const checkBtn = button({ label: 'Check the data again', icon: 'refresh', small: true, onClick: () => { if (!d.checking) validateNow(true); } });
  checkBtn.title = 'Check the sample folders and the genes against the data, with your current (unsaved) settings';
  const vpanel = h('div', { class: 'card vpanel hidden', id: vpanelId },
    h('div', { class: 'card-body stack' },
      h('div', { class: 'row vpanel-head' }, h('h3', null, 'Configuration check'), vScope, h('span', { class: 'spacer' }), vClose),
      vList,
      h('div', { class: 'vpanel-foot' }, checkBtn, vData)));

  // Saving and discarding live in the bar at the bottom, shown only while there are unsaved changes (and Ctrl+S).
  const barSave = button({ label: 'Save', icon: 'save', kind: 'primary', small: true, onClick: () => { save(); } });
  const barDiscard = button({ label: 'Discard', small: true, onClick: () => { discard(); } });
  barSave.title = 'Save the project settings (Ctrl+S)';
  barDiscard.title = 'Drop the unsaved changes';
  const unsavedBar = h('div', { class: 'unsaved-bar hidden', role: 'status' },
    icon('alert', { size: 16 }), h('strong', null, 'Unsaved changes'),
    h('span', { class: 'muted small' }, 'Saved settings are what runs use. Ctrl+S saves.'),
    h('span', { class: 'spacer' }), barDiscard, barSave);

  nameInput.addEventListener('input', () => { d.name = nameInput.value; refreshChrome(); });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); } else if (e.key === 'Escape') {
      d.name = d.saved.name;
      nameInput.value = d.name;
      refreshChrome();
      nameInput.blur();
    }
  });

  mount(container, h('div', { class: 'page project-page' },
    h('div', { class: 'breadcrumb' }, h('a', { href: '#/projects' }, 'Projects'), icon('chevron-right', { size: 12 }), crumbName),
    h('div', { class: 'page-header project-head' },
      h('div', { class: 'titles' }, nameInput, meta),
      h('div', { class: 'actions' }, vchip)),
    vpanel, conflict, tabsHost, body, unsavedBar));

  function setButton(btn, busy, iconName, label) {
    mount(btn, busy ? h('span', { class: 'spinner' }) : icon(iconName, { size: btn.classList.contains('small') ? 14 : 16 }), label);
  }

  function computeDirty() {
    d.dirty = snapshot(d.name, d.config) !== d.savedJson;
    return d.dirty;
  }

  let chipsSig = '';
  let tabsSig = '';

  // The chip shows the check of the unsaved settings while there are any (POST /validate with data: false, a moment
  // after each change), so that a deleted signature still selected somewhere is an error at once, not after saving.
  // Until that check answers it shows the saved settings' check, and says so.
  function draftCheck() {
    return d.dirty && d.draftCheck && d.draftCheck.key === JSON.stringify(d.config) ? d.draftCheck : null;
  }

  function checkDraftSoon() {
    clearTimeout(draftTimer);
    if (d.dirty && !draftCheck()) draftTimer = setTimeout(checkDraft, DRAFT_CHECK_DELAY_MS);
  }

  async function checkDraft() {
    if (draftAbort) draftAbort.abort();
    if (!alive || !d.dirty) return;
    const ctrl = new AbortController();
    draftAbort = ctrl;
    const key = JSON.stringify(d.config);
    try {
      const res = await api(`/api/projects/${enc(d.id)}/validate`, { method: 'POST', body: { config: d.config, data: false }, signal: ctrl.signal });
      d.draftCheck = { key, ...normValidation(res) };
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      d.draftCheck = null;   // the chip keeps showing the saved settings' check
    } finally {
      if (draftAbort === ctrl) draftAbort = null;
    }
    if (alive) paintChips();
  }

  /** One line on the data check (sample folders and genes against the data), shown next to "Check the data again". */
  function dataCheckLine() {
    if (d.checking) return 'Checking the data…';
    if (d.reportError) return `The last data check failed: ${d.reportError.message || d.reportError}`;
    if (!d.report) return 'The data has not been checked yet.';
    const errs = (d.report.errors || []).length;
    const warns = (d.report.warnings || []).length;
    const found = [errs ? plural(errs, 'problem') : null, warns ? plural(warns, 'warning') : null].filter(Boolean);
    return `Data checked ${fmt.ago(d.reportAt)}${reportStale() ? ' (settings changed since)' : ''}: ${found.length ? `${found.join(', ')}; details in the Data tab` : 'no problems'}.`;
  }

  function paintChips() {
    const draft = draftCheck();
    const { errors, warnings } = draft || d.validation;
    const dataLine = dataCheckLine();
    const sig = JSON.stringify([errors, warnings, vOpen, d.dirty, !!draft, d.checking, dataLine]);
    if (sig === chipsSig) return;
    chipsSig = sig;
    const scope = draft ? 'Check of your unsaved settings; runs use the saved settings until you save.'
      : d.dirty ? 'Check of the saved settings; your unsaved changes are being checked.' : 'Check of the saved settings.';
    const kind = errors.length ? 'bad' : warnings.length ? 'warn' : 'ok';
    const counts = [errors.length ? plural(errors.length, 'error') : null, warnings.length ? plural(warnings.length, 'warning') : null].filter(Boolean);
    const text = counts.length ? counts.join(', ') : 'Settings valid';
    vchip.className = `vchip ${kind}`;
    vchip.title = d.checking ? `${scope} Checking the data…` : scope;
    vchip.setAttribute('aria-label', `Configuration check: ${text}`);
    vchip.setAttribute('aria-expanded', String(vOpen));
    // while a data check runs, a small spinner takes the place of the icon (the count stays readable)
    mount(vchip, d.checking ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : icon(kind === 'ok' ? 'check' : 'alert', { size: 13 }),
      text, icon('chevron-down', { size: 12, cls: 'vchip-caret' }));
    vpanel.classList.toggle('hidden', !vOpen);
    if (!vOpen) return;
    vScope.textContent = draft ? 'Your unsaved settings; runs use the saved ones until you save.'
      : d.dirty ? 'Saved settings; your unsaved changes are being checked.' : 'Saved settings.';
    mount(vList,
      errors.length ? banner('danger', [h('strong', null, `${plural(errors.length, 'error')}: runs cannot start until they are fixed.`), h('ul', null, errors.map((t) => h('li', null, t)))]) : null,
      warnings.length ? banner('warning', [h('strong', null, plural(warnings.length, 'warning')), h('ul', null, warnings.map((t) => h('li', null, t)))]) : null,
      !errors.length && !warnings.length ? h('div', { class: 'state ok' }, icon('check', { size: 13 }), 'No problems found in the settings.') : null);
    setButton(checkBtn, d.checking, 'refresh', d.checking ? 'Checking…' : 'Check the data again');
    checkBtn.setAttribute('aria-disabled', String(d.checking));
    vData.textContent = d.checking ? '' : dataLine;
  }

  function signaturesWithMissingGenes() {
    const cov = geneCoverage(d.report);
    if (!cov.known) return 0;
    return Object.values(d.config.signatures || {}).filter((s) => s && [...(s.extended || []), ...(s.core || [])].some((g) => cov.missing.has(g))).length;
  }

  function paintTabs() {
    const repErrors = d.report ? (d.report.errors || []).length : 0;
    const sigMissing = signaturesWithMissingGenes();
    const pendingRois = roiUnsaved(d).length;
    const cfgErrors = d.validation.errors.length;
    const sig = JSON.stringify([current, repErrors, sigMissing, pendingRois, cfgErrors]);
    if (sig === tabsSig) return;
    tabsSig = sig;
    const hadFocus = tabsHost.contains(document.activeElement);
    const badge = {
      data: repErrors ? { badge: repErrors, badgeKind: 'bad' } : {},
      signatures: sigMissing ? { badge: sigMissing, badgeKind: 'warn' } : {},
      roi: pendingRois ? { badge: pendingRois, badgeKind: 'warn' } : {},
      run: cfgErrors ? { badge: cfgErrors, badgeKind: 'bad' } : {},
    };
    mount(tabsHost, tabs({ items: TABS.map((t) => ({ ...t, ...(badge[t.id] || {}) })), active: current, onSelect: switchTab }));
    if (hadFocus) {
      const b = tabsHost.querySelector('.tab.active');
      if (b) b.focus();
    }
  }

  function paintConflict() {
    mount(conflict, d.dirty && d.remoteUpdated && d.updated && d.remoteUpdated !== d.updated
      ? banner('warning', h('span', null, `This project was saved elsewhere (${fmt.ago(d.remoteUpdated)}) after you started editing; saving overwrites that version. `,
        h('button', { type: 'button', class: 'linklike', onClick: () => { discard(); } }, 'Load the saved version')))
      : null);
  }

  function refreshChrome() {
    if (!alive) return;
    computeDirty();
    checkDraftSoon();
    const named = d.name.trim().length > 0;
    nameInput.classList.toggle('invalid', !named);
    nameInput.title = named ? 'Click to rename' : 'The project needs a name';
    crumbName.textContent = d.name.trim() || d.id;
    mount(meta, h('span', { class: 'mono' }, d.id), ` · created ${fmt.date(d.created)} · saved ${fmt.ago(d.updated)}`);
    barSave.disabled = !d.dirty || d.saving;
    barDiscard.disabled = !d.dirty || d.saving;
    setButton(barSave, d.saving, 'save', d.saving ? 'Saving…' : 'Save');
    unsavedBar.classList.toggle('hidden', !d.dirty);
    paintChips();
    paintTabs();
    paintConflict();
    if (tabApi.onChrome) tabApi.onChrome();
  }

  function changed({ data = false } = {}) {
    refreshChrome();
    if (data) {
      clearTimeout(validateTimer);
      validateTimer = setTimeout(() => validateNow(false), VALIDATE_DELAY_MS);
    }
  }

  function notifyReport() {
    if (!alive) return;
    refreshChrome();
    if (tabApi.onReport) tabApi.onReport();
  }

  // ---------------------------------------------------------------- data check, save, discard
  async function validateNow(manual) {
    clearTimeout(validateTimer);
    if (validateAbort) validateAbort.abort();
    const ctrl = new AbortController();
    validateAbort = ctrl;
    const key = dataKey(d.config);
    d.checking = true;
    d.reportError = null;
    notifyReport();
    try {
      const report = await api(`/api/projects/${enc(d.id)}/validate`, { method: 'POST', body: { config: d.config }, signal: ctrl.signal });
      d.report = normReport(report);
      d.reportKey = key;
      d.reportAt = new Date().toISOString();
      if (manual && alive && d.report) {
        const samples = d.report.samples || [];
        const found = samples.filter((s) => s.bin_dir).length;
        const errs = (d.report.errors || []).length;
        const warns = (d.report.warnings || []).length;
        toast(`Data check: ${found} of ${plural(samples.length, 'section')} found${errs ? `, ${plural(errs, 'error')}` : ''}${warns ? `, ${plural(warns, 'warning')}` : ''}.`,
          d.report.ok ? 'success' : 'warning');
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      d.reportError = e;
      if (manual && alive) toast(`The data check failed: ${e.message}`, 'error');
    } finally {
      if (validateAbort === ctrl) {
        validateAbort = null;
        d.checking = false;
        notifyReport();
      }
    }
  }

  const reportStale = () => !!d.report && d.reportKey !== dataKey(d.config);

  /** [from, to] for every sample whose id changed since the last save. */
  function idRenames() {
    const out = [];
    for (const s of Array.isArray(d.config.samples) ? d.config.samples : []) {
      const orig = s && typeof s === 'object' ? d.originalIds.get(s) : undefined;
      if (orig !== undefined && s.id && orig !== s.id) out.push([orig, s.id]);
    }
    return out;
  }

  /** Renames whose saved region on the server has to move. */
  function sampleRenames() {
    return idRenames().filter(([from, to]) => d.rois.has(from) && !d.rois.has(to));
  }

  /** In-browser drawings (saved or not) follow their section's new id. */
  function moveRoiEntries(renames) {
    const entries = (d.roi && d.roi.entries) || {};
    for (const [from, to] of renames) {
      if (entries[from] && !(entries[to] && entries[to].loaded)) { entries[to] = entries[from]; delete entries[from]; }
      if (d.roi && d.roi.sample === from) d.roi.sample = to;
    }
  }

  // A drawn region is stored under its sample id; when the id is renamed, move the region with it. On a
  // case-insensitive file system a case-only rename (ctrl-1 -> CTRL-1) is one file: the PUT renames it (the server
  // drops the old spelling) and no DELETE is sent. The list of saved regions is then reloaded from the server.
  async function moveRenamedRois(renames) {
    const roiUrl = (sid) => `/api/projects/${enc(d.id)}/roi/${enc(sid)}`;
    for (const [from, to] of renames) {
      try {
        const gj = await api(roiUrl(from));
        await api(roiUrl(to), { method: 'PUT', body: gj });
        if (from.toLowerCase() !== to.toLowerCase()) await api(roiUrl(from), { method: 'DELETE' });
        toast(`The drawn region of ${from} now belongs to ${to}.`, 'info');
      } catch (e) {
        toast(`The drawn region of ${from} could not be moved to ${to}: ${e.message}`, 'warning');
      }
    }
    try {
      const fresh = await api(`/api/projects/${enc(d.id)}`);
      if (Array.isArray(fresh.rois)) setRois(d, fresh.rois);
    } catch (e) {
      toast(`Could not reload the list of drawn regions: ${e.message}`, 'warning');
    }
  }

  /** Save the draft (PUT). Resolves to true when the saved settings now match the draft; a call made while a save is
   *  in flight shares its result. */
  function save() {
    if (d.saving && d.savePromise) return d.savePromise;
    d.savePromise = writeProject();
    return d.savePromise;
  }

  async function writeProject() {
    computeDirty();
    if (!d.dirty) return true;
    const name = d.name.trim();
    if (!name) {
      toast('The project needs a name.', 'warning');
      if (alive) nameInput.focus();
      return false;
    }
    d.saving = true;
    refreshChrome();
    const sent = snapshot(d.name, d.config);
    const renames = sampleRenames();
    const entryRenames = idRenames();
    let replaced = false;
    try {
      const res = await api(`/api/projects/${enc(d.id)}`, { method: 'PUT', body: { name, config: d.config } });
      const serverName = res.name || name;
      const serverConfig = res.config || d.config;
      const editedMeanwhile = snapshot(d.name, d.config) !== sent;
      d.saved = { name: serverName, config: clone(serverConfig) };
      d.savedJson = snapshot(serverName, serverConfig);
      d.validation = normValidation(res.validation);
      d.updated = res.updated || d.updated;
      d.remoteUpdated = d.updated;
      if (Array.isArray(res.rois)) setRois(d, res.rois);
      if (!editedMeanwhile) {
        if (snapshot(d.name, d.config) !== d.savedJson) {
          d.name = serverName;
          d.config = clone(serverConfig);
          replaced = true;
        }
        d.originalIds = new WeakMap((Array.isArray(d.config.samples) ? d.config.samples : [])
          .filter((s) => s && typeof s === 'object').map((s) => [s, s.id]));
      }
      moveRoiEntries(entryRenames);
      if (renames.length) await moveRenamedRois(renames);
      const errs = d.validation.errors.length;
      if (errs) toast(`Saved with ${plural(errs, 'configuration error')}: runs cannot start until ${errs === 1 ? 'it is' : 'they are'} fixed.`, 'warning');
      else toast('Project saved', 'success', { timeout: 2000 });
      return true;
    } catch (e) {
      toast(`The project could not be saved: ${e.message}`, 'error');
      return false;
    } finally {
      d.saving = false;
      if (alive) {
        if (replaced) {
          if (document.activeElement !== nameInput) nameInput.value = d.name;
          renderBody();
        }
        refreshChrome();
      }
    }
  }

  async function discard() {
    computeDirty();
    if (!d.dirty || d.saving) return;
    const ok = await confirmDialog({
      title: 'Discard your changes?',
      message: 'The project returns to its saved settings. Drawn regions are not affected (they are saved separately).',
      confirmLabel: 'Discard changes', danger: true,
    });
    if (!ok) return;
    try {
      adopt(d, await api(`/api/projects/${enc(d.id)}`));
    } catch (e) {
      toast(`The saved version could not be loaded (${e.message}); restored the version loaded earlier.`, 'warning');
      const saved = d.saved;
      d.name = saved.name;
      d.config = clone(saved.config);
    }
    if (!alive) return;
    nameInput.value = d.name;
    renderBody();
    refreshChrome();
    toast('Changes discarded', 'info', { timeout: 2000 });
  }

  // ---------------------------------------------------------------- tabs
  function switchTab(tabId) {
    if (tabId === current) return;
    current = tabId;
    setPathSilently(`/projects/${enc(d.id)}/${tabId}`);
    renderBody();
    paintTabs();
  }

  function renderBody() {
    if (tabApi.destroy) {
      try { tabApi.destroy(); } catch (e) { console.error(e); }
    }
    tabApi = {};
    const renderers = { data: dataTab, explore: exploreTab, signatures: signaturesTab, roi: roiTab, run: runTab };
    try {
      tabApi = renderers[current](body) || {};
      if (tabApi.start) tabApi.start();
    } catch (e) {
      console.error(e);
      mount(body, errorPanel(e, { retry: renderBody }));
    }
  }

  // ---- Data
  function dataTab(host) {
    const cfg = d.config;
    const rootInput = h('input', { class: 'input mono', id: `data-root-${d.id}`, value: cfg.data_root ?? '', spellcheck: false, autocomplete: 'off', placeholder: '.' });
    rootInput.addEventListener('input', () => { cfg.data_root = rootInput.value.trim(); changed({ data: true }); });
    const browse = button({
      label: 'Browse…', icon: 'folder',
      onClick: async () => {
        const picked = await openFolderPicker({ title: 'Data root', start: cfg.data_root || '.', note: 'The folder that contains the sample folders (Space Ranger outputs, or the outputs of other instruments).' });
        if (!picked) return;
        cfg.data_root = picked;
        if (alive) rootInput.value = picked;
        changed({ data: true });
      },
    });
    const detect = button({
      label: 'Detect samples', icon: 'search',
      onClick: async () => {
        const res = await api(`/api/projects/${enc(d.id)}/detect-samples`, { method: 'POST', body: { data_root: cfg.data_root || '.' } });
        if (alive) chooseSamples(res);
      },
    });
    const binId = `bin-size-${d.id}`;
    const qcId = `qc-bin-size-${d.id}`;
    const binSel = h('select', { class: 'select', id: binId });
    const qcSel = h('select', { class: 'select', id: qcId });
    binSel.addEventListener('change', () => { cfg.bin_size = binSel.value; changed({ data: true }); });
    qcSel.addEventListener('change', () => { cfg.qc_bin_size = qcSel.value; changed({ data: true }); });
    const reportBox = h('div');
    const recheck = button({ label: 'Check again', icon: 'refresh', small: true, kind: 'ghost', onClick: () => { validateNow(true); } });
    recheck.title = 'Check the data again with the settings above';

    function fillBins() {
      // the bin sizes of the Visium HD sections (the other instruments' sections have one size of unit, or are binned
      // at any size: Stereo-seq)
      const found = ((d.report && d.report.samples) || []).filter((s) => s.bin_dir && Array.isArray(s.bin_sizes)
        && (!s.platform || s.platform === 'visium_hd'));
      const union = uniq(found.flatMap((s) => s.bin_sizes)).sort();
      const options = union.length ? union : DEFAULT_BINS;
      for (const [sel, key] of [[binSel, 'bin_size'], [qcSel, 'qc_bin_size']]) {
        const cur = cfg[key];
        const items = uniq([...options, ...(cur ? [cur] : [])]).sort().map((b) => {
          let note = '';
          if (union.length && !union.includes(b)) note = ' — not found';
          else if (found.length > 1 && !found.every((s) => s.bin_sizes.includes(b))) note = ' — missing in some sections';
          return { b, text: `${binLabel(b)} (${b})${note}` };
        });
        const sig = `${items.map((i) => i.text).join('|')}#${cur}`;
        if (sel.dataset.sig === sig) continue;
        sel.dataset.sig = sig;
        mount(sel, items.map((i) => h('option', { value: i.b, selected: i.b === cur }, i.text)));
      }
    }

    function paintReport() {
      mount(reportBox, reportPanel({
        report: d.report, cfg, checking: d.checking, stale: reportStale(), error: d.reportError, checkedAt: d.reportAt,
        onExplore: (sid) => openExplore(sid || null),
      }));
      recheck.disabled = d.checking;
      fillBins();
      paintTissue();
      autoDetectTissue();
    }

    // ---- tissue and cell types (cell_types.py): detected once the data check has found the sections; the
    // signatures follow the detected cell types unless the user edited them
    const tissueBox = h('div');
    const redetect = button({ label: 'Detect again', icon: 'refresh', small: true, kind: 'ghost', onClick: () => { detectTissue(true); } });
    redetect.title = 'Detect the tissue and its cell types from the data again';

    function paintTissue() {
      const key = dataKey(d.config);
      mount(tissueBox, tissuePanel({
        result: d.tissue && d.tissueKey === key ? d.tissue : null, record: d.config.tissue, cfg: d.config,
        busy: d.tissueBusy, error: d.tissueKey === key ? d.tissueError : null, onApply: () => applyTissue(d.tissue, false),
      }));
      redetect.disabled = !!d.tissueBusy || !sectionsFound();
    }

    function sectionsFound() {
      return !!(d.report && !reportStale() && (d.report.samples || []).some((s) => s.bin_dir));
    }

    function autoDetectTissue() {
      if (d.checking || d.tissueBusy || !sectionsFound()) return;
      const key = dataKey(d.config);
      if (d.tissueKey === key) return;
      // detected before for this data (saved with the project): shown as such; "Detect again" repeats it
      if (d.config.tissue && d.config.tissue.data_key === key) return;
      detectTissue(false);
    }

    async function detectTissue(manual) {
      if (d.tissueBusy) return;
      const key = dataKey(d.config);
      d.tissueBusy = true;
      d.tissueError = null;
      if (alive) paintTissue();
      try {
        const res = await api(`/api/projects/${enc(d.id)}/detect-tissue`, { method: 'POST', body: { config: d.config } });
        d.tissue = res;
        d.tissueKey = key;
        if (dataKey(d.config) === key && mayAutoApply(d.config, defCfg)) applyTissue(res, true);
        else if (manual) toast(`Detected tissue: ${res.tissue.label}. Your edited signatures were kept; “Use these cell types” replaces them.`, 'info', { timeout: 8000 });
      } catch (e) {
        d.tissueError = e;
        d.tissueKey = key;
      } finally {
        d.tissueBusy = false;
        if (alive) paintTissue();
      }
    }

    function applyTissue(res, automatic) {
      if (!res || !res.config) return;
      const undo = applyTissueConfig(d.config, res.config, dataKey(d.config));
      changed({ data: true });
      paintTissue();
      const undoBtn = h('button', {
        type: 'button', class: 'linklike',
        onClick: () => { undoTissueConfig(d.config, undo); changed({ data: true }); paintTissue(); toast('The previous signatures are back.', 'info', { timeout: 2500 }); },
      }, 'Undo');
      toast(h('span', null, appliedMessage(res), automatic ? ' (automatic) ' : ' ', undoBtn), 'success', { timeout: 12000 });
    }

    function suggestReplace() {
      const samples = Array.isArray(d.config.samples) ? d.config.samples : [];
      const pairs = (list) => JSON.stringify((list || []).map((s) => [s.id, s.path]));
      const reported = d.report && !reportStale() ? d.report.samples || [] : [];
      return !samples.length || pairs(samples) === pairs(defCfg.samples) || (reported.length > 0 && reported.every((s) => !s.bin_dir));
    }

    // The detection request may outlive this tab (tab switch, or a save that re-rendered it): apply the choice to the
    // current draft; the data check that follows the change repaints the Data tab.
    async function chooseSamples(res) {
      const choice = await chooseDetectedSamples({ result: res, cfg: d.config, suggestReplace: suggestReplace() });
      if (!choice) return;
      // the default samples describe the manuscript's sections (LL-2-1 control, RL-1-5 tumor-bearing): their folders
      // keep those settings instead of guessed ones
      const added = applyDetectedSamples(d.config, choice.candidates, { replace: choice.replace, templates: defCfg.samples });
      const preset = applyQcPreset(d.config);
      changed({ data: true });
      toast(`${plural(added.length, 'sample')} added.${preset ? ` ${preset}` : ''}`, 'success', preset ? { timeout: 8000 } : undefined);
    }

    const binFields = h('div', { class: 'form-grid' },
      field({ label: 'Analysis bin size', forId: binId, control: binSel, help: 'The square_<size> folder of Visium HD sections that is analysed, and the bins a Stereo-seq chip is summed into. Spots and cells are analysed as they are.' }),
      field({ label: 'Quality-control bin size', forId: qcId, control: qcSel, help: 'The bin size of the per-bin quality-control table.' }));
    // a hosted server: the data is uploaded to the project's upload folder, its data root, instead of chosen on disk
    const upload = state.health && state.health.hosted ? uploadPanel({
      projectId: d.id,
      getBins: () => uniq([d.config.bin_size, d.config.qc_bin_size].filter(Boolean)),
      onUploaded: async (root) => {
        if (d.config.data_root !== root) {
          d.config.data_root = root;
          changed({ data: true });
        }
        const res = await api(`/api/projects/${enc(d.id)}/detect-samples`, { method: 'POST', body: { data_root: root } });
        if (!alive) return;
        if (!hasSamples(d.config)) addFoundSamples(res);   // nothing to choose between: every section is added
        else chooseSamples(res);
      },
    }) : null;

    // A project without samples whose upload folder holds sections (uploaded earlier, the choice of samples cancelled,
    // or its samples removed): the sections are found and added when the Data tab opens, so that the data check finds
    // them. Hosted servers only: there the data root is the project's own upload folder.
    function addFoundSamples(res) {
      const candidates = (res && res.candidates) || [];
      if (!candidates.length || hasSamples(d.config)) return;
      const added = applyDetectedSamples(d.config, candidates, { replace: false, templates: defCfg.samples });
      const preset = applyQcPreset(d.config);
      changed({ data: true });
      toast(`${plural(added.length, 'section')} found in the uploaded data and added as samples (${added.map((s) => s.id).join(', ')}). Check them in the sample table, then save.${preset ? ` ${preset}` : ''}`,
        'success', { timeout: 9000 });
    }

    async function autoAddUploadedSamples() {
      if (!upload || hasSamples(d.config) || !d.config.data_root || d.autoSamplesRoot === d.config.data_root) return;
      d.autoSamplesRoot = d.config.data_root;   // once per folder and session: removing every sample is respected
      try {
        const res = await api(`/api/projects/${enc(d.id)}/detect-samples`, { method: 'POST', body: { data_root: d.config.data_root } });
        if (alive) addFoundSamples(res);
      } catch (e) {
        console.warn('detecting the uploaded sections failed', e);
      }
    }

    mount(host, h('div', { class: 'stack-lg' },
      upload ? card({
        title: 'Upload data',
        body: h('div', { class: 'stack' }, upload.el, binFields),
      }) : card({
        title: 'Data location',
        body: h('div', { class: 'stack' },
          field({
            label: 'Data root', forId: rootInput.id, control: h('div', { class: 'input-group' }, rootInput, browse),
            help: 'The folder that holds the sample folders; relative sample folders are resolved against it. A relative data root is resolved against the folder the server was started in.',
          }),
          h('div', { class: 'row' }, detect, h('span', { class: 'muted small' }, 'Finds the sections under the data root (up to four levels deep) and adds them as samples: Space Ranger outputs (Visium HD, Visium), Xenium, MERSCOPE, CosMx, Stereo-seq, .h5ad files and count tables.')),
          binFields),
      }),
      card({ title: 'Data check', subtitle: 'Sample folders, bin sizes, images and gene coverage, checked with the settings above (saved or not).', actions: recheck, body: reportBox }),
      card({ title: 'Tissue and cell types', subtitle: 'Detected from the expression data: the signatures (Cell Settings tab) are set to the cell types of the detected tissue.', actions: redetect, body: tissueBox })));
    paintReport();
    autoAddUploadedSamples();
    const tabHandle = { onReport: paintReport, start: () => { if (!d.checking) validateNow(false); } };
    return tabHandle;
  }

  /**
   * Quality-control thresholds suited to the instrument (GET /api/defaults platforms[].qc: a Visium HD bin, a Visium
   * spot and an imaged cell hold very different numbers of UMIs, and imaging panels have no mitochondrial genes), set
   * when every section comes from one instrument and the thresholds are still a default (the configuration's, or
   * another instrument's). Returns what changed, for the toast, or ''.
   */
  function qcPresets() {
    const list = Array.isArray(defaults.platforms) ? defaults.platforms : [];
    return Object.fromEntries(list.filter((x) => x && x.qc).map((x) => [x.id, x]));
  }

  /** The preset of the instrument every section comes from, else null. */
  function qcPresetOf(cfg) {
    const platforms = uniq((Array.isArray(cfg.samples) ? cfg.samples : []).map((x) => x.platform || 'visium_hd'));
    return platforms.length === 1 ? qcPresets()[platforms[0]] || null : null;
  }

  /** The thresholds the Explore tab's Defaults button sets: the instrument's, else the configuration's. */
  function defaultQcOf(cfg) {
    const preset = qcPresetOf(cfg);
    return preset ? { ...(defCfg.qc || {}), ...preset.qc } : (defCfg.qc || {});
  }

  function applyQcPreset(cfg) {
    const keys = ['min_genes', 'min_counts', 'max_pct_mt'];
    const presets = qcPresets();
    const target = qcPresetOf(cfg);
    if (!target) return '';
    if (!cfg.qc || typeof cfg.qc !== 'object') cfg.qc = {};
    const qc = cfg.qc;
    const same = (a, b) => keys.every((k) => Number(a[k]) === Number(b[k]));
    const known = [defCfg.qc || {}, ...Object.values(presets).map((x) => x.qc)];
    if (same(qc, target.qc) || !known.some((q) => same(qc, q))) return '';   // already set, or set by hand: kept
    keys.forEach((k) => { qc[k] = target.qc[k]; });
    return `Quality control set for ${platformName(target.id)} ${unitWord(target.unit)}: more than ${fmt.num(qc.min_genes)} genes and ${fmt.num(qc.min_counts)} UMIs${Number(qc.max_pct_mt) < 100 ? `, less than ${fmt.num(qc.max_pct_mt)}% mitochondrial` : ''} (Explore tab).`;
  }

  /** In the run plan: what the sections of other instruments are analysed as (from the data check). */
  function unitsNote() {
    const reported = (d.report && d.report.samples) || [];
    const other = reported.filter((x) => x.platform && !['visium_hd', 'stereo_seq'].includes(x.platform) && x.bin_dir);
    if (!other.length) return null;
    const kinds = uniq(other.map((x) => `${platformName(x.platform)} ${unitWord(x.unit)}`));
    return h('span', { class: 'muted' }, ` (Visium HD and Stereo-seq sections; ${kinds.join(', ')} are analysed as they are)`);
  }

  // ---- Explore
  /** Open the Explore tab, on section `sid` when given (the Data tab's links: a section's bin count, the data check). */
  function openExplore(sid) {
    d.ui.exploreFocus = sid || null;
    switchTab('explore');
  }

  function exploreTab(host) {
    // the results stay while the data settings and QC thresholds stay the same; otherwise they are read again
    d.explore = exploreState(d.config, exploreKey(d.config), d.explore);
    const focus = d.ui.exploreFocus;
    d.ui.exploreFocus = null;
    const explorer = dataExplorer({
      projectId: d.id, name: d.name.trim() || d.id, state: d.explore, getConfig: () => d.config, focus,
      onOpenData: () => switchTab('data'),
      // the quality-control thresholds are set here, where the bins they keep are counted: changed, the tab reads
      // the sections again with them
      defaultQc: defaultQcOf(d.config),
      onQcChange: () => { changed(); if (alive && current === 'explore') renderBody(); },
    });
    mount(host, explorer.el);
    return { destroy: explorer.destroy };
  }

  // ---- Signatures
  function signaturesTab(host) {
    const hint = h('div');
    const paintHint = () => mount(hint, !d.report && !d.checking ? banner('info', h('span', null,
      'Gene chips are colored once the data has been checked (green: in the probe set, red: missing). ',
      h('button', { type: 'button', class: 'linklike', onClick: () => { validateNow(true); } }, 'Check the data now'))) : null);
    const editor = signatureEditor({ cfg: d.config, defaults: defCfg, report: d.report, ui: d.ui, onChange: () => changed() });
    mount(host, h('div', null, hint, editor.el));
    paintHint();
    return { onReport: () => { paintHint(); editor.setReport(d.report); } };
  }

  // ---- Region of interest
  function roiSampleStatus(sid) {
    const saved = d.saved.config || {};
    const savedSample = (Array.isArray(saved.samples) ? saved.samples : []).find((s) => s.id === sid);
    if (!savedSample) {
      return {
        ok: false, canSave: true, title: 'Save the project first',
        text: `Section ${sid} is not in the saved settings yet, and its H&E image is found through the saved data settings.`,
      };
    }
    const draftSample = (Array.isArray(d.config.samples) ? d.config.samples : []).find((s) => s.id === sid) || {};
    const differs = saved.data_root !== d.config.data_root || savedSample.path !== draftSample.path || saved.bin_size !== d.config.bin_size;
    return { ok: true, note: differs ? 'The data settings of this section have unsaved changes; the image shown comes from the saved settings.' : '' };
  }

  function roiTab(host) {
    const editor = roiEditor({
      projectId: d.id, cfg: d.config, store: d.roi, savedRois: d.rois,
      getVersion: () => d.updated || '',
      sampleStatus: roiSampleStatus,
      onConfigChange: () => changed(),
      onRoisChange: () => refreshChrome(),
      onSaveProject: () => save(),
    });
    mount(host, editor.el);
    return { destroy: editor.destroy, onChrome: editor.refresh };
  }

  // ---- Run
  function runTab(host) {
    let destroyed = false;
    const cfg = d.config;
    // the steps a run may switch (GET /api/defaults app_steps: pipeline_config.APP_STEPS); they are settings of the
    // project like any other, saved with it. Every other step of the pipeline is a tool of a run's Analysis tab.
    const appSteps = Array.isArray(defaults.app_steps) ? defaults.app_steps : [];
    const ui = d.ui;
    const steps = () => {
      if (!cfg.steps || typeof cfg.steps !== 'object') cfg.steps = {};
      return cfg.steps;
    };
    const statusBox = h('div', { class: 'stack' });
    const errorBox = h('div');
    const runsBox = h('div', null, loading('Loading runs…'));
    const labelId = `run-label-${d.id}`;
    const labelInput = h('input', { class: 'input', id: labelId, value: ui.runLabel || '', placeholder: 'e.g. first pass with the default settings', maxlength: 200 });
    labelInput.addEventListener('input', () => { ui.runLabel = labelInput.value; });
    const startBtn = h('button', { type: 'button', class: 'btn primary start-btn' });
    const paintStart = (busy) => mount(startBtn, busy ? h('span', { class: 'spinner' }) : icon('play', { size: 16 }), busy ? 'Starting…' : 'Start analysis');
    paintStart(false);
    let starting = false;
    startBtn.addEventListener('click', async () => {
      if (startBtn.disabled || starting) return;
      starting = true;
      startBtn.disabled = true;
      paintStart(true);
      try {
        await start();
      } catch (e) {
        showStartError(e.message || String(e));
      } finally {
        starting = false;
        if (!destroyed) { paintStart(false); paintStatus(); }
      }
    });

    function showStartError(message) {
      if (destroyed) { toast(message, 'error'); return; }
      mount(errorBox, message ? banner('danger', [h('strong', null, 'The analysis did not start. '), message]) : null);
    }

    const missingPackages = () => (state.health && Array.isArray(state.health.missing_required) ? state.health.missing_required : []);

    function paintStatus() {
      if (destroyed) return;
      const items = [];
      const missing = missingPackages();
      const errs = d.validation.errors;
      if (missing.length) items.push(banner('danger', [h('strong', null, 'Missing Python packages: '), missing.join(', '), '. The analysis cannot start until they are installed.']));
      if (errs.length) {
        items.push(banner(d.dirty ? 'warning' : 'danger', [
          h('strong', null, d.dirty ? `The saved settings have ${plural(errs.length, 'error')}; they are checked again when you start: `
            : `${plural(errs.length, 'configuration error')} must be fixed before the analysis can start:`),
          h('ul', null, errs.map((t) => h('li', null, t)))]));
      }
      if (d.dirty) items.push(banner('info', 'You have unsaved changes: starting saves them first.'));
      const rep = d.report;
      if (d.checking) items.push(banner('info', 'Checking the data…'));
      else if (!rep) {
        items.push(banner('info', h('span', null, 'The data has not been checked. ',
          h('button', { type: 'button', class: 'linklike', onClick: () => { validateNow(true); } }, 'Check it now'))));
      } else if ((rep.errors || []).length) {
        items.push(banner('warning', [h('strong', null, `The data check found ${plural(rep.errors.length, 'problem')}`, reportStale() ? ' (settings changed since)' : '', ':'),
          h('ul', null, rep.errors.map((t) => h('li', null, t)))]));
      } else if (reportStale()) {
        items.push(banner('info', h('span', null, 'The data settings changed since the last check. ',
          h('button', { type: 'button', class: 'linklike', onClick: () => { validateNow(true); } }, 'Check again'))));
      }
      const roi = cfg.roi || {};
      const pending = roiUnsaved(d);
      if (roi.use_drawn && pending.length) items.push(banner('warning', `Unsaved drawn region${pending.length === 1 ? '' : 's'} (${pending.join(', ')}): runs use the saved regions only. Save them in the Region of interest tab.`));
      if (roi.use_drawn && !d.rois.size) items.push(banner('info', 'Drawn regions are switched on, but no section has a saved region: the analysis is not restricted.'));
      if (!items.length && hasSamples(d.config)) items.push(banner('success', 'Ready to start.'));
      mount(statusBox, items);
      if (!starting) startBtn.disabled = missing.length > 0 || (errs.length > 0 && !d.dirty);
    }

    function planCard() {
      const samples = Array.isArray(cfg.samples) ? cfg.samples : [];
      const roi = cfg.roi || {};
      const qc = cfg.qc || {};
      const optional = (s) => h('li', { class: 'plan-step slow' },
        switchToggle({ checked: steps()[s.key] !== false, label: s.label, onChange: (v) => { steps()[s.key] = v; changed(); } }),
        h('div', { class: 'plan-help muted small' }, s.help || ''));
      return card({
        title: 'What a run does',
        subtitle: 'What every dataset needs. The questions are asked afterwards, in the Analysis tab of the run.',
        body: h('div', { class: 'stack' },
          h('dl', { class: 'kv' },
            h('dt', null, 'Sections'), h('dd', null, samples.length ? h('ul', { class: 'plan-samples' }, samples.map((s) => h('li', null,
              h('span', { class: 'swatch', style: { background: /^#[0-9A-Fa-f]{6}$/.test(String(s.color)) ? s.color : 'transparent' } }),
              h('span', null, s.label || s.id), h('span', { class: 'mono small muted' }, s.id), h('span', { class: 'muted small' }, s.condition || ''),
              s.id === cfg.reference_sample ? h('span', { class: 'badge' }, 'reference') : null))) : h('span', { class: 'muted' }, 'none')),
            h('dt', null, 'Bin size'), h('dd', null, binLabel(cfg.bin_size), unitsNote()),
            h('dt', null, 'Quality control'), h('dd', null,
              `more than ${fmt.num(qc.min_genes)} genes, more than ${fmt.num(qc.min_counts)} UMIs, less than ${fmt.num(qc.max_pct_mt)}% mitochondrial `,
              h('button', { type: 'button', class: 'linklike', onClick: () => switchTab('explore') }, '(Explore tab)')),
            h('dt', null, 'Drawn regions'), h('dd', null, roi.use_drawn
              ? (samples.length ? samples.map((s) => `${s.id}: ${d.rois.has(s.id) ? 'saved region' : 'none (not restricted)'}`).join(' · ') : '—')
              : 'not used')),
          h('h4', null, 'Always'),
          h('ul', { class: 'plan-steps' }, ALWAYS_STEPS.map((label) => h('li', { class: 'plan-step' }, icon('check', { size: 14 }), h('span', null, label)))),
          appSteps.length ? h('h4', null, 'Optional') : null,
          appSteps.length ? h('ul', { class: 'plan-steps' }, appSteps.map(optional)) : null,
          h('div', { class: 'plan-det' }, switchToggle({
            checked: cfg.deterministic !== false, label: 'Deterministic (single-threaded, reproducible; slower)',
            onChange: (v) => { cfg.deterministic = v; changed(); },
          })),
          h('p', { class: 'muted small plan-note' }, 'Differences between groups, distances, composition, spatially variable genes and the other analyses are no longer steps of the run: each is a tool of the Analysis tab, with its own settings, used when you want it.')),
      });
    }

    async function start() {
      showStartError(null);
      if (missingPackages().length) { showStartError(`Missing Python packages: ${missingPackages().join(', ')}.`); return; }
      if (computeDirty()) {
        const ok = await confirmDialog({
          title: 'Save changes and start?',
          message: 'The analysis runs on the saved settings. Your unsaved changes are saved first.',
          confirmLabel: 'Save and start',
        });
        if (!ok) return;
        if (!(await save())) return;
      }
      if (!hasSamples(d.config)) {
        showStartError(h('span', null, 'No data yet: upload the data files of the sections and add the samples on the ',
          h('button', { type: 'button', class: 'linklike', onClick: () => switchTab('data') }, 'Data tab'), ' first.'));
        return;
      }
      if (d.validation.errors.length) {
        showStartError(`Fix the ${plural(d.validation.errors.length, 'configuration error')} listed above first.`);
        return;
      }
      if (d.report && !reportStale() && (d.report.errors || []).length) {
        const ok = await confirmDialog({
          title: 'Start despite data problems?',
          message: `The data check reported ${plural(d.report.errors.length, 'problem')}; the analysis will probably fail.`,
          confirmLabel: 'Start anyway', danger: true,
        });
        if (!ok) return;
      }
      const pending = roiUnsaved(d);
      if (pending.length && cfg.roi && cfg.roi.use_drawn) {
        const ok = await confirmDialog({
          title: 'Start without the unsaved regions?',
          message: `The drawn region${pending.length === 1 ? '' : 's'} of ${pending.join(', ')} ${pending.length === 1 ? 'is' : 'are'} not saved; the run uses the saved regions only.`,
          confirmLabel: 'Start anyway',
        });
        if (!ok) return;
      }
      try {
        // the saved settings decide what runs (the switches of this tab are part of them)
        const run = await api(`/api/projects/${enc(d.id)}/runs`, { method: 'POST', body: { label: (ui.runLabel || '').trim() } });
        ui.runLabel = '';
        toast('Analysis queued', 'success', { timeout: 2500 });
        navigate(`/runs/${enc(run.id)}`);
      } catch (e) {
        if (e.status === 409) { showStartError(e.message); return; }
        throw e;
      }
    }

    function paintRuns(runs) {
      if (!runs.length) {
        mount(runsBox, h('p', { class: 'muted' }, 'No runs yet.'));
        return;
      }
      // the whole row opens the run; the label stays a link for the keyboard (and for opening it in a new tab)
      mount(runsBox, h('div', { class: 'table-wrap' }, h('table', { class: 'table compact project-runs' },
        h('thead', null, h('tr', null, h('th', null, 'Run'), h('th', null, 'Status'), h('th', null, 'Created'), h('th', { class: 'num' }, 'Duration'), h('th', null, 'Progress'))),
        h('tbody', null, runs.map((r) => {
          const href = `#/runs/${enc(r.id)}`;
          const prog = r.progress || {};
          const active = r.status === 'running' || r.status === 'queued';
          return h('tr', {
            class: 'clickable',
            onClick: (e) => {
              if (e.target.closest('a, button, input, select, textarea')) return;
              if (String(window.getSelection ? window.getSelection() : '').trim()) return;   // selecting text is not a click
              navigate(`/runs/${enc(r.id)}`);
            },
          },
            h('td', null, h('a', { href }, r.label || r.id), r.label ? h('div', { class: 'mono small muted' }, r.id) : null),
            h('td', null, statusBadge(r.status)),
            h('td', { title: fmt.date(r.created) }, fmt.ago(r.created)),
            h('td', { class: 'num' }, fmt.duration(r.duration_s)),
            h('td', null, active && r.status === 'running' && Number.isFinite(prog.fraction)
              ? h('div', { class: 'run-progress', title: prog.label || '' }, h('div', { class: 'progress' }, h('div', { class: 'bar', style: { width: `${Math.round(prog.fraction * 100)}%` } })),
                h('span', { class: 'muted small' }, `${Math.round(prog.fraction * 100)}%`))
              : h('span', { class: 'muted small' }, r.status === 'failed' && r.error ? String(r.error).split('\n')[0].slice(0, 90) : '')));
        })))));
    }

    let poller = null;
    function startPolling() {
      if (poller) poller.stop();
      poller = poll(async () => {
        try {
          const runs = await api('/api/runs', { query: { project: d.id } });
          if (destroyed) return false;
          const list = Array.isArray(runs) ? runs : [];
          paintRuns(list);
          return list.some((r) => r.status === 'queued' || r.status === 'running');
        } catch (e) {
          if (!destroyed) mount(runsBox, errorPanel(e, { retry: () => { mount(runsBox, loading('Loading runs…')); startPolling(); } }));
          return false;
        }
      }, RUNS_POLL_MS);
    }

    const onHealth = () => paintStatus();
    window.addEventListener('health', onHealth);

    mount(host, h('div', { class: 'stack-lg' },
      h('div', { class: 'grid-2 run-grid' },
        planCard(),
        card({
          title: 'Start',
          body: h('div', { class: 'stack' }, statusBox,
            field({ label: 'Run label (optional)', forId: labelId, control: labelInput, help: 'Shown in the list of runs.' }),
            h('div', { class: 'row' }, startBtn), errorBox),
        })),
      card({
        title: 'Runs of this project',
        actions: h('a', { class: 'project-runs-link', href: '#/runs' }, 'See all runs', icon('chevron-right', { size: 13 })),
        body: runsBox,
      })));
    paintStatus();
    startPolling();
    return {
      onChrome: paintStatus,
      onReport: paintStatus,
      destroy() {
        destroyed = true;
        if (poller) poller.stop();
        window.removeEventListener('health', onHealth);
      },
    };
  }

  // ---------------------------------------------------------------- keyboard, first paint, cleanup
  const onKey = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || (e.key !== 's' && e.key !== 'S')) return;
    if (document.querySelector('.modal-backdrop')) return;
    e.preventDefault();
    save();
  };
  document.addEventListener('keydown', onKey);

  renderBody();
  refreshChrome();

  return () => {
    alive = false;
    clearTimeout(validateTimer);
    clearTimeout(draftTimer);
    if (draftAbort) {
      draftAbort.abort();
      draftAbort = null;
    }
    if (validateAbort) {
      validateAbort.abort();
      validateAbort = null;
      d.checking = false;
    }
    if (tabApi.destroy) {
      try { tabApi.destroy(); } catch (e) { console.error(e); }
    }
    tabApi = {};
    document.removeEventListener('keydown', onKey);
  };
}
