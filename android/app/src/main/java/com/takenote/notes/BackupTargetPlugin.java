package com.takenote.notes;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Destinazione del backup automatico scelta dall'utente col selettore file di Android
 * (Google Drive, memoria del tablet, altre app). L'app conserva il permesso e riscrive
 * lo stesso file a ogni backup, senza login né configurazioni Google.
 */
@CapacitorPlugin(name = "BackupTarget")
public class BackupTargetPlugin extends Plugin {

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/octet-stream");
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("name", "TakeNote-backup.takenote"));
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );
        startActivityForResult(call, intent, "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("cancelled");
            return;
        }
        Uri uri = data.getData();
        boolean persistent = true;
        try {
            getContext().getContentResolver().takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            );
        } catch (SecurityException e) {
            persistent = false;
        }
        JSObject ret = new JSObject();
        ret.put("uri", uri.toString());
        ret.put("name", displayName(uri));
        ret.put("provider", providerLabel(uri));
        ret.put("persistent", persistent);
        call.resolve(ret);
    }

    // Copia un file locale (path o file://) nella destinazione scelta.
    @PluginMethod
    public void write(PluginCall call) {
        String target = call.getString("uri");
        String source = call.getString("path");
        if (target == null || source == null) {
            call.reject("uri e path obbligatori");
            return;
        }
        execute(() -> {
            File file = new File(source.startsWith("file:") ? Uri.parse(source).getPath() : source);
            Uri uri = Uri.parse(target);
            try (InputStream in = new FileInputStream(file); OutputStream out = openForWrite(uri)) {
                if (out == null) throw new FileNotFoundException("destinazione non disponibile");
                byte[] buf = new byte[1 << 16];
                int n;
                long total = 0;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    total += n;
                }
                out.flush();
                JSObject ret = new JSObject();
                ret.put("bytes", total);
                call.resolve(ret);
            } catch (SecurityException e) {
                call.reject("permesso", "PERMISSION", e);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "scrittura fallita", e);
            }
        });
    }

    private OutputStream openForWrite(Uri uri) throws FileNotFoundException {
        try {
            return getContext().getContentResolver().openOutputStream(uri, "wt");
        } catch (FileNotFoundException | IllegalArgumentException | UnsupportedOperationException e) {
            // alcuni provider non supportano "wt"
            return getContext().getContentResolver().openOutputStream(uri, "w");
        }
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {}
        return uri.getLastPathSegment();
    }

    private String providerLabel(Uri uri) {
        String a = uri.getAuthority();
        if (a == null) return "";
        if (a.startsWith("com.google.android.apps.docs")) return "Google Drive";
        if (a.equals("com.android.externalstorage.documents")) return "Memoria del tablet";
        if (a.equals("com.android.providers.downloads.documents")) return "Download";
        return a;
    }
}
