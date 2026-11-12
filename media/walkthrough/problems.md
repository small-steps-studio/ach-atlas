## Problems with codes

ACH Atlas checks the file while you type and lists every problem in the Problems view with a stable code, for example:

* `ACH-RECORD-LENGTH`: a record without its trailing spaces,
* `ACH-RDFI-CHECK-DIGIT`: a routing number whose check digit does not fit,
* `ACH-EFFECTIVE-DATE`: a date that does not exist,
* `ACH-BATCH-HASH`: an entry hash that differs from the sum of the routing numbers.

Every code is explained in the documentation. The checks cover the file format and the totals inside the file; your bank applies its own rules as well.
