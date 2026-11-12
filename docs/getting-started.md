# Getting started

1. Install **ACH Atlas** from the Extensions view (publisher Small Steps Studio). It needs VS Code 1.82 or newer.
2. Open an ACH file. Files ending in `.ach` or `.nacha` open in the ACH language; a `.txt` or `.dat` file whose first record is an ACH file header is switched to it (setting `achAtlas.detectPlainText`). You can also pick **ACH** in the language selector at the bottom right. To try it without a file of your own, run **ACH Atlas: Open Sample File**.
3. Click the ACH Atlas icon in the activity bar for the **File Outline**: the file header, every batch with its entries and addenda, the controls and the filler.
4. Rest the pointer on a field: the hover names the field, its positions, the raw characters and their meaning.
5. Open the Problems view (Ctrl+Shift+M): every problem has a code that is explained in [problems.md](problems.md).
6. The status bar shows the field at the cursor and the totals of the file. **Go To Batch** and **Show File Totals** are in the editor's context menu under **ACH Atlas**.
7. **Help > Welcome > Get started with ACH Atlas** walks through these steps and the Pro tools.

## Good to know

* ACH files end their records in spaces. ACH Atlas turns off trimming of trailing white space and the final newline for the ACH language, and shows a ruler at column 94.
* Files up to `achAtlas.maxFileSizeMB` (20 MB) are checked automatically and get hovers and the outline. Larger files are checked with **ACH Atlas: Check Current File**; the editor itself hands extensions files up to 50 MB.
* The checks cover the file format and the totals inside the file. They do not replace the checks of your bank.

More: [Record layouts](record-layouts.md), [Pro tools](pro-tools.md), [Licence, trial and Pro](licence.md), [Troubleshooting](troubleshooting.md).
