# Select Clean Body Text — 2.2.0

## Repository guide

**Select Clean Body Text** is the Chrome/Chromium Manifest V3 extension in this repository. It helps select readable webpage content, collect pages in the background and create clipboard/export output. The separately maintained CopyAPP desktop application is an optional companion, not an executable bundled with this extension.

The main entry points are `manifest.json`, `background.js`, `content.js`, `collector.js`, `popup.html`, `options.html` and the `*-core.js` modules. PDF/export support and bundled font/vendor assets remain alongside them. [THIRD_PARTY.md](THIRD_PARTY.md) records third-party components.

Start with the install/update procedure below. Review collection timing, target-page behaviour and browser permissions before a long run; a page with dynamic or restricted content can require different handling from a simple article. Collection and export results should be checked against the source page rather than assumed complete from a successful button click.

For development, use the scripts declared in [package.json](package.json), with Node.js/npm installed. The repository is extension source; desktop companion binaries, browser profiles, personal collection history and generated exports are separate local artifacts.

A local Chrome Manifest V3 extension for clean text selection and background WTR Lab chapter collection.

## Install or update

1. Open `chrome://extensions` and enable Developer mode.
2. Load this folder unpacked, or click Reload on your existing installation of this folder.
3. Refresh the WTR chapter tab. Start a new collection after updating from 1.x.

The extension uses clipboard, storage, offscreen-document, alarm and download permissions. Downloads permission lets it save PDFs without needing the popup or collection tab in the foreground. WTR host access lets it check and navigate the collection tab. The existing clean-selection feature remains available on other ordinary websites.

## Background collection

1. Open the first chapter you want to collect and select the desired translation. Begin at Chapter 1 to collect the entire currently available novel.
2. Right-click and select **Start background chapter collection**, or open the extension popup and choose **Start on this tab**.
3. Switch to another tab and browse normally. The collection tab must remain open. No cursor placement or F6 activation is needed.
4. Open the extension popup from any tab to see progress, Pause, Resume, Stop, or return to the collection tab. F6 toggles Pause/Resume when pressed inside the collection tab.
5. The collector finishes when the current chapter matches WTR's total and Next is disabled or absent in the chapter navigation.

One collection runs at a time. A collection is locked to its tab, novel and detected translation mode. Starting a second job pauses the previous one. Navigating the collection tab away from the novel requires returning to the novel before Resume. The collector does not solve security challenges or access locked chapters.

The collector waits for readable text, the expected chapter number and consistent navigation, then compares the text across a settling interval. It saves a local backup, writes to the clipboard, confirms success and only then activates the real Next button (or follows its validated chapter URL). WTR's three duplicate navigation bars are handled without cursor coordinates. Ads, controls and hidden text are excluded; inline glossary terms remain in the prose.

Security checks never consume a chapter. The badge changes to **WAIT**, the popup explains the pause, and the same chapter is checked again when the challenge is replaced by prose. Open the collection tab if a challenge needs your interaction. The security retry interval defaults to 3 seconds and is separate from ordinary loading checks.

Page reloads and service-worker restarts restore the job. A 30-second recovery alarm supplements DOM changes and ordinary timers. Chrome may delay background timers or freeze a tab; the collector reports a stall rather than claiming completion. It temporarily disables automatic discarding for its tab and restores the original setting when stopped, paused or completed. Keeping Chrome open and the computer awake is required.

If a copy fails it is retried up to three times. If the browser interrupts a copy before its result can be recorded, the collector pauses with an uncertainty message. Resume may repeat that chapter's clipboard copy; the chapter backup is keyed by job and chapter and is not duplicated. An unconfirmed Next action is not repeatedly clicked. If WTR's scroll-based transition stalls in a hidden tab, the collector can open that verified next chapter's WTR route once, retaining the selected Web/Web+ service. It then waits for the expected destination and asks for attention after a timeout. A security check blocks this fallback too.

## Fast mode and adjustable timings

Open **Settings → Apply Fast preset**. This saves immediately and sets settling to 0.5 seconds, after-copy delay to 0 seconds, fallback delay to 2 seconds, and enables fast navigation. Fast navigation opens the verified next chapter URL directly without first waiting for WTR's scroll-based button to work in an inactive tab. It keeps the chosen Web/Web+ service and does not activate the tab. If no validated URL is available, it uses the checked Next button. Security checks, same-novel/sequential-chapter validation, clipboard confirmation and backups remain enforced.

You can independently edit and Save:

- Text settling: 0.1–60 seconds (standard default 1.5). Requires consistent text across this interval; changes restart the check. Very short settings can miss prose arriving later.
- After-copy delay: 0–60 seconds (standard default 3). Extra time for clipboard watcher apps and site pacing, not a requirement of the clipboard write. Zero removes that extra wait; CopyAPP may miss extremely rapid changes, so use the independent PDF backup as the authoritative collection.
- Next-button fallback delay: 0–60 seconds (standard default 15). Applies only after a button navigation stalls, never during security or an already-loading tab. Direct fast navigation normally does not need this timer. Zero means retry on the next normal check, not repeatedly navigate.
- Security retry: 1–60 seconds (default 3), independent of Fast mode.

Fractional seconds are accepted in 0.1-second increments. Changes take effect in a running collection; presets preserve the security retry value. Standard mode checks normal loading about once per second and Fast mode about every 250 ms, plus page-change notifications. Browser scheduling can make actual delays longer. **Apply Standard preset** restores the old settling/pacing/fallback defaults. Existing installations are not switched to Fast automatically.

## CopyAPP and PDF backup

CopyAPP can keep recording the clipboard as before. A successful clipboard write does not prove CopyAPP saved it, and anything else you copy can interleave with novel text in CopyAPP. The extension's own backups keep each collection separate from other clipboard activity.

When collection finishes or you press **Stop**, the extension automatically saves one text-based PDF to Chrome's default Downloads location. Closing the collection tab also stops and exports the run. It includes the saved text of successfully copied chapters from this run, in chapter order. Chapters start on new pages, with a single-column layout, selectable Unicode text and no repetitive page headers or footers for TTS to read aloud. Pause and security waits do not export; stopping before any successful copy does not create an empty file. Starting midway through a novel only exports the chapters collected in that run.

The filename is the novel title with punctuation and unsafe filename characters removed (for example, `Post-apocalyptic Shop: Profit-driven Shopkeeper` becomes `Post-apocalyptic Shop Profit-driven Shopkeeper.pdf`). Unicode letters are preserved; reserved Windows names and long titles are handled. Chrome adds a number for name conflicts, so earlier files are never overwritten. Repeated Stop or closing a completed tab does not export it again. The popup reports Preparing, Saving, Saved, or a download failure; a failed download never erases the backup or restarts copying. PDF creation uses bundled local libraries and fonts; text is not uploaded to any conversion service. Chinese/Japanese text uses a full fallback font and can make a PDF several megabytes larger. Unsupported rare glyphs produce an explicit error rather than silently losing text; TXT remains available as a fallback.

Use **Saved chapter backups → Download PDF** in the popup to export a backup again or recover after a failed automatic download. **Download TXT** remains available as a manual alternative. These manual exports include all backed-up chapter text, including text saved immediately before a failed or uncertain clipboard write, and use the same safe novel-title filename. Backups persist in the extension's IndexedDB across browser restarts and reloads; upgrading to the timing-history database preserves existing chapter backups. Do not uninstall the extension or clear its data if you want to retain them. Fully quitting Chrome is not a reliable Stop event: use Stop before quitting to save automatically. After a browser restart, its saved text remains manually exportable, and a new run can start at the next desired chapter.

## Timing diagnostics

Timing history is recorded automatically during new runs. In the popup, select the run under **Saved chapter backups** and click **Download timing log**. The JSON includes every copied/attempted chapter, chronological events, selected settings and changes, loading time, configured versus actual settling and after-copy time, clipboard-write duration and retries, Next/navigation completion, fallback wait if used, and security pauses. Summary statistics include count, minimum, median, 95th percentile and maximum for recorded stages. A fallback that never ran is shown as unused, not as a zero-second observation.

The log contains no chapter prose or unrelated clipboard/browsing content, but it does identify the novel and run. Timings are wall-clock measurements, not CPU benchmarks: storage, page inspection, browser scheduling, sleep and security checks can contribute. Loading/navigation and security times can overlap. Timing data cannot prove CopyAPP received every clipboard event or that a shorter settling interval preserves all later-arriving text. Use a representative run and check chapter completeness before choosing more aggressive settings. Timing-log storage failures warn in the popup but do not block chapter copying. Older runs remain exportable but have no retroactive timing history.

## Manual clean selection

Right-click a paragraph → **Select clean text from this body** → Ctrl+C. Escape clears the selection. This remains independent of background collection.

## Development and verification

Run `npm.cmd test` for syntax/manifest validation, state-machine, settings, timing, clipboard and PDF/TXT-export tests, and real headless-Chrome DOM fixtures. Browser fixtures verify the v1-to-v2 archive upgrade, sequential standard/fast collection, security interruptions, ordered backups and actual PDF generation through simulated Chrome messaging/tab/clipboard/download APIs. The PDF test creates a scratch sample under `tmp/pdfs/` for text extraction and rendered-page checks. These tests do not replace live testing of the installed extension's Chrome APIs, clipboard delivery to CopyAPP, WTR's behaviour or the user's TTS software. See THIRD_PARTY.md for local dependencies and font licenses.

All text cleaning, job state, clipboard operations and backups stay local. Only normal chapter navigation contacts WTR Lab.


## Source snapshot and validation

See [BACKUP_NOTES.md](BACKUP_NOTES.md) for the omitted build outputs, local settings, credentials and runtime data. Build generated binaries locally using the instructions above; a source checkout is not an installed application. Earlier validation figures in this guide describe their original development runs. This documentation update checks source references and instructions; it does not claim a fresh application, device or gameplay test.
