package com.takenote.notes;

import android.content.pm.ActivityInfo;
import android.os.Build;
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
    // Buttons a pen can report in the MotionEvent button state
    private static final int[] PEN_BUTTONS = {
        MotionEvent.BUTTON_STYLUS_PRIMARY,
        MotionEvent.BUTTON_STYLUS_SECONDARY,
        MotionEvent.BUTTON_SECONDARY,
        MotionEvent.BUTTON_TERTIARY,
    };
    private int penButtonState = 0;
    private InkOverlayView inkOverlay;
    private InputRouter router;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackupTargetPlugin.class);
        registerPlugin(InkOverlayPlugin.class);
        super.onCreate(savedInstanceState);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        WebView webView = getBridge().getWebView();
        // no WebView overscroll/scrollbars: the app handles pan and zoom
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        WebSettings settings = webView.getSettings();
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        // the system must never throttle the WebView engine while the app is in the foreground
        if (Build.VERSION.SDK_INT >= 26) webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        if (Build.VERSION.SDK_INT >= 35) webView.setRequestedFrameRate(View.REQUESTED_FRAME_RATE_CATEGORY_HIGH);
        requestHighestRefreshRate();
        // live stroke layer, on top of the WebView (see InkOverlayView)
        inkOverlay = new InkOverlayView(this, webView);
        ((ViewGroup) webView.getParent()).addView(
            inkOverlay,
            new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        );
        router = new InputRouter(inkOverlay, ev -> MainActivity.super.dispatchTouchEvent(ev), getResources().getDisplayMetrics());
    }

    public InkOverlayView inkOverlay() {
        return inkOverlay;
    }

    public InputRouter inputRouter() {
        return router;
    }

    // Every frame saved is less lag between pen and ink (Pad 7: up to 144 Hz).
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
        params.preferredRefreshRate = best.getRefreshRate();
        getWindow().setAttributes(params);
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent ev) {
        trackPenButtons(ev);
        // pen to the stroke layer, fingers filtered by palm rejection (see InputRouter)
        if (router != null) return router.dispatch(ev);
        return super.dispatchTouchEvent(ev);
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent ev) {
        trackPenButtons(ev);
        if (router != null) router.onHover(ev);
        return super.dispatchGenericMotionEvent(ev);
    }

    // Forwards every pen button press/release to the web app (even while the pen hovers over the screen).
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

    // Xiaomi pens send their buttons from the pen's Bluetooth "keyboard" as Page up/down (92/93),
    // not with a stylus source: so every physical key is forwarded, and the app decides which to use.
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
        // the device name comes from outside: always quote it
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
