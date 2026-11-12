'use strict';
// Small shared helpers without editor dependencies: escaping for HTML, Markdown and CSV, and
// shortening of text for labels.

function escapeHtml(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c];
  });
}

/** Escapes text for a Markdown table cell or paragraph: no HTML, no links, no table breaks. */
function escapeMarkdown(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/\r?\n|\r/g, ' ')
    .replace(/([\\`*_{}\[\]()#+!|<>~])/g, '\\$1')
    .replace(/&/g, '&amp;');
}

/**
 * One CSV cell (RFC 4180: quoted when it holds a comma, a quote or a line break, quotes doubled).
 * A value that a spreadsheet would run as a formula (starting with =, +, -, @, a tab or a carriage
 * return) gets a leading apostrophe first, unless `options.neutraliseFormulas` is false (the
 * setting achAtlas.export.neutraliseFormulas, on by default).
 */
function csvCell(value, options) {
  let s = String(value === undefined || value === null ? '' : value);
  if ((!options || options.neutraliseFormulas !== false) && /^[=+\-@\t\r]/.test(s)) s = '\'' + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function csvRow(cells, options) { return cells.map(function (c) { return csvCell(c, options); }).join(',') + '\r\n'; }

/** Shortens text to `max` characters with an ellipsis. */
function shorten(text, max) {
  const s = String(text === undefined || text === null ? '' : text);
  if (s.length <= max) return s;
  return s.slice(0, Math.max(1, max - 1)) + '…';
}

/** A file name without characters that are unsafe on common file systems. */
function safeName(s) {
  return String(s || 'file').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'file';
}

module.exports = { escapeHtml: escapeHtml, escapeMarkdown: escapeMarkdown, csvCell: csvCell, csvRow: csvRow, shorten: shorten, safeName: safeName };
