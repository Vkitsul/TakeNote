package com.takenote.notes;

import android.graphics.Color;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONException;

/** Collega l'app web al livello nativo del tratto (InkOverlayView). */
@CapacitorPlugin(name = "InkOverlay")
public class InkOverlayPlugin extends Plugin {

    @PluginMethod
    public void configure(PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        final float width = call.getFloat("width", 4f);
        final float dpr = call.getFloat("dpr", 1f);
        final float alpha = call.getFloat("alpha", 1f);
        final float[] pages = rects(call.getArray("pages"));
        final float[] excl = rects(call.getArray("excl"));
        int parsed = Color.BLACK;
        try {
            parsed = Color.parseColor(call.getString("color", "#000000"));
        } catch (IllegalArgumentException ignored) {}
        final int color = (parsed & 0x00FFFFFF) | (Math.round(alpha * 255f) << 24);
        getActivity().runOnUiThread(() -> {
            InkOverlayView ink = ((MainActivity) getActivity()).inkOverlay();
            if (ink != null) ink.configure(enabled, color, width, dpr, pages, excl);
            call.resolve();
        });
    }

    @PluginMethod
    public void committed(PluginCall call) {
        final int id = call.getInt("id", -1);
        getActivity().runOnUiThread(() -> {
            InkOverlayView ink = ((MainActivity) getActivity()).inkOverlay();
            if (ink != null) ink.committed(id);
            call.resolve();
        });
    }

    private static float[] rects(JSArray array) {
        if (array == null) return new float[0];
        float[] out = new float[array.length()];
        try {
            for (int i = 0; i < out.length; i++) out[i] = (float) array.getDouble(i);
        } catch (JSONException e) {
            return new float[0];
        }
        return out;
    }
}
