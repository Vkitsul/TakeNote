# TakeNote

App per prendere appunti **solo con la penna** su tablet Android (pensata per Xiaomi Pad 7 + Focus Pen).
Niente caselle di testo: penne, evidenziatore, gomma, lazo, snip, PDF annotabili e pagine illimitate.

## Installazione sul tablet

1. Compila `TakeNote.apk` (vedi *Per sviluppatori*: l'APK non è nel repository) e copialo sul tablet (cavo USB, Google Drive, Telegram a te stesso…).
2. Aprilo dal file manager del tablet e tocca **Installa**.
   La prima volta Android chiede di consentire l'installazione da quella sorgente (Impostazioni → *Installa app sconosciute*): consentila solo per l'app con cui apri il file.
3. Apri **TakeNote** dalla home.

Per aggiornare l'app in futuro basta installare il nuovo `TakeNote.apk` sopra quello vecchio: i quaderni restano.
Questo funziona solo se l'APK è firmato con la stessa chiave → **non cancellare la cartella `android-signing`** (vedi il LEGGIMI al suo interno). Contiene la chiave privata, quindi resta solo sul tuo PC e non è nel repository.

## Cosa c'è

**Libreria**
- Cartelle (es. una per materia), quaderni con copertina in anteprima.
- Nuovo quaderno: sfondo (bianco, righe, righe strette, quadretti, puntini), A4 verticale/orizzontale, colore carta.
- Importa PDF → diventa un quaderno su cui scrivere.
- Menu del quaderno: rinomina, sposta, colore copertina, esporta PDF, backup, elimina.

**Editor**
- **Tratto uniforme** (predefinito): spessore costante, nessuna pressione né smussatura, come scrivere col mouse in Paint.
  Il tratto in corso è disegnato da un livello nativo Android, molto più reattivo del WebView (si disattiva in *Impostazioni penna e tasti → Scrittura veloce*, in caso di problemi).
  Restano disponibili anche stilografica, sfera, pennello e matita, sensibili alla pressione ma senza scrittura veloce.
  Tocca di nuovo l'icona della penna attiva per cambiare tipo e spessore.
- 5 colori rapidi per penna ed evidenziatore: tocca un colore già attivo per cambiarlo (tavolozza + selettore libero).
- 3 spessori rapidi: tocca quello attivo per regolarlo.
- Evidenziatore trasparente (non copre il testo), opzione "sempre linea dritta".
- Forme automatiche (tieni premuto a fine tratto → linea, cerchio, rettangolo, triangolo): **disattivate di base**, perché scrivendo lentamente trasformavano i tratti in linee dritte. Si riattivano in *Impostazioni penna e tasti*.
- Gomma: *Tratto* (cancella tratti interi) o *Parziale*; opzione "solo evidenziatore"; "Cancella pagina".
- **Barra penne flottante** (come in Notein): solo le tue penne preferite (stilografica, sfera, pennello, matita, evidenziatore, ognuna col suo colore e spessore).
  - Tocca una penna per usarla; tocca di nuovo quella attiva per cambiarne tipo, spessore, colore o rimuoverla. **+** ne aggiunge una.
  - Trascinala dalla maniglia (i puntini) dove vuoi; menu ⋯ per renderla verticale, riordinare le penne o nasconderla.
  - Il pulsante con le frecce la **riduce a icona**; tocca l'icona per **espanderla** (trascina l'icona per spostarla).
  - Se cambi colore/spessore dalla barra in alto mentre usi una penna della barra, la penna si aggiorna.
  - Menu ⋮ dell'editor → *Mostra/Nascondi barra penne*.
- **Tasti della penna configurabili** (menu ⋮ → *Impostazioni penna e tasti*): per *Tasto 1* e *Tasto 2* scegli l'azione
  (gomma/evidenziatore/lazo/snip finché tieni premuto, alterna penna-gomma o penna-lazo, annulla, ripeti, penna successiva/precedente della barra, riduci/espandi barra).
  Predefiniti: **Tasto 1 = alterna penna/gomma**, **Tasto 2 = alterna penna/lazo**, con un clic singolo.
  Premi **Rileva** e poi il tasto sulla penna per insegnare all'app quale segnale invia. In basso, *Segnali ricevuti* mostra il codice di ogni pressione e il dispositivo che l'ha inviata.
  Dai un tocco breve: se tieni premuto un tasto Xiaomi, HyperOS può avviare lo screenshot o la nota rapida. Se *Segnali ricevuti* resta vuoto, il sistema non sta passando il tasto all'app.
- L'app resta sempre in **orizzontale** (puoi girare il tablet di 180°).
- **Modalità scura** (icona luna/sole in alto, anche nella libreria): pagine, carta, righe, PDF e snip vengono invertiti;
  dell'inchiostro cambia solo il **nero** (e i grigi/blu quasi neri), che appare bianco. Rosso, blu, verde, evidenziatori… restano uguali.
  È solo visualizzazione: togliendo la modalità scura il nero torna nero, e i PDF esportati hanno sempre i colori originali.
- Lazo: cerchia o tocca un tratto/snip → sposta (anche su un'altra pagina, scorrendo con un dito mentre trascini), ridimensiona dagli angoli, cambia colore, copia/taglia/incolla, duplica, elimina, salva come snip.
- **Snip**: ritaglio rettangolare o a forma libera di qualunque parte di pagina o PDF.
  Lo snip appare subito "sollevato": trascinalo dove vuoi. Resta anche nel vassoio **Snip salvati** (icona immagini in alto a destra), da cui puoi trascinarlo o toccarlo per inserirlo in qualsiasi pagina di qualsiasi quaderno.
- Pagine: pulsante "+ Nuova pagina" in fondo, pannello Pagine (miniature) con inserisci dopo, duplica, sposta, elimina, sfondo, inserisci PDF in mezzo al quaderno.
- Esporta PDF: pagine PDF originali (testo ancora selezionabile) + inchiostro vettoriale + snip. Condividi (Drive, email…) o salva in *Documenti/TakeNote*.
- Salvataggio automatico continuo.

**Gesti**
- 1 dito: scorri · 2 dita: zoom · doppio tocco: adatta alla larghezza
- Tocco con 2 dita: annulla · tocco con 3 dita: ripeti
- Il palmo appoggiato mentre scrivi viene ignorato (tocchi larghi, o subito dopo/durante l'uso della penna).
- Impostazioni penna (menu ⋮): sensibilità pressione, disegno col dito, gesti, tasto penna.

## Backup (importante)

I quaderni sono salvati **solo sul tablet**, dentro l'app. Se disinstalli l'app vengono cancellati: per questo c'è il **backup automatico**.

**Backup automatico** (libreria → menu ⋮ → *Backup automatico…*, oppure tocca il banner blu):
- È attivo da subito nella memoria del tablet (*Documenti/TakeNote/Backup*, ultime 5 copie).
- **Per Google Drive**: scegli *Google Drive* → *Scegli su Drive…*. Nel selettore file tocca ☰, poi **Drive**, scegli una cartella e premi **Salva**.
  Da quel momento l'app aggiorna da sola quel file a ogni backup (serve l'app Google Drive installata sul tablet; se sei offline, Drive lo carica appena torni online).
- Frequenza: *ogni giorno* (consigliato), *a ogni chiusura di un quaderno*, *ogni settimana*. Il backup parte solo se hai cambiato qualcosa.
- In alto nella libreria compare "Backup…" mentre lavora e "Backup non riuscito" se c'è un problema (toccalo per i dettagli).

**Ripristino**: libreria → menu ⋮ → **Ripristina da backup…** e scegli il file `.takenote` (anche direttamente da Drive).
**Backup completo ora** crea un file da condividere dove vuoi.

## Per sviluppatori

Requisiti: Node.js 22, JDK 21, Android SDK (platform 36, build-tools 36).

- `npm install` installa le dipendenze e copia in `public/pdfjs` i file di pdf.js che servono offline.
- Web app: Vite + JavaScript (cartella `src/`). `npm run dev` per provarla nel browser (il mouse fa da penna).
- Android: Capacitor 8 (cartella `android/`), con due parti native in `android/app/src/main/java`:
  il livello che disegna il tratto in corso (`InkOverlayView`) e la destinazione del backup su Drive (`BackupTargetPlugin`).
  Ricompila l'APK con `npm run android`
  (lo script cerca JDK 21 e Android SDK in `%LOCALAPPDATA%\TakeNoteBuild`).
- Firma: l'APK di release si firma con `android-signing/takenote-release.jks` e i dati in `android/keystore.properties`
  (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`). Sono esclusi da git: per compilare da un'altra copia del progetto
  crea una chiave tua con `keytool -genkeypair`. Senza la chiave originale l'app non si aggiorna sopra quella già installata.
