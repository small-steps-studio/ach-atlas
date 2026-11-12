'use strict';
// The diagnostics block that "Report A Problem" copies to the clipboard. It holds versions, the
// platform, the kind of the active file with its problem counts, the settings and the licence or
// trial state read from what is stored (no network request). It never holds file contents, file
// names, paths, field values, the licence key or its hint, user names or computer names. Pattern
// settings are shown only as "default" or "customised", because they can contain folder names.

const config = require('./licence/config');

const SETTING_KEYS = ['maxFileSizeMB', 'maxProblems', 'validateOnType', 'hover.enabled', 'detectPlainText', 'checks.effectiveDate', 'checks.blocking', 'reconcile.include', 'reconcile.maxFiles', 'export.neutraliseFormulas'];
const PATTERN_KEYS = ['reconcile.include'];

function licenceLine(st) {
  if (!st) return 'unknown';
  const trial = st.trial || { state: 'unused' };
  let text;
  if (st.pro) text = 'Pro (' + (st.licenceType || 'licence') + ', checked within the last day)';
  else if (st.hasKey && st.via === 'stale') text = 'Pro key stored (' + (st.licenceType || 'licence') + '), next check due';
  else if (st.hasKey && st.via === 'product') text = 'Free (stored key of another product)';
  else if (st.hasKey && st.via === 'rejected') text = 'Free (stored key rejected by the server)';
  else if (st.hasKey) text = 'Free (stored key without a usable activation)';
  else if (trial.state === 'active') text = 'Trial (' + trial.daysLeft + ' day' + (trial.daysLeft === 1 ? '' : 's') + ' left)';
  else if (trial.state === 'expired') text = 'Free (trial ended)';
  else text = 'Free (trial not started)';
  if (st.hasKey && trial.state === 'active') text += '; trial active';
  return text + ', licence server: ' + (st.mode || 'live');
}

function settingValue(key, v, defaults) {
  if (v === undefined) return 'default';
  if (PATTERN_KEYS.indexOf(key) !== -1) return defaults && defaults[key] === v ? 'default' : 'customised';
  return typeof v === 'object' || typeof v === 'string' ? JSON.stringify(v) : String(v);
}

/**
 * Builds the block from `info`: extensionVersion, editorName, editorVersion, platform, osRelease,
 * arch, nodeVersion, settings (flat object keyed as SETTING_KEYS), defaults (the same keys),
 * licence (from licence.peek()), active ({ kind, size, records, counts, skipped } or null).
 */
function diagnosticsBlock(info) {
  const i = info || {};
  const lines = [];
  lines.push(config.productName + ' ' + (i.extensionVersion || 'unknown version'));
  lines.push('Editor: ' + (i.editorName || 'unknown') + ' ' + (i.editorVersion || ''));
  lines.push('Platform: ' + (i.platform || 'unknown') + ' ' + (i.osRelease || '') + ' ' + (i.arch || '') + (i.nodeVersion ? ', Node ' + i.nodeVersion : ''));
  const a = i.active;
  if (!a) lines.push('Active file: none');
  else {
    let detail = '';
    if (a.skipped === 'size') detail = ', not checked automatically (over the size limit)';
    else if (a.counts) detail = ', ' + (a.records || 0) + ' records, ' + a.counts.error + ' errors, ' + a.counts.warning + ' warnings, ' + a.counts.info + ' notes';
    lines.push('Active file: ' + (a.kind || 'unknown kind') + (typeof a.size === 'number' ? ', ' + a.size + ' characters' : '') + detail);
  }
  lines.push('Settings:');
  const s = i.settings || {};
  for (const k of SETTING_KEYS) lines.push('  ' + k + ' = ' + settingValue(k, s[k], i.defaults));
  lines.push('Licence: ' + licenceLine(i.licence));
  lines.push('Issues page: ' + config.issuesUrl);
  return lines.join('\n') + '\n';
}

function reportProblemText(opened) {
  return 'A diagnostics block (version numbers, platform, settings, licence state; no file contents, names or values) was copied to the clipboard. ' +
    (opened ? 'Paste it into the issue that opens in your browser, add what you did and what you expected, and attach a small example file with invented data only (the Pro command Anonymise File can mask a real file).'
      : 'Open ' + config.issuesUrl + ', create a new issue, paste the block and describe what you did and what you expected.');
}

module.exports = { diagnosticsBlock: diagnosticsBlock, licenceLine: licenceLine, reportProblemText: reportProblemText, SETTING_KEYS: SETTING_KEYS };
