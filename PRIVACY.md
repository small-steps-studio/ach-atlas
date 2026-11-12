# Privacy

Last updated: 2026-11-12 (ACH Atlas 0.1.0)

ACH Atlas works on your computer. This page states exactly what the extension stores and what it sends over the network, which is very little.

## What stays on your computer

* The contents and names of your files. Reading, checking, totals, test files, anonymised copies, comparisons, exports, reports, split and merge are performed locally and nothing about them is sent anywhere.
* The random key and the replacement tables of Anonymise File and Anonymise Folder. They exist only in memory while the command runs and are never written to disk, logged or sent anywhere.
* The free 14-day trial of the Pro features. Its start time, the time it was last used and the time of the last reminder are kept in the editor's extension storage on this computer. Nothing about the trial is sent anywhere, not even to the payment provider, and it needs no account.
* There is **no telemetry**, no usage statistics, no crash reporting and no advertising.

## The one network request: the licence check (Pro only)

The optional Pro tier is unlocked with a licence key. After you enter a key (**ACH Atlas: Enter Licence Key**), the extension talks to the licence service of the payment provider, Dodo Payments, at `live.dodopayments.com`. It uses only the provider's public licence endpoints, to activate, validate and deactivate a key. No setting or command sends these requests to another host.

Each request contains:

* the **licence key**, and
* for activation, the text **`VS Code on <platform>`**, for example `VS Code on Windows`, `VS Code on macOS` or `VS Code on Linux`. This label lets you tell your activations apart. It never contains your computer's name, your user name, your files or anything else about you or your machine.
* for validation and deactivation, the activation id that the service returned when you activated the key.

As with any internet request, the service sees your IP address.

Who receives it, where it goes and how long it is kept:

* The recipient is Dodo Payments, the payment provider and merchant of record that sells the licence key. The data is sent to its servers at `live.dodopayments.com` and to nobody else. The author of the extension does not run a server and receives none of it. In a remote window (SSH, a container or WSL) the extension runs on the remote machine, so the request leaves from that machine.
* The provider may process data in several countries. How long it keeps data, and under which legal basis, is set out in its own privacy policy: <https://dodopayments.com/legal/privacy-policy>.
* The answer to an activation names the product the key belongs to (the extension keeps that product id to know which licence it is) and contains customer details of the purchase; the extension never stores or shows those customer details.
* The data is **not anonymous**. A licence key belongs to a purchase and therefore to the buyer's record at the payment provider. The platform label contains no personal data.
* No data from this request is used for advertising, analytics or profiling by the extension.

When it happens:

* **Never without a key.** If you have not entered a licence key, the extension makes no network request. The free features and the trial work entirely offline.
* On activation (when you enter the key). When the same key is entered again on the same computer, the stored activation is validated instead of making a new one; when another key replaces it, the old activation is deactivated after the new key is stored.
* On validation: a successful validation is remembered for 24 hours; the extension asks again at the next Pro feature use after that. If the service cannot be reached, the last successful validation keeps Pro working for 14 days.
* On deactivation (**ACH Atlas: Remove Licence From This Machine**), and when a key of another product is entered (the activation made for the check is released again).
* **Show Licence Status** asks the service right away when a key is stored.
* **Report A Problem** does not ask the service; it reads the stored licence state only.

## What is stored locally

* The licence key, in VS Code's secret storage (your operating system's credential store where available).
* The activation id, the product id, the time of the last check and the time of the last successful validation, in VS Code's extension storage.
* The trial record (start, last use, last reminder), in VS Code's extension storage.

**Remove Licence From This Machine** deletes the key and the activation data and frees the activation. The trial record is kept, so that the trial is not started again.

## Report A Problem

**ACH Atlas: Report A Problem** copies a short diagnostics block to your clipboard and opens the public issues page in your browser. The block contains the extension and editor versions, the operating system, the kind, size, record count and problem counts of the active file, your ACH Atlas settings (pattern settings only as "default" or "customised") and the licence state (Free, Trial or Pro). It never contains file contents, file names, paths, field values, the licence key, user or computer names. Nothing is sent until you paste it into an issue yourself.

## Buying

The **Buy Pro** command opens the payment provider's checkout page in your browser. Payment details are entered on that page and handled by the payment provider; the extension never sees them. Their privacy policy applies to the purchase.

## Questions

Open an issue at <https://github.com/small-steps-studio/ach-atlas/issues>. Please do not include real payment data or other confidential data in a report.
