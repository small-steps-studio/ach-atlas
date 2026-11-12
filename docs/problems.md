# Problems and codes

ACH Atlas reports every problem with a stable code, a severity and a message that names the value it found and the value it expected. The codes below do not change between versions; new checks get new codes.

These are checks of the file format and of the totals inside the file. They do not tell you whether a bank will accept a file: banks and payment processors apply further rules of their own (cut-off times, limits, allowed SEC codes, account checks), and you stay responsible for what you send.

Severity: **error** means the file breaks the record layout or its totals do not add up; **warning** means the file is readable but something is unusual and worth checking; **note** is information.

Settings that change which problems appear: `achAtlas.checks.effectiveDate` (the three effective-date warnings and the note), `achAtlas.checks.blocking` (`ACH-BLOCKING`), `achAtlas.maxProblems` (the length of the list).

## The file as a whole

### ACH-EMPTY-FILE
Error. The file holds no records at all.

### ACH-BOM
Warning. The file starts with a byte order mark (an invisible character some editors add to UTF-8 files). Bank systems usually expect plain ASCII text; save the file without it. The editor hides the mark: it shows it as the encoding "UTF-8 with BOM" in the status bar and does not put it into the text. ACH Atlas reads the file itself when it is opened or saved and reports the mark at the start of the file; to remove it, choose "Save with Encoding" and then "UTF-8".

### ACH-UNWRAPPED
Note. The file has no line breaks. It is read as consecutive records of 94 characters, which is how some systems write it. All other checks work as usual.

### ACH-BLANK-LINE
Warning. An empty line between records. ACH files contain no empty lines; remove it.

### ACH-CHARACTERS
Error. The record holds a character outside printable ASCII (space to tilde), for example a tab, a control character or a letter with an accent. The message names the character and its position.

### ACH-RECORD-LENGTH
Error. The record is not 94 characters long. A record that is too short often lost its trailing spaces in an editor or a file transfer; **Recompute Control Records And Padding** (Pro) pads such records again. Fields beyond the end of a short record are read as blank.

### ACH-RECORD-TYPE
Error. The record starts with a character other than 1, 5, 6, 7, 8 or 9.

### ACH-RECORD-ORDER
Error. A record is not where the layout puts it: a file header that is not first, a second file header, an entry or addenda outside a batch, an addenda without an entry before it, a batch control without a batch header, or a filler record before the file control.

### ACH-FILE-HEADER-MISSING
Error. The first record is not a file header (record type 1).

### ACH-FILE-CONTROL-MISSING
Error. There is no file control record (record type 9) after the last batch.

### ACH-BATCH-CONTROL-MISSING
Error. A batch has no batch control record (type 8) before the next batch header or the file control.

### ACH-AFTER-FILE-CONTROL
Error. A record after the file control is not a filler record of 94 nines.

### ACH-BLOCKING
Warning. The number of records, counting the filler, is not a multiple of ten, or there are ten or more filler records. Records are counted in blocks of ten and the last block is filled with records of 94 nines. Many banks accept files without filler; turn the check off with `achAtlas.checks.blocking` if yours does.

### ACH-TOO-MANY-PROBLEMS
Note. Only the first `achAtlas.maxProblems` problems are listed; the message says how many more were found.

## Fields

### ACH-FIELD-NUMERIC
Error. A field that holds only digits (routing identifications, counts, the entry hash, totals, trace numbers, batch numbers) contains something else.

### ACH-CONSTANT-FIELD
Error. A field of the file header with a fixed value has another one: the priority code is 01, the record size 094, the blocking factor 10 and the format code 1.

### ACH-RESERVED
Warning. A reserved field is not blank: positions 74 to 79 of the batch control or 56 to 94 of the file control.

## File header

### ACH-DESTINATION
Error. The immediate destination is blank, or it is a routing number whose check digit is wrong. The message gives the correct check digit.

### ACH-DESTINATION-FORM
Warning. The immediate destination is not a space followed by a nine-digit routing number. Some banks ask for another form; check what yours expects.

### ACH-ORIGIN
Error. The immediate origin is blank.

### ACH-DATE
Error. The file creation date is not a valid date (YYMMDD).

### ACH-TIME
Warning. The file creation time is not blank and not a valid time (HHMM).

### ACH-FILE-ID-MODIFIER
Error. The file ID modifier is not an upper-case letter or a digit.

## Batch header and batch control

### ACH-SERVICE-CLASS
Error. The service class code is not 200 (mixed debits and credits), 220 (credits only), 225 (debits only) or 280 (automated accounting advices).

### ACH-SERVICE-CLASS-MISMATCH
Error. The batch control has another service class code than its batch header.

### ACH-SERVICE-CLASS-ENTRY
Error. A debit entry in a batch with service class 220, or a credit entry in a batch with service class 225.

### ACH-SEC-CODE
Error. The Standard Entry Class code is not one of the published codes.

### ACH-SEC-NOT-CHECKED
Note. PPD, CCD, CTX, WEB and TEL batches are checked in detail and IAT batches in their basic fields. Batches with another SEC code are read, counted and totalled, but the fields specific to that code are not checked. Automated accounting advice batches (ADV, service class 280) use their own entry layout; they are listed, and their entries and totals are not checked.

### ACH-SEC-DIRECTION
Error. A credit entry in a TEL batch. TEL entries are debits.

### ACH-COMPANY-NAME
Error. The company name of the batch header is blank.

### ACH-COMPANY-ID
Error. The company identification (or, for IAT, the originator identification) is blank.

### ACH-COMPANY-ID-MISMATCH
Error. The company identification of the batch control differs from the batch header.

### ACH-ENTRY-DESCRIPTION
Error. The company entry description is blank.

### ACH-EFFECTIVE-DATE
Error. The effective entry date is not a valid date (YYMMDD).

### ACH-EFFECTIVE-DATE-PAST
Warning. The effective entry date is earlier than the file creation date.

### ACH-EFFECTIVE-DATE-FAR
Warning. The effective entry date is more than 60 days after the file creation date.

### ACH-EFFECTIVE-DATE-WEEKEND
Note. The effective entry date is a Saturday or a Sunday. Entries settle on business days; check the date with your bank. Bank holidays are not known to ACH Atlas.

### ACH-ORIGINATOR-STATUS
Error. The originator status code is not 0, 1 or 2.

### ACH-ODFI-MISMATCH
Error. The originating DFI identification of the batch control differs from the batch header.

### ACH-BATCH-NUMBER-MISMATCH
Error. The batch number of the batch control differs from the batch header.

### ACH-BATCH-NUMBER-ORDER
Warning. The batch numbers do not ascend through the file.

### ACH-BATCH-NUMBER-DUPLICATE
Error. Two batches of the file have the same batch number.

### ACH-IAT-FIELD
Error. A field of an IAT batch header has the wrong form: the foreign exchange indicator (FV, VF or FF), the destination country code (two letters) or a currency code (three letters).

### ACH-EMPTY-BATCH
Warning. A batch has no entry detail records.

## Entries and addenda

### ACH-TRANSACTION-CODE
Error. The transaction code is not one of the codes for checking (2x), savings (3x), general ledger (4x) or loan (5x) accounts.

### ACH-RDFI-CHECK-DIGIT
Error. The check digit in position 12 does not fit the receiving DFI identification in positions 4 to 11. The check digit is computed with the weights 3, 7, 1, 3, 7, 1, 3, 7; the message gives the correct digit.

### ACH-ACCOUNT
Error. The account number is blank.

### ACH-AMOUNT
Error. The amount is not ten digits. Amounts are written in cents without a decimal point: 0000184250 is 1,842.50.

### ACH-AMOUNT-PRENOTE
Error. A prenotification code (x3, x8) or a zero-dollar code (x4, x9) carries an amount other than zero.

### ACH-AMOUNT-ZERO
Warning. A live entry (x2, x7, or 55 for loans) has the amount zero. For a test entry without money use the prenotification code.

### ACH-NAME
Warning. The receiver name (or, for CTX, the receiving company name or ID number) is blank.

### ACH-WEB-PAYMENT-TYPE
Warning. A WEB debit has no payment type code R (recurring) or S (single) in positions 77 and 78.

### ACH-ADDENDA-INDICATOR
Error. The addenda record indicator is not 0 or 1, is 1 without an addenda record following, or is 0 with addenda records following. International (IAT) entries always carry addenda, so their indicator is 1.

### ACH-ADDENDA-TYPE
Error. The addenda type code is not two digits, or it is not used with the SEC code of the batch (05 for PPD, CCD, CTX and WEB; none for TEL; 10 to 18 for IAT; 02 for POS, SHR and MTE). Returns (99) and notifications of change (98) are accepted in any batch.

### ACH-ADDENDA-COUNT
Error. An entry has more addenda records than its SEC code allows (one for PPD, CCD and WEB, none for TEL), more than one return or change addenda, or (CTX and IAT) a number of addenda records that differs from the count in the entry.

### ACH-ADDENDA-SEQUENCE
Error. In an addenda record of type 05 the addenda sequence number does not count from 0001, or the entry detail sequence number (positions 88 to 94; also checked for IAT addenda) does not repeat the last seven digits of the entry's trace number.

### ACH-IAT-ADDENDA-ORDER
Error. An international entry does not carry the addenda types 10, 11, 12, 13, 14, 15 and 16 in this order, followed only by optional 17 and 18 records.

### ACH-TRACE-ODFI
Warning. The trace number does not start with the originating DFI identification of the batch. Not checked for entries that carry a return or change addenda.

### ACH-TRACE-ORDER
Warning. The trace numbers of a batch do not ascend. Not checked for entries that carry a return or change addenda.

### ACH-TRACE-DUPLICATE
Error. Two entries of the file have the same trace number.

## Totals

All totals are computed from the entries with exact integer arithmetic; no floating-point numbers are involved. A total is not compared while an amount or a routing identification it depends on is not all digits (that field has its own problem).

### ACH-BATCH-COUNT
Error. The entry/addenda count of the batch control differs from the number of entry and addenda records in the batch.

### ACH-BATCH-HASH
Error. The entry hash of the batch control differs from the sum of the receiving DFI identifications (positions 4 to 11) of the batch's entries, of which the rightmost ten digits are kept.

### ACH-BATCH-DEBITS
Error. The total debit amount of the batch control differs from the sum of the debit entries.

### ACH-BATCH-CREDITS
Error. The total credit amount of the batch control differs from the sum of the credit entries.

### ACH-FILE-BATCH-COUNT
Error. The batch count of the file control differs from the number of batches.

### ACH-FILE-BLOCK-COUNT
Error. The block count of the file control differs from the number of blocks of ten records, counting every record up to and including the file control.

### ACH-FILE-ENTRY-COUNT
Error. The entry/addenda count of the file control differs from the number of entry and addenda records in the file.

### ACH-FILE-HASH
Error. The entry hash of the file control differs from the sum of the receiving DFI identifications of all entries (rightmost ten digits).

### ACH-FILE-DEBITS
Error. The total debit amount of the file control differs from the sum of all debit entries.

### ACH-FILE-CREDITS
Error. The total credit amount of the file control differs from the sum of all credit entries.
