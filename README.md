# TakeNote

A note-taking app for Android tablets that is **pen only** (built for the Xiaomi Pad 7 + Focus Pen).
No text boxes: pens, highlighter, eraser, lasso, snips, annotatable PDFs and unlimited pages.

## Installing on the tablet

1. Build `TakeNote.apk` (see *For developers*: the APK is not in the repository) and copy it to the tablet (USB cable, Google Drive, a Telegram message to yourself…).
2. Open it from the tablet's file manager and tap **Install**.
   The first time, Android asks you to allow installs from that source (Settings → *Install unknown apps*): allow it only for the app you open the file with.
3. Open **TakeNote** from the home screen.

To update the app later, install the new `TakeNote.apk` over the old one: your notebooks stay.
This works only if the APK is signed with the same key → **do not delete the `android-signing` folder** (see the notes inside it). It holds the private key, so it stays on your PC and is not in the repository.

## Features

**Library**
- Folders (e.g. one per subject) and notebooks with a cover preview.
- New notebook: background (blank, lined, narrow lines, 5 mm grid, 4 mm grid, graph paper, dotted), A4 portrait/landscape, paper color.
- Import PDF → it becomes a notebook you can write on.
- Notebook menu: rename, move, cover color, export PDF, backup, delete.

**Editor**
- **Uniform stroke** (default): constant width, no pressure, like drawing with the mouse in Paint. The line follows the pen samples with smooth curves, without corners or lag.
  The stroke tip runs a few milliseconds ahead of the pen (*Stroke prediction*, can be turned off).
  The stroke in progress is drawn by a native Android layer, much more responsive than the WebView (turn it off in *Pen and touch settings → Fast writing* if it causes problems).
  Fountain pen, ballpoint, brush and pencil are still available: they react to pressure but do not use fast writing.
  Tap the active pen icon again to change its type and width.
- 5 quick colors for pen and highlighter: tap an active color to change it (palette + free picker).
- 3 quick widths: tap the active one to adjust it.
- Transparent highlighter (does not cover the text), with an "always a straight line" option.
- Automatic shapes (hold at the end of a stroke → line, circle, rectangle, triangle): **off by default**, because when writing slowly they turned strokes into straight lines. Turn them back on in *Pen and touch settings*.
- Eraser: *Whole stroke* or *Partial*; "erase highlighter only" option; "Erase current page".
- **Floating pen bar** (as in Notein): only your favorite pens, each with its own color and width.
  - Tap a pen to use it; tap the active one again to change its type, width or color, or remove it. **+** adds a pen.
  - Drag it by the handle (the dots) wherever you like; the ⋯ menu makes it vertical, reorders the pens or hides it.
  - The arrows button **collapses it to an icon**; tap the icon to **expand it** (drag the icon to move it).
  - If you change color or width from the top bar while using a pen from the bar, that pen is updated.
  - Editor ⋮ menu → *Show/Hide pen bar*.
- **Configurable pen buttons** (⋮ menu → *Pen and touch settings*): for *Button 1* and *Button 2* choose the action
  (eraser/highlighter/lasso/snip while held, toggle pen-eraser or pen-lasso, undo, redo, next/previous pen in the bar, collapse/expand the bar).
  Defaults: **Button 1 = toggle pen/eraser**, **Button 2 = toggle pen/lasso**, with a single click.
  Tap **Detect** and then the button on the pen to teach the app which signal it sends. Below, *Signals received* shows the code of every press and the device that sent it.
  Give the button a short tap: if you hold a Xiaomi button, HyperOS may start a screenshot or a quick note. If *Signals received* stays empty, the system is not passing the button to the app.
- The app always stays in **landscape** (you can turn the tablet by 180°).
- **Dark mode** (moon/sun icon at the top, in the library too): pages, paper, lines, PDFs and snips are inverted;
  of the ink only **black** changes (and near-black grays and blues), which shows as white. Red, blue, green, highlighters… stay the same.
  It only affects what you see: turning dark mode off brings black back, and exported PDFs always keep the original colors.
- Lasso: circle or tap a stroke/snip → move (even to another page, scrolling with a finger while you drag), resize from the corners, recolor, copy/cut/paste, duplicate, delete, save as snip.
- **Snip**: rectangular or freeform clipping of any part of a page or PDF.
  The snip shows up "lifted" right away: drag it wherever you want. It also stays in the **Saved snips** tray (images icon at the top right), from which you can drag it, or tap it, to insert it on any page of any notebook.
- Pages: "+ New page" button at the bottom, Pages panel (thumbnails) with insert after, duplicate, move, delete, background, insert a PDF in the middle of the notebook.
- Export PDF: original PDF pages (text still selectable) + vector ink + snips. Share it (Drive, email…) or save it to *Documents/TakeNote*.
- Continuous autosave.

**Gestures**
- 1 finger: scroll · 2 fingers: zoom · double tap: fit to width
- 2-finger tap: undo · 3-finger tap: redo
- **Palm rejection** (Pen and touch settings), filtered at the Android level before the touch reaches the app:
  - *Strong* (default): the hand is ignored while the pen writes or hovers over the screen, for 0.7 s afterwards, and for 2.5 s within 9 cm of where you wrote; contacts as wide as a palm are ignored too. A finger far from the pen scrolls right away.
  - *Two fingers*: on top of that, one finger never scrolls the page (scroll and zoom with two fingers).
  - *Normal*: only while the pen writes and right after.
  - If the hand scrolled the page a little before the pen touched, the page goes back where it was.
- Pen settings (⋮ menu): pressure sensitivity, finger drawing, gestures, pen buttons.

## Backup (important)

Notebooks are saved **only on the tablet**, inside the app. Uninstalling the app deletes them: that is why there is an **automatic backup**.

**Automatic backup** (library → ⋮ menu → *Automatic backup…*, or tap the blue banner):
- It is on from the start, in the tablet storage (*Documents/TakeNote/Backup*, latest 5 copies).
- **For Google Drive**: choose *Google Drive* → *Choose on Drive…*. In the file picker tap ☰, then **Drive**, pick a folder and tap **Save**.
  From then on the app updates that file by itself on every backup (the Google Drive app must be installed on the tablet; if you are offline, Drive uploads it as soon as you are back online).
- Frequency: *every day* (recommended), *each time a notebook closes*, *every week*. A backup runs only if you changed something.
- At the top of the library, "Backup…" shows while it runs and "Backup failed" if something goes wrong (tap it for details).

**Restore**: library → ⋮ menu → **Restore from backup…** and pick the `.takenote` file (straight from Drive works too).
**Full backup now** creates a file you can share anywhere.

## For developers

Requirements: Node.js 22, JDK 21, Android SDK (platform 36, build-tools 36).

- `npm install` installs the dependencies and copies the pdf.js files needed offline into `public/pdfjs`.
- Web app: Vite + JavaScript (`src/` folder). `npm run dev` runs it in the browser (the mouse acts as the pen).
- Android: Capacitor 8 (`android/` folder), with native parts in `android/app/src/main/java`:
  the router that separates pen and hand (`InputRouter`), the layer that draws the stroke in progress (`InkOverlayView`) and the Drive backup destination (`BackupTargetPlugin`).
  Rebuild the APK with `npm run android`
  (the script looks for JDK 21 and the Android SDK in `%LOCALAPPDATA%\TakeNoteBuild`).
- Signing: the release APK is signed with `android-signing/takenote-release.jks` and the values in `android/keystore.properties`
  (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`). Both are excluded from git: to build from another copy of the project,
  create your own key with `keytool -genkeypair`. Without the original key the app cannot update over the one already installed.
