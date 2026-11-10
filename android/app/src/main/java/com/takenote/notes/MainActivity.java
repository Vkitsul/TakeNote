package com.takenote.notes;

import android.content.pm.ActivityInfo;
import android.os.Bundle;
import android.view.Display;
import android.view.InputDevice;
import android.view.KeyCharacterMap;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    // Pulsanti che una penna può segnalare nello stato del MotionEvent
    private static final int[] PEN_BUTTONS = {
        MotionEvent.BUTTON_STYLUS_PRIMARY,
        MotionEvent.BUTTON_STYLUS_SECONDARY,
        MotionEvent.BUTTON_SECONDARY,
        MotionEvent.BUTTON_TERTIARY,
    };
    private int penButtonState = 0;
    private InkOverlayView inkOverlay;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackupTargetPlugin.class);
        registerPlugin(InkOverlayPlugin.class);
        super.onCreate(savedInstanceState);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        WebView webView = getBridge().getWebView();
        // niente rimbalzo/scrollbar del WebView: pan e zoom li gestisce l'app
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        WebSettings settings = webView.getSettings();
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        requestHighestRefreshRate();
        // livello del tratto in corso, sopra il WebView (vedi InkOverlayView)
        inkOverlay = new InkOverlayView(this, webView);
        ((ViewGroup) webView.getParent()).addView(
            inkOverlay,
            new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
    }

    public InkOverlayView inkOverlay() {
        return inkOverlay;
    }

    // Ogni fotogramma in meno è ritardo in meno tra penna e inchiostro (Pad 7: fino a 144 Hz).
    private void requestHighestRefreshRate() {
        Display display = getWindowManager().getDefaultDisplay();
        Display.Mode current = display.getMode();
        Display.Mode best = current;
        for (Display.Mode mode : display.getSupportedModes()) {
            boolean sameSize = mode.getPhysicalWidth() == current.getPhysicalWidth() && mode.getPhysicalHeight() == current.getPhysicalHeight();
            if (sameSize && mode.getRefreshRate() > best.getRefreshRate()) best = mode;
        }
        WindowManager.LayoutParams params = getWindow().getAttributes();
        params.preferredDisplayModeId = best.getModeId();
        getWindow().setAttributes(params);
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent ev) {
        trackPenButtons(ev);
        // campioni della penna consegnati appena arrivano, senza aspettare il fotogramma successivo
        if (ev.getActionMasked() == MotionEvent.ACTION_DOWN && ev.getToolType(0) == MotionEvent.TOOL_TYPE_STYLUS) {
            getBridge().getWebView().requestUnbufferedDispatch(ev);
        }
        if (inkOverlay != null && inkOverlay.handle(ev)) return true;
        return super.dispatchTouchEvent(ev);
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent ev) {
        trackPenButtons(ev);
        return super.dispatchGenericMotionEvent(ev);
    }

    // Inoltra all'app web ogni pressione/rilascio dei tasti della penna (anche mentre la penna è sospesa sullo schermo).
    private void trackPenButtons(MotionEvent ev) {
        int tool = ev.getToolType(0);
        if (tool != MotionEvent.TOOL_TYPE_STYLUS && tool != MotionEvent.TOOL_TYPE_ERASER) return;
        int state = 0;
        for (int b : PEN_BUTTONS) state |= ev.getButtonState() & b;
        int action = ev.getActionMasked();
        if (action == MotionEvent.ACTION_HOVER_EXIT && ev.getButtonState() == 0) state = 0;
        int changed = state ^ penButtonState;
        if (changed == 0) return;
        for (int b : PEN_BUTTONS) {
            if ((changed & b) != 0) sendPenButton("btn:" + b, (state & b) != 0);
        }
        penButtonState = state;
    }

    // Le penne Xiaomi mandano i tasti da una "tastiera" Bluetooth della penna come Pagina su/giù (92/93),
    // non con origine stilo: quindi si inoltra ogni tasto fisico, e l'app decide quali usare.
    @Override
    public boolean dispatchKeyEvent(KeyEvent ev) {
        int code = ev.getKeyCode();
        if (!isReservedKey(code) && ev.getDeviceId() != KeyCharacterMap.VIRTUAL_KEYBOARD && ev.getRepeatCount() == 0) {
            String id = code == KeyEvent.KEYCODE_UNKNOWN ? "scan:" + ev.getScanCode() : "key:" + code;
            if (ev.getAction() == KeyEvent.ACTION_DOWN) sendPenButton(id, true, deviceLabel(ev));
            else if (ev.getAction() == KeyEvent.ACTION_UP) sendPenButton(id, false, deviceLabel(ev));
        }
        boolean fromStylus = (ev.getSource() & InputDevice.SOURCE_STYLUS) == InputDevice.SOURCE_STYLUS;
        // KEYCODE_STYLUS_BUTTON_PRIMARY..TAIL (Android 14+) = 308..311
        boolean stylusKey = code >= 308 && code <= 311;
        boolean pageKey = code == KeyEvent.KEYCODE_PAGE_UP || code == KeyEvent.KEYCODE_PAGE_DOWN;
        if (fromStylus || stylusKey || pageKey) return true;
        return super.dispatchKeyEvent(ev);
    }

    private static boolean isReservedKey(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_HOME:
            case KeyEvent.KEYCODE_POWER:
            case KeyEvent.KEYCODE_VOLUME_UP:
            case KeyEvent.KEYCODE_VOLUME_DOWN:
            case KeyEvent.KEYCODE_VOLUME_MUTE:
                return true;
            default:
                return false;
        }
    }

    private static String deviceLabel(KeyEvent ev) {
        InputDevice device = ev.getDevice();
        return device != null ? device.getName() : "";
    }

    private void sendPenButton(String id, boolean down) {
        sendPenButton(id, down, "penna");
    }

    private void sendPenButton(String id, boolean down, String device) {
        if (getBridge() == null) return;
        final WebView webView = getBridge().getWebView();
        if (webView == null) return;
        // il nome del dispositivo arriva dall'esterno: va sempre quotato
        final String js =
            "window.dispatchEvent(new CustomEvent('penbutton',{detail:{id:" +
            JSONObject.quote(id) +
            ",down:" +
            down +
            ",device:" +
            JSONObject.quote(device) +
            "}}))";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }
}
