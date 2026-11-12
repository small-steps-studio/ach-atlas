# Troubleshooting

**The file is not recognised as an ACH file.** Files ending in `.ach` or `.nacha` are recognised by their name. Other files are recognised when their first record starts like an ACH file header (record type 1, priority code, destination, origin, date, record size 094); this needs `achAtlas.detectPlainText` and works for files the editor opens as plain text. Otherwise pick **ACH** in the language selector at the bottom right.

**Every record is reported as too short.** The trailing spaces were removed, usually by an editor setting or a file transfer. ACH Atlas turns off trimming for the ACH language; if the file was saved by another program, **Recompute Control Records And Padding** (Pro) pads the records again, or add the spaces by hand.

**The whole file is one line.** Some systems write ACH files without line breaks. ACH Atlas reads such a file as consecutive 94-character records and says so with the note `ACH-UNWRAPPED`.

**"file over the size limit" in the status bar.** The file is larger than `achAtlas.maxFileSizeMB` (default 20 MB). Run **ACH Atlas: Check Current File** to check it on demand, or raise the setting (up to 50 MB, the largest file the editor hands to extensions).

**A total is reported as wrong although the bank accepted the file.** Check the message: it names the value in the control record and the value computed from the entries. A total is computed only from entries whose amount and routing fields are all digits; if one is not, that field has its own problem and the total is not compared.

**Many warnings about filler records (`ACH-BLOCKING`).** Your bank may accept files whose record count is not a multiple of ten. Turn the check off with `achAtlas.checks.blocking`.

**Weekend notes or warnings about effective dates.** Turn them off with `achAtlas.checks.effectiveDate`; invalid dates are reported in any case. Bank holidays are not known to ACH Atlas.

**A batch is listed but not checked.** Automated accounting advice batches (ADV, service class 280) use another entry layout and are only listed. Batches with SEC codes other than PPD, CCD, CTX, WEB, TEL and IAT are read and totalled; their code-specific fields are not checked (note `ACH-SEC-NOT-CHECKED`).

**Recompute Control Records And Padding refuses the file.** It refuses files with records longer than 94 characters, unknown record types, records out of order and automated accounting advice batches, because the right correction cannot be known. Fix the record named in the message by hand, then run it again. Split Into One File Per Batch and Merge Files refuse the same kinds of files.

**A byte order mark warning (`ACH-BOM`).** The editor hides a UTF-8 byte order mark and shows "UTF-8 with BOM" in the status bar. Choose "Save with Encoding" and then "UTF-8" to write the file without the mark.

**The licence check fails behind a proxy or firewall.** The check needs access to `live.dodopayments.com`. Depending on the editor version, a proxy set in the editor's settings may not be used for it. A key that was checked successfully keeps Pro working for up to 14 days while the server cannot be reached; allow the host in your firewall or proxy to renew the check.

**A Pro command shows the Pro message although you have a key.** Run **ACH Atlas: Show Licence Status**; it names the state and offers **Enter Licence Key** and **Lost your key?**. See [licence.md](licence.md).

**Anything else.** Run **ACH Atlas: Report A Problem**: it copies a diagnostics block (versions, platform, settings, licence state; no file contents, names or values) and opens the issues page. Attach a small example file with invented data only.
