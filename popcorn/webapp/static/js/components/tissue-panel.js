// tissue-panel.js — the tissue and cell types detected from a project's data (POST /api/projects/{id}/detect-tissue,
// cell_types.py), and the configuration changes that give the project signatures of those cell types.
//
// A project whose signatures are the defaults (the manuscript's bone signatures), or still the ones a detection set,
// takes the detected signatures automatically; a project whose signatures were edited is offered them instead.
import { h, icon, button, clone } from '../core.js';

// pipeline_config._REPLACE: settings whose value replaces the project's instead of being merged key by key
const REPLACE = new Set(['samples', 'signatures', 'classes', 'primary', 'programs', 'receptor_panel', 'adipocyte_genes',
  'ubiquitous', 'masks', 'pairs', 'variants', 'positivity_panels', 'receptor_genes', 'composition_signatures',
  'exclude', 'stability_seeds', 'sweep_thresholds', 'tumor_conditions', 'growth_plate_masks']);

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function mergeInto(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (!REPLACE.has(k) && isPlain(v) && isPlain(target[k])) mergeInto(target[k], v);
    else target[k] = clone(v);
  }
}

/** A short fingerprint of the signatures (to tell whether they were edited since a detection set them). */
export function signatureFingerprint(signatures) {
  const text = JSON.stringify(signatures || {});
  let a = 5381;
  let b = 52711;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = ((a * 33) ^ c) >>> 0;
    b = ((b * 31) + c) >>> 0;
  }
  return `${a.toString(16)}${b.toString(16)}`;
}

/** Whether a detection may replace the signatures without asking: they are the defaults, or what a detection set. */
export function mayAutoApply(cfg, defaults) {
  if (JSON.stringify(cfg.signatures || {}) === JSON.stringify((defaults && defaults.signatures) || {})) return true;
  const t = cfg.tissue;
  return !!(t && t.auto && t.fingerprint === signatureFingerprint(cfg.signatures));
}

/** Whether the project's signatures are the ones the detection `result` gives. */
export function isApplied(cfg, result) {
  const t = cfg.tissue;
  return !!(result && t && t.name === result.tissue.name && t.fingerprint === signatureFingerprint(cfg.signatures)
    && JSON.stringify(Object.keys(cfg.signatures || {})) === JSON.stringify(Object.keys(result.config.signatures || {})));
}

/**
 * Apply the configuration changes of a detection to `cfg` (the draft). Returns what undoTissueConfig() needs to put
 * the previous settings back.
 */
export function applyTissueConfig(cfg, patch, dataKey) {
  const undo = {};
  for (const k of Object.keys(patch)) undo[k] = k in cfg ? clone(cfg[k]) : undefined;
  const { tissue, ...rest } = patch;
  for (const [k, v] of Object.entries(rest)) {
    if (REPLACE.has(k) || !isPlain(v) || !isPlain(cfg[k])) cfg[k] = clone(v);
    else mergeInto(cfg[k], v);
  }
  cfg.tissue = { ...clone(tissue || {}), fingerprint: signatureFingerprint(cfg.signatures), data_key: dataKey };
  return undo;
}

export function undoTissueConfig(cfg, undo) {
  for (const [k, v] of Object.entries(undo)) {
    if (v === undefined) delete cfg[k];
    else cfg[k] = v;
  }
}

/** One line for a toast: what was detected and what the signatures now are. */
export function appliedMessage(result) {
  const t = result.tissue;
  const n = Object.keys(result.config.signatures || {}).length;
  const species = result.species && result.species !== 'unknown' ? ` (${result.species})` : '';
  if (t.name === 'bone') return `Detected tissue: ${t.label}${species}. The bone signatures are used.`;
  if (t.name === 'unknown') return `The tissue could not be named${species}: the signatures are set to the ${n} cell types found in the data.`;
  return `Detected tissue: ${t.label}${species}. The signatures are set to its ${n} cell types.`;
}

const CONFIDENCE = { high: 'high confidence', medium: 'medium confidence', low: 'low confidence' };

/**
 * The panel of the Data tab. result: the last detection (or null); record: cfg.tissue (what a detection set, saved
 * with the project); busy, error: the request; onApply(): use the detected signatures.
 */
export function tissuePanel({ result, record, cfg, busy = false, error = null, onApply }) {
  if (busy) {
    return h('div', { class: 'report-status' }, h('span', { class: 'spinner' }),
      'Detecting the tissue and its cell types from the expression data…');
  }
  const parts = [];
  if (error) parts.push(h('div', { class: 'state bad' }, icon('alert', { size: 13 }), `The detection failed: ${error.message || error}`));
  if (!result) {
    if (record && record.name) {
      parts.push(h('p', null, 'Detected earlier: ', h('strong', null, record.label || record.name),
        record.species && record.species !== 'unknown' ? ` (${record.species})` : '',
        record.confidence ? h('span', { class: 'muted' }, ` · ${CONFIDENCE[record.confidence] || record.confidence}`) : null, '.'));
      parts.push(h('p', { class: 'muted small' }, '“Detect again” shows the cell types found.'));
    } else if (!error) {
      parts.push(h('p', { class: 'muted' }, 'The tissue is detected once the data check has found the sections.'));
    }
    return h('div', { class: 'stack' }, parts);
  }

  const t = result.tissue;
  const others = (result.tissues_used || []).slice(1)
    .map((name) => (result.tissues || []).find((x) => x.name === name)).filter(Boolean).map((x) => x.label);
  parts.push(h('div', { class: 'report-status' },
    icon(t.name === 'unknown' ? 'info' : 'check', { size: 16, cls: t.name === 'unknown' ? '' : 'tone-ok' }),
    h('span', null, t.name === 'unknown' ? 'Tissue not recognised' : h('span', null, 'Tissue: ', h('strong', null, t.label))),
    h('span', { class: 'badge' }, CONFIDENCE[t.confidence] || t.confidence),
    result.species && result.species !== 'unknown' ? h('span', { class: 'muted' }, `${result.species} gene names`) : null));
  if (others.length) parts.push(h('p', { class: 'muted small' }, `Also in the sections: ${others.join(', ')}.`));
  if (t.name === 'unknown') {
    parts.push(h('p', { class: 'muted small' }, 'No tissue of the library matched; the cell types found in the data (generic ones, and others with strong evidence) are used.'));
  }

  const selected = (result.cell_types || []).filter((c) => c.selected);
  const applied = isApplied(cfg, result);
  if (applied) {
    parts.push(h('div', { class: 'state ok' }, icon('check', { size: 13 }),
      t.name === 'bone' ? 'The project uses the bone signatures (Cell Settings tab).'
        : `The project's signatures are these ${selected.length} cell types (Cell Settings tab).`));
  } else {
    parts.push(h('div', { class: 'row' },
      h('span', { class: 'muted small' }, 'Your signatures differ from the detected cell types.'),
      button({ label: t.name === 'bone' ? 'Use the bone signatures' : `Use these ${selected.length} cell types`, icon: 'dna', small: true, onClick: onApply })));
  }

  const sigs = (cfg && cfg.signatures) || {};
  const row = (c) => h('tr', null,
    h('td', null, sigs[c.name] && sigs[c.name].color ? h('span', { class: 'swatch', style: { background: sigs[c.name].color } }) : null, ' ', c.label,
      c.present ? null : h('div', { class: 'muted small', title: 'Its markers are expressed but not clearly co-expressed; it is used because it makes up the detected tissue.' }, 'expected in this tissue')),
    h('td', { class: 'muted small' }, c.tissues && c.tissues.length ? c.tissues.join(', ') : 'any tissue'),
    h('td', null, h('div', { class: 'pill-list' }, (c.markers || []).slice(0, 6).map((g) => h('span', { class: 'chip no-x' }, g)))),
    h('td', { class: 'num', title: 'Co-expression of the markers above random gene sets, in standard deviations' }, c.z.toFixed(1)));
  if (selected.length) {
    parts.push(h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
      h('thead', null, h('tr', null, h('th', null, 'Cell type'), h('th', null, 'Tissue'), h('th', null, 'Markers co-expressed'), h('th', { class: 'num' }, 'Evidence (z)'))),
      h('tbody', null, selected.map(row)))));
  }
  const rest = (result.cell_types || []).filter((c) => !c.selected);
  if (rest.length) {
    parts.push(h('details', { class: 'small' },
      h('summary', null, `Other cell types of the library (${rest.length})`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
        h('thead', null, h('tr', null, h('th', null, 'Cell type'), h('th', null, 'Tissue'), h('th', null, 'Finding'))),
        h('tbody', null, rest.map((c) => h('tr', null, h('td', null, c.label),
          h('td', { class: 'muted small' }, c.tissues && c.tissues.length ? c.tissues.join(', ') : 'any tissue'),
          h('td', { class: 'muted small' }, c.present ? `present (z ${c.z.toFixed(1)}), not part of the detected tissue` : c.status))))))));
  }
  if (result.problems && result.problems.length) {
    parts.push(h('p', { class: 'muted small' }, `Not read: ${result.problems.join('; ')}`));
  }
  return h('div', { class: 'stack' }, parts);
}
