## Open a sample file

The sample is a small ACH file with invented data: one file header, a payroll batch with three credits (one with an addenda record), an invoice batch with two debits, the controls and the filler records that complete the block of ten.

Every record is 94 characters long and starts with its record type:

| Type | Record |
| --- | --- |
| 1 | File header |
| 5 | Batch header |
| 6 | Entry detail |
| 7 | Addenda |
| 8 | Batch control |
| 9 | File control (and filler records of nines) |

Files with the extension `.ach` or `.nacha` open in the ACH language. A `.txt` or `.dat` file whose first record is an ACH file header is switched to it as well.
