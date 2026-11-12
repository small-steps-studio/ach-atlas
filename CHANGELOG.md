# Changelog

## 0.1.0

First release. The free features need no key, no account and no network connection. The Pro features can be tried free for 14 days and are then unlocked with a one-time licence key sold outside the Marketplace.

Free:

* ACH language for `.ach` and `.nacha` files and for text files that start with an ACH file header, with field colours, a ruler at column 94 and trailing spaces kept on save.
* File Outline view, document symbols, breadcrumbs and folding by batch; large batches are listed in pages.
* Hover on every field: name, positions, raw value and meaning (amounts, dates, routing numbers with their check digit, transaction, SEC, service class, addenda, return and change codes), and the computed value of control fields.
* Problems with stable codes: record length, type and order, counts, entry hash, debit and credit totals of every batch and of the file, block count and filler, check digits, transaction codes against the service class, SEC-code checks for PPD, CCD, CTX, WEB and TEL and basic IAT checks, effective dates, addenda, trace numbers and amounts.
* Copy Field Path At Cursor, Go To Batch, Show File Totals, and the field and totals in the status bar.
* Samples with invented data, a walkthrough, Report A Problem and Show Documentation.

Pro (14-day trial, then a licence key):

* Create Test File for PPD, CCD, CTX, WEB and TEL with correct controls.
* Anonymise File and Anonymise Folder with one consistent mapping per run (derived from a random key that is never stored) and adjusted controls.
* Recompute Control Records And Padding with a preview of the difference.
* Compare With Another File, with Markdown and CSV reports; it compares the whole file, including batch controls, file control, filler, records out of place, the byte order mark, empty lines and the exact length of every record.
* Export Entries As CSV and JSON; formula protection of CSV cells can be switched off with a setting.
* Reconciliation report for a folder in HTML and CSV.
* Split Into One File Per Batch (every file with its own file ID modifier) and Merge Files.

Tested with VS Code 1.146 on Windows; the unit tests also ran in three time zones and from a folder whose path contains spaces and non-ASCII characters.
