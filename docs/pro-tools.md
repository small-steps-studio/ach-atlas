# Pro tools

The Pro tools can be tried free for 14 days (the trial starts with the first Pro command) and are then unlocked with a one-time licence key. They run on your computer; no file content is sent anywhere. Each tool writes files only where you confirm, and never changes a file on disk without asking.

## Create Test File

A guided command that asks, in six short steps, for the SEC code (PPD, CCD, CTX, WEB or TEL), the direction (credits, debits or mixed; TEL is debits only), the number of entries (1 to 100,000), the number of batches (1 to 50), the amount range per entry and the effective entry date (default: the next weekday), and then whether the entries carry addenda records. The result opens as a new, unsaved file.

What the file contains:

* A file header for the destination "LAKESIDE TEST BANK" (routing number 581234560) from the company "HARBOR LANE CO" (company identification 1520749386), and batches with the originating bank 590123400. All names and numbers are invented. The routing numbers of the file and of the receivers start with 5, a range that is not assigned to banks, so they never point to a real institution, and every one has a correct check digit. Replace them with the test numbers of your bank where its test system needs real ones.
* Service class 220, 225 or 200 to match the direction; transaction codes 22 and 27 (checking) and some 32 and 37 (savings).
* Invented receiver names and identification numbers, account numbers of 6 to 12 digits, and amounts drawn from your range.
* Trace numbers made of the originating bank identification and a sequence number from 0000001, ascending through the file.
* For PPD, CCD and WEB with addenda: one addenda record of type 05 per entry. CTX entries always carry type 05 remittance addenda (one, or one to three with addenda chosen) and the matching count in the entry. WEB debits carry the payment type code R or S.
* Batch controls, the file control and the filler records computed from the entries.

The number of entries times the largest amount must fit into a control total (9,999,999,999.99); the command says so when it does not. With an effective date that is a weekday within 60 days from today, a test file passes the checks of ACH Atlas without a problem; the test suite builds and checks files of every SEC code with many seeds.

## Anonymise File and Anonymise Folder

A copy of an ACH file in which the values that identify people, companies, accounts and banks are replaced, so that the file can be attached to a ticket, given to a vendor or loaded into a test system.

Replaced:

| Record | Fields |
| --- | --- |
| File header | immediate destination and origin (routing numbers, or company identification), destination and origin names, reference code |
| Batch header | company name, company discretionary data, company identification, originating DFI identification; for IAT the foreign exchange reference and the originator identification |
| Entry | receiving DFI identification and check digit, account number, identification number, receiver name or receiving company name, the bank part of the trace number; for IAT the foreign receiver's account number |
| Addenda 05 | payment related information |
| Addenda 98 and 99 | the bank part of the original trace number, the original receiving DFI identification, corrected data, addenda information, the date of death (moved to another valid date), the bank part of the trace number |
| Other addenda, IAT addenda | the content |
| Batch control | company identification, originating DFI identification; the entry hash (and the totals when amounts are replaced) adjusted |
| File control | the entry hash (and the totals when amounts are replaced) adjusted |

Kept: record types, transaction codes, amounts (unless you choose to replace them), dates, SEC codes, service class codes, entry descriptions, discretionary data, addenda indicators and sequence numbers, the sequence part of trace numbers, filler.

How values are replaced:

* **One mapping per run.** The same value gets the same replacement everywhere in the file, and in every file of an Anonymise Folder run. A routing number that appears in the file header, a batch header, the trace numbers and a return addenda becomes the same new number in all of them, and a company identification in the file header, the batch header and the batch control stays one value.
* **Routing numbers** become invented numbers starting with 5 with a correct check digit. A check digit that was wrong in the original stays wrong in the copy, so the copy shows the same problem. A routing field that is not eight digits is replaced as well, keeping its shape (digits for digits, other characters as they are), so the problem stays visible and the value does not stay in clear.
* **Automated accounting advice batches (ADV)** have their own entry layout: account numbers, names and routing numbers are replaced at their positions; amounts and the totals of their batch control are never changed.
* **TRX and ATX entries** keep their count of addenda records; the receiving company name is replaced.
* **Names** become labels such as `PERSON 000001`, `COMPANY 0001` and `BANK 0001`.
* **Account numbers, identification numbers and free text** keep their shape: letters become other letters, digits other digits, while spaces and punctuation (for example the separators of remittance data in CTX addenda) stay. Account and identification numbers (and the other values that keep their shape, such as company identifications) are replaced by a keyed permutation of their letters and digits, so the same value always gets the same replacement within a run and two different values never get the same one. Free text is replaced by random characters.
* **Amounts** (only when you choose "Replace amounts as well"): every live entry gets another amount with the same number of digits; prenotifications and zero-dollar entries stay zero.
* **Totals.** Each record keeps its length, and the entry hash and totals of the controls are changed by exactly the change of the entries. A correct file therefore stays correct, and a file with problems keeps the same problem codes. One exception: when the trace numbers of one batch start with different bank identifications, their order can change, so `ACH-TRACE-ORDER` may appear or disappear.

**The key.** Every run draws a new random 256-bit key and derives all replacements from it with HMAC-SHA256: the permutation of account and identification numbers, and the random stream that supplies new routing numbers, new amounts, shifted dates of death and replacement text. The key and the tables (routing numbers, name labels) exist only in memory while the command runs. They are never shown, written, logged or sent anywhere, and no command or setting lets you choose or export a key. Without the key a replacement cannot be computed back into the original value; two runs on the same file give two different copies. Anonymise Folder uses one key for all files of the folder, which is what keeps a value the same in every copy.

What a copy still shows: which values were equal (the same account in two entries has the same replacement in both), everything listed under "Kept" above, and the number of records, entries and batches. Anyone who holds the key could compute the replacements again, which is why it is never stored; the unit tests of the extension reproduce runs with a fixed seed, and no command offers one.

A file with half a million entries (about 45 MB) takes roughly 20 seconds on a current computer; a progress notice is shown.

**Anonymise File** opens the copy as a new, unsaved file. When nothing was found to replace, no copy is made and a warning says so.

**Anonymise Folder** reads the files of a folder that match `achAtlas.reconcile.include` (at most `achAtlas.reconcile.maxFiles`), asks for confirmation and writes the copies, with the same relative paths, into a new folder named `<folder>-anonymised` next to it. Files that do not start with an ACH file header are skipped. Files in which nothing was found to replace are **not** written and are listed as unchanged; the final message is then a warning. A report lists every file with what was replaced.

Whether a copy is anonymous in a legal sense depends on what else it contains and on who receives it; check the copy before you share it.

## Recompute Control Records And Padding

Rewrites every batch control and the file control from the entries, adds a missing batch control or file control, pads records whose trailing spaces were removed back to 94 characters, removes empty lines, and sets the filler records so that the record count is a multiple of ten.

Changed in each batch control: service class code, company identification, originating DFI identification and batch number (taken from the batch header), entry/addenda count, entry hash and totals (computed). The message authentication code and the reserved field are kept. Changed in the file control: batch count, block count, entry/addenda count, entry hash, totals; the reserved field becomes blank.

Not changed: the file header, batch headers, entries and addenda. A wrong check digit, a wrong transaction code or a wrong amount is a decision for a person, so those problems stay.

The command first shows the current file and the recomputed one side by side, then asks whether to apply the listed changes. The change goes into the editor (Undo reverts it); save the file to keep it. Files with records longer than 94 characters, unknown record types, records out of order or automated accounting advice batches are refused with the reason, and nothing is changed.

## Compare With Another File

Compares the active file (the second, newer file) with another ACH file (the first, older file).

* Batches are matched by batch number when company identification, SEC code, service class and entry description agree, otherwise by those four values in file order.
* Entries are matched by trace number. With **Ignore trace numbers and batch numbers** they are matched by transaction code, routing number, account number and identification number instead, and trace numbers, batch numbers and the entry detail sequence numbers of addenda are not compared.
* **Ignore dates** leaves out the file creation date and time, the file ID modifier, and the effective, descriptive and settlement dates.

The whole file is compared, not only its entries. Compared are:

* the file header, the batch headers, the batch controls (counts, entry hash, totals), the file control and the number of filler records;
* records out of place (after the file control, a second file header, entries outside a batch) and any other record that belongs to no batch (unknown record types, addenda without an entry);
* the order of the batches and the order of the entries inside a batch;
* the byte order mark: present or not. The editor hides it from the text of a document; Compare reads it from the file and compares it;
* empty lines: their number and their position between the records, at the start and at the end of the file;
* the exact text of every record, character by character, including its length: records whose trailing spaces were removed ("record 3: 77 characters in the first file, 94 in the second (trailing spaces)"), characters after position 94, and records that stand at another position. The fields that the two options leave out are blanked first (dates; trace numbers, batch numbers and the entry detail sequence numbers of addenda). This record-by-record comparison runs only when everything above is the same, so that one changed record is not also listed a second time as a line of text; the byte order mark and the empty lines are always compared.

Not compared: the style of the line breaks (LF, CR LF, CR, or a file written as one line of 94-character records) and whether the last record is followed by a line break. The message and the report say "No differences" only when none of the compared items differs.

The report (Markdown, opened as a new file) shows records, batches, entries, addenda, debits and credits of both files with their differences, the changed fields of the file header, of each batch header and each batch control and of the file control, and every added, removed or changed entry with its trace number, name, amount and the changed fields. **Open CSV** writes every difference as one row.

## Export Entries As CSV and Export Entries As JSON

One row (CSV) or object (JSON) per entry, with its batch number, company name and identification, SEC code, effective date, transaction code, direction, kind (live, prenote, zero, return), account type, routing number, account number, amount, identification, name, discretionary data, addenda count, addenda text and trace number. The file is written where you choose.

* Amounts are written as decimal text (`1842.50`) and as cents (`184250`), never as floating-point numbers.
* CSV follows RFC 4180: cells with commas, quotes or line breaks are quoted and quotes are doubled. A value that a spreadsheet would run as a formula (starting with `=`, `+`, `-`, `@`, a tab or a carriage return) gets a leading apostrophe, unless you turn the setting `achAtlas.export.neutraliseFormulas` off (it is on by default; turn it off only when a program that reads the CSV needs the exact values).
* JSON adds the file header fields, a list of batches (also those without entries) and the totals.

## Create Reconciliation Report For A Folder

Reads every file of a folder that matches `achAtlas.reconcile.include` and starts with an ACH file header, and writes a report as one HTML page (no scripts; every value escaped) and/or CSV:

* totals of all files: batches, entries, debits, credits, credits minus debits;
* totals by effective date and by SEC code;
* one row per file (creation date, destination, batches, entries, totals, errors and warnings found by the checks) and per batch (number, SEC code, company, effective date, entries, totals, prenotes, returns, changes);
* anomalies: files with errors (with the first error), trace numbers used in more than one file, batches with the same company, SEC code, effective date, description, entry count and totals in two files (possible duplicate), batches that hold returns (addenda 99) or notifications of change (addenda 98);
* skipped files.

The totals are computed from the entries of each file, not taken from its control records.

## Split Into One File Per Batch

Writes one complete file per batch into a folder you choose: the file header of the source, the batch with its original batch number, a batch control and a file control computed from the entries, and the filler. File names are `<source>-batch-<batch number>.ach`. Existing files are named in the confirmation before they are replaced. Every file gets its own file ID modifier (the source file's own for the first, then the unused ones of A to Z and 0 to 9), because banks commonly take a second file with the same destination, date and file ID modifier for a duplicate; the creation date and time are those of the source file, so check them before you send the files. At most 36 files can be written this way. Files with records out of order or records that are not 94 characters long, and files with automated accounting advice batches, are refused.

## Merge Files

Merges two or more files (in file name order) into one: the file header of the first file, all batches renumbered from 1, controls and filler computed. Files for different immediate destinations and files with automated accounting advice batches are refused. The result opens as a new, unsaved file; check its file creation date, time and file ID modifier before you send it. Trace numbers that appear in more than one of the files are counted in the message and marked by the checks in the new file.
