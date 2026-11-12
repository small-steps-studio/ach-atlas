# Record layouts

Every record of an ACH file is 94 characters long. The tables list the fields ACH Atlas knows, with their positions (counted from 1) and lengths, as the hover shows them. Positions and lengths follow the published file layout; the notes are short explanations written for ACH Atlas. Where a field has different names in different SEC codes, the hover uses the name for the SEC code of the batch.

For international (IAT) addenda only the addenda type and the entry detail sequence number are shown as separate fields; their content (names, addresses, banks, amounts) is shown as one block. For addenda type 02 the terminal and transaction details are shown as one block as well.

## File header

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 1 for the file header. |
| 2-3 | 2 | Priority code | Always 01. |
| 4-13 | 10 | Immediate destination | The bank or processor that receives the file: usually a space followed by its nine-digit routing number. |
| 14-23 | 10 | Immediate origin | Identifies the sender of the file: a routing number or a company identification, as agreed with the bank. |
| 24-29 | 6 | File creation date | Date the file was created, YYMMDD. |
| 30-33 | 4 | File creation time | Time the file was created, HHMM (optional). |
| 34 | 1 | File ID modifier | A to Z or 0 to 9; tells apart files created on the same day for the same destination. |
| 35-37 | 3 | Record size | Always 094. |
| 38-39 | 2 | Blocking factor | Always 10: records are counted in blocks of ten. |
| 40 | 1 | Format code | Always 1. |
| 41-63 | 23 | Immediate destination name | Name of the receiving bank or processor. |
| 64-86 | 23 | Immediate origin name | Name of the sender. |
| 87-94 | 8 | Reference code | Optional, for the sender's own use. |

## Batch header

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 5 for a batch header. |
| 2-4 | 3 | Service class code | 200 mixed, 220 credits only, 225 debits only. |
| 5-20 | 16 | Company name | Name of the originator as the receivers know it. |
| 21-40 | 20 | Company discretionary data | Optional, for the originator's own use. |
| 41-50 | 10 | Company identification | Identifies the originator to the bank; often 1 followed by the tax number. |
| 51-53 | 3 | Standard Entry Class code | The kind of payment in this batch. |
| 54-63 | 10 | Company entry description | Purpose of the entries as shown to receivers, for example PAYROLL. |
| 64-69 | 6 | Company descriptive date | Optional date text shown to receivers. |
| 70-75 | 6 | Effective entry date | Date on which the originator wants the entries to settle, YYMMDD. |
| 76-78 | 3 | Settlement date | Filled in by the ACH operator (day of the year); blank in files sent to a bank. |
| 79 | 1 | Originator status code | Usually 1. |
| 80-87 | 8 | Originating DFI identification | First eight digits of the routing number of the originating bank (ODFI). |
| 88-94 | 7 | Batch number | Numbers the batches of the file in ascending order. |

## Batch header (IAT)

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 5 for a batch header. |
| 2-4 | 3 | Service class code | 200 mixed, 220 credits only, 225 debits only. |
| 5-20 | 16 | IAT indicator | Blank in most files. |
| 21-22 | 2 | Foreign exchange indicator | FV (fixed to variable), VF (variable to fixed) or FF (fixed to fixed). |
| 23 | 1 | Foreign exchange reference indicator | Says what the foreign exchange reference holds. |
| 24-38 | 15 | Foreign exchange reference | Exchange rate or reference number, or blank. |
| 39-40 | 2 | ISO destination country code | Two-letter country code of the receiver's country. |
| 41-50 | 10 | Originator identification | Identifies the originator to the bank. |
| 51-53 | 3 | Standard Entry Class code | IAT. |
| 54-63 | 10 | Company entry description | Purpose of the entries. |
| 64-66 | 3 | ISO originating currency code | Three-letter currency code of the origin. |
| 67-69 | 3 | ISO destination currency code | Three-letter currency code of the destination. |
| 70-75 | 6 | Effective entry date | Requested settlement date, YYMMDD. |
| 76-78 | 3 | Settlement date | Filled in by the ACH operator; blank in files sent to a bank. |
| 79 | 1 | Originator status code | Usually 1. |
| 80-87 | 8 | Gateway operator or ODFI identification | First eight digits of the routing number of the originating bank or gateway operator. |
| 88-94 | 7 | Batch number | Numbers the batches of the file in ascending order. |

## Entry detail (PPD)

Used in batches with the SEC code PPD.

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 6 for an entry detail record. |
| 2-3 | 2 | Transaction code | Account type and direction of the entry. |
| 4-11 | 8 | Receiving DFI identification | First eight digits of the routing number of the receiver's bank (RDFI). Added up for the entry hash. |
| 12 | 1 | Check digit | Ninth digit of the receiver's routing number. |
| 13-29 | 17 | DFI account number | Receiver's account number, left-aligned. |
| 30-39 | 10 | Amount | Amount in cents: the last two digits are the cents. |
| 40-54 | 15 | Individual identification number | Optional reference for the receiver, for example an employee number. |
| 55-76 | 22 | Individual name | Name of the receiver. |
| 77-78 | 2 | Discretionary data | Optional, for the originating bank's use. |
| 79 | 1 | Addenda record indicator | 1 when addenda records follow this entry, otherwise 0. |
| 80-94 | 15 | Trace number | Originating bank identification (8 digits) and a sequence number (7 digits); unique in the file. |

## Entry detail (CCD)

Used in batches with the SEC code CCD.

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 6 for an entry detail record. |
| 2-3 | 2 | Transaction code | Account type and direction of the entry. |
| 4-11 | 8 | Receiving DFI identification | First eight digits of the routing number of the receiver's bank (RDFI). Added up for the entry hash. |
| 12 | 1 | Check digit | Ninth digit of the receiver's routing number. |
| 13-29 | 17 | DFI account number | Receiver's account number, left-aligned. |
| 30-39 | 10 | Amount | Amount in cents: the last two digits are the cents. |
| 40-54 | 15 | Identification number | Optional reference, for example an invoice or customer number. |
| 55-76 | 22 | Receiving company name | Name of the receiving business. |
| 77-78 | 2 | Discretionary data | Optional, for the originating bank's use. |
| 79 | 1 | Addenda record indicator | 1 when addenda records follow this entry, otherwise 0. |
| 80-94 | 15 | Trace number | Originating bank identification (8 digits) and a sequence number (7 digits); unique in the file. |

## Entry detail (WEB)

Used in batches with the SEC code WEB.

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 6 for an entry detail record. |
| 2-3 | 2 | Transaction code | Account type and direction of the entry. |
| 4-11 | 8 | Receiving DFI identification | First eight digits of the routing number of the receiver's bank (RDFI). Added up for the entry hash. |
| 12 | 1 | Check digit | Ninth digit of the receiver's routing number. |
| 13-29 | 17 | DFI account number | Receiver's account number, left-aligned. |
| 30-39 | 10 | Amount | Amount in cents: the last two digits are the cents. |
| 40-54 | 15 | Individual identification number | Optional reference for the receiver. |
| 55-76 | 22 | Individual name | Name of the receiver. |
| 77-78 | 2 | Payment type code | For debits: R for a recurring payment, S for a single payment. |
| 79 | 1 | Addenda record indicator | 1 when addenda records follow this entry, otherwise 0. |
| 80-94 | 15 | Trace number | Originating bank identification (8 digits) and a sequence number (7 digits); unique in the file. |

## Entry detail (TEL)

Used in batches with the SEC code TEL.

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 6 for an entry detail record. |
| 2-3 | 2 | Transaction code | Account type and direction of the entry. |
| 4-11 | 8 | Receiving DFI identification | First eight digits of the routing number of the receiver's bank (RDFI). Added up for the entry hash. |
| 12 | 1 | Check digit | Ninth digit of the receiver's routing number. |
| 13-29 | 17 | DFI account number | Receiver's account number, left-aligned. |
| 30-39 | 10 | Amount | Amount in cents: the last two digits are the cents. |
| 40-54 | 15 | Individual identification number | Optional reference for the receiver. |
| 55-76 | 22 | Individual name | Name of the receiver. |
| 77-78 | 2 | Payment type code | R for a recurring payment, S for a single payment, or blank. |
| 79 | 1 | Addenda record indicator | 1 when addenda records follow this entry, otherwise 0. |
| 80-94 | 15 | Trace number | Originating bank identification (8 digits) and a sequence number (7 digits); unique in the file. |

## Entry detail (CIE, MTE)

Used in batches with the SEC codes CIE and MTE. The name of the individual is in the first reference field and the identification in the second.

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 6 for an entry detail record. |
| 2-3 | 2 | Transaction code | Account type and direction of the entry. |
| 4-11 | 8 | Receiving DFI identification | First eight digits of the routing number of the receiver's bank (RDFI). Added up for the entry hash. |
| 12 | 1 | Check digit | Ninth digit of the receiver's routing number. |
| 13-29 | 17 | DFI account number | Receiver's account number, left-aligned. |
| 30-39 | 10 | Amount | Amount in cents: the last two digits are the cents. |
| 40-54 | 15 | Individual name | Name of the individual who made the payment. |
| 55-76 | 22 | Individual identification number | Identification of the individual, as agreed with the bank. |
| 77-78 | 2 | Discretionary data | Optional, for the originating bank's use. |
| 79 | 1 | Addenda record indicator | 1 when addenda records follow this entry, otherwise 0. |
| 80-94 | 15 | Trace number | Originating bank identification (8 digits) and a sequence number (7 digits); unique in the file. |

## Entry detail (SHR)

Used in batches with the SEC code SHR.

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 6 for an entry detail record. |
| 2-3 | 2 | Transaction code | Account type and direction of the entry. |
| 4-11 | 8 | Receiving DFI identification | First eight digits of the routing number of the receiver's bank (RDFI). Added up for the entry hash. |
| 12 | 1 | Check digit | Ninth digit of the receiver's routing number. |
| 13-29 | 17 | DFI account number | Receiver's account number, left-aligned. |
| 30-39 | 10 | Amount | Amount in cents: the last two digits are the cents. |
| 40-54 | 15 | Card expiration date and document reference | Card expiration date (MMYY) followed by the document reference number. |
| 55-76 | 22 | Card account number | Number of the card account. |
| 77-78 | 2 | Card transaction type code | Says what kind of card transaction the entry is. |
| 79 | 1 | Addenda record indicator | 1 when addenda records follow this entry, otherwise 0. |
| 80-94 | 15 | Trace number | Originating bank identification (8 digits) and a sequence number (7 digits); unique in the file. |

## Entry detail (ACK)

Used in batches with the SEC code ACK.

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 6 for an entry detail record. |
| 2-3 | 2 | Transaction code | Account type and direction of the entry. |
| 4-11 | 8 | Receiving DFI identification | First eight digits of the routing number of the receiver's bank (RDFI). Added up for the entry hash. |
| 12 | 1 | Check digit | Ninth digit of the receiver's routing number. |
| 13-29 | 17 | DFI account number | Receiver's account number, left-aligned. |
| 30-39 | 10 | Amount | Amount in cents: the last two digits are the cents. |
| 40-54 | 15 | Original entry trace number | Trace number of the corporate credit that is acknowledged. |
| 55-76 | 22 | Receiving company name | Name of the receiving business. |
| 77-78 | 2 | Discretionary data | Optional, for the originating bank's use. |
| 79 | 1 | Addenda record indicator | 1 when addenda records follow this entry, otherwise 0. |
| 80-94 | 15 | Trace number | Originating bank identification (8 digits) and a sequence number (7 digits); unique in the file. |

## Entry detail (other SEC codes)

Used in batches with an SEC code that has no section of its own: ADV, ARC, BOC, COR, DNE, ENR, POP, POS, RCK, TRC and XCK. The meaning of the two reference fields depends on the SEC code. Automated accounting advice entries (ADV) have a layout of their own, which ACH Atlas does not read field by field; the hover shows this layout for them.

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 6 for an entry detail record. |
| 2-3 | 2 | Transaction code | Account type and direction of the entry. |
| 4-11 | 8 | Receiving DFI identification | First eight digits of the routing number of the receiver's bank (RDFI). Added up for the entry hash. |
| 12 | 1 | Check digit | Ninth digit of the receiver's routing number. |
| 13-29 | 17 | DFI account number | Receiver's account number, left-aligned. |
| 30-39 | 10 | Amount | Amount in cents: the last two digits are the cents. |
| 40-54 | 15 | Identification number | Reference whose meaning depends on the SEC code of the batch. |
| 55-76 | 22 | Receiver name | Name of the receiver. |
| 77-78 | 2 | Discretionary data | Optional, meaning depends on the SEC code of the batch. |
| 79 | 1 | Addenda record indicator | 1 when addenda records follow this entry, otherwise 0. |
| 80-94 | 15 | Trace number | Originating bank identification (8 digits) and a sequence number (7 digits); unique in the file. |

## Entry detail (CTX)

Used in batches with the SEC code CTX.

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 6 for an entry detail record. |
| 2-3 | 2 | Transaction code | Account type and direction of the entry. |
| 4-11 | 8 | Receiving DFI identification | First eight digits of the routing number of the receiver's bank (RDFI). Added up for the entry hash. |
| 12 | 1 | Check digit | Ninth digit of the receiver's routing number. |
| 13-29 | 17 | DFI account number | Receiver's account number, left-aligned. |
| 30-39 | 10 | Amount | Amount in cents: the last two digits are the cents. |
| 40-54 | 15 | Identification number | Optional reference, for example an invoice number. |
| 55-58 | 4 | Number of addenda records | How many addenda records follow this entry. |
| 59-74 | 16 | Receiving company name or ID number | Name or identification of the receiving business. |
| 75-76 | 2 | Reserved | Blank. |
| 77-78 | 2 | Discretionary data | Optional, for the originating bank's use. |
| 79 | 1 | Addenda record indicator | 1 when addenda records follow this entry, otherwise 0. |
| 80-94 | 15 | Trace number | Originating bank identification (8 digits) and a sequence number (7 digits); unique in the file. |

## Entry detail (TRX)

Used in batches with the SEC code TRX. The positions are those of CTX.

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 6 for an entry detail record. |
| 2-3 | 2 | Transaction code | Account type and direction of the entry. |
| 4-11 | 8 | Receiving DFI identification | First eight digits of the routing number of the receiver's bank (RDFI). Added up for the entry hash. |
| 12 | 1 | Check digit | Ninth digit of the receiver's routing number. |
| 13-29 | 17 | DFI account number | Receiver's account number, left-aligned. |
| 30-39 | 10 | Amount | Amount in cents: the last two digits are the cents. |
| 40-54 | 15 | Identification number | Optional reference, for example a check or item reference. |
| 55-58 | 4 | Number of addenda records | How many addenda records follow this entry. |
| 59-74 | 16 | Receiving company name or ID number | Name or identification of the receiving business. |
| 75-76 | 2 | Item type indicator | Says what kind of item the entry belongs to. |
| 77-78 | 2 | Discretionary data | Optional, for the originating bank's use. |
| 79 | 1 | Addenda record indicator | 1 when addenda records follow this entry, otherwise 0. |
| 80-94 | 15 | Trace number | Originating bank identification (8 digits) and a sequence number (7 digits); unique in the file. |

## Entry detail (ATX)

Used in batches with the SEC code ATX. The positions are those of CTX.

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 6 for an entry detail record. |
| 2-3 | 2 | Transaction code | Account type and direction of the entry. |
| 4-11 | 8 | Receiving DFI identification | First eight digits of the routing number of the receiver's bank (RDFI). Added up for the entry hash. |
| 12 | 1 | Check digit | Ninth digit of the receiver's routing number. |
| 13-29 | 17 | DFI account number | Receiver's account number, left-aligned. |
| 30-39 | 10 | Amount | Amount in cents: the last two digits are the cents. |
| 40-54 | 15 | Original entry trace number | Trace number of the corporate trade exchange credit that is acknowledged. |
| 55-58 | 4 | Number of addenda records | How many addenda records follow this entry. |
| 59-74 | 16 | Receiving company name or ID number | Name or identification of the receiving business. |
| 75-76 | 2 | Reserved | Blank. |
| 77-78 | 2 | Discretionary data | Optional, for the originating bank's use. |
| 79 | 1 | Addenda record indicator | 1 when addenda records follow this entry, otherwise 0. |
| 80-94 | 15 | Trace number | Originating bank identification (8 digits) and a sequence number (7 digits); unique in the file. |

## Entry detail (IAT)

Used in batches with the SEC code IAT.

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 6 for an entry detail record. |
| 2-3 | 2 | Transaction code | Account type and direction of the entry. |
| 4-11 | 8 | Gateway operator or RDFI identification | First eight digits of the routing number of the receiving bank or gateway operator. Added up for the entry hash. |
| 12 | 1 | Check digit | Ninth digit of that routing number. |
| 13-16 | 4 | Number of addenda records | How many addenda records follow this entry. |
| 17-29 | 13 | Reserved | Blank. |
| 30-39 | 10 | Amount | Amount in cents: the last two digits are the cents. |
| 40-74 | 35 | Foreign receiver's account number | Account number of the receiver, left-aligned. |
| 75-76 | 2 | Reserved | Blank. |
| 77 | 1 | Gateway operator screening indicator | Set by the gateway operator. |
| 78 | 1 | Secondary screening indicator | Set by the receiving bank or gateway. |
| 79 | 1 | Addenda record indicator | Always 1: international entries carry addenda. |
| 80-94 | 15 | Trace number | Originating bank identification (8 digits) and a sequence number (7 digits); unique in the file. |

## Addenda (payment related information)

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 7 for an addenda record. |
| 2-3 | 2 | Addenda type code | 05: payment related information. |
| 4-83 | 80 | Payment related information | Free text or, for CTX, a remittance message split over the addenda records. |
| 84-87 | 4 | Addenda sequence number | Numbers the addenda of one entry from 0001. |
| 88-94 | 7 | Entry detail sequence number | The last seven digits of the trace number of the entry this addenda belongs to. |

## Addenda (terminal details)

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 7 for an addenda record. |
| 2-3 | 2 | Addenda type code | 02: terminal and transaction details. |
| 4-79 | 76 | Terminal and transaction details | Reference, terminal, date and location details of a card or terminal transaction. |
| 80-94 | 15 | Trace number | Trace number of the entry this addenda belongs to. |

## Addenda (notification of change)

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 7 for an addenda record. |
| 2-3 | 2 | Addenda type code | 98: notification of change. |
| 4-6 | 3 | Change code | What the originator should correct. |
| 7-21 | 15 | Original entry trace number | Trace number of the entry that needs the change. |
| 22-27 | 6 | Reserved | Blank. |
| 28-35 | 8 | Original receiving DFI identification | Receiving bank identification of the original entry. |
| 36-64 | 29 | Corrected data | The corrected value, for example an account number. |
| 65-79 | 15 | Reserved | Blank. |
| 80-94 | 15 | Trace number | Trace number of this notification. |

## Addenda (return)

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 7 for an addenda record. |
| 2-3 | 2 | Addenda type code | 99: return. |
| 4-6 | 3 | Return reason code | Why the entry was returned. |
| 7-21 | 15 | Original entry trace number | Trace number of the returned entry. |
| 22-27 | 6 | Date of death | Only for returns because of a death, YYMMDD; otherwise blank. |
| 28-35 | 8 | Original receiving DFI identification | Receiving bank identification of the original entry. |
| 36-79 | 44 | Addenda information | Optional text from the returning bank. |
| 80-94 | 15 | Trace number | Trace number of this return. |

## Addenda (international)

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 7 for an addenda record. |
| 2-3 | 2 | Addenda type code | 10 to 16 are required for every international entry, in this order; 17 and 18 are optional. |
| 4-87 | 84 | Addenda content | Names, addresses, banks, amounts or remittance data, depending on the addenda type. |
| 88-94 | 7 | Entry detail sequence number | The last seven digits of the trace number of the entry this addenda belongs to. |

## Addenda

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 7 for an addenda record. |
| 2-3 | 2 | Addenda type code | Says what the addenda carries. |
| 4-94 | 91 | Addenda content | Content depends on the addenda type. |

## Batch control

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 8 for a batch control record. |
| 2-4 | 3 | Service class code | Same as in the batch header. |
| 5-10 | 6 | Entry/addenda count | Number of entry detail and addenda records in the batch. |
| 11-20 | 10 | Entry hash | Sum of the receiving bank identifications (8 digits) of all entries; only the rightmost ten digits are kept. |
| 21-32 | 12 | Total debit entry dollar amount | Sum of the debit entries, in cents. |
| 33-44 | 12 | Total credit entry dollar amount | Sum of the credit entries, in cents. |
| 45-54 | 10 | Company identification | Same as in the batch header. |
| 55-73 | 19 | Message authentication code | Usually blank. |
| 74-79 | 6 | Reserved | Blank. |
| 80-87 | 8 | Originating DFI identification | Same as in the batch header. |
| 88-94 | 7 | Batch number | Same as in the batch header. |

## File control

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1 | 1 | Record type code | Always 9 for the file control record. |
| 2-7 | 6 | Batch count | Number of batches in the file. |
| 8-13 | 6 | Block count | Number of blocks of ten records, counting every record up to and including this one. |
| 14-21 | 8 | Entry/addenda count | Number of entry detail and addenda records in the file. |
| 22-31 | 10 | Entry hash | Sum of the receiving bank identifications of all entries in the file; rightmost ten digits. |
| 32-43 | 12 | Total debit entry dollar amount in file | Sum of all debit entries, in cents. |
| 44-55 | 12 | Total credit entry dollar amount in file | Sum of all credit entries, in cents. |
| 56-94 | 39 | Reserved | Blank. |

## Filler

| Positions | Length | Field | Notes |
| --- | ---: | --- | --- |
| 1-94 | 94 | Filler | Records of nine digits 9 that fill the last block to a multiple of ten records. |
