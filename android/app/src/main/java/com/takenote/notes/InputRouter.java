package com.takenote.notes;

import android.util.DisplayMetrics;
import android.view.MotionEvent;
import java.util.HashMap;

/**
 * Routes every touch before it reaches the app: the pen goes to the stroke layer (or the WebView),
 * fingers pass only if they are not the resting hand.
 *
 * A hand is dropped when it touches the screen while the pen is writing, hovering over the
 * screen or has just lifted; when it touches near where the pen wrote a moment
 * ago; when the contact area is too large for a finger. A touch already in progress (the hand
 * arriving before the pen) is cancelled as soon as the pen touches.
 *
 * It works both when pen and fingers are separate input devices and when they arrive
 * mixed in the same stream: in that case the pen is split out into an event of its own.
 */
final class InputRouter {

    interface App {
        boolean dispatch(MotionEvent ev);
    }

    private static final int TOOL_TYPE_PALM = 5;
    private static final long NEVER = Long.MIN_VALUE / 4;
    private static final long PEN_STUCK_MS = 20000;
    private static final long HOVER_STALE_MS = 4000;
    private static final long YOUNG_GESTURE_MS = 350;
    private static final int SIZE_REJECTS_BEFORE_DISTRUST = 5;

    private static final class Stream {
        boolean decided;
        boolean rejected;
        boolean rejectedBySizeOnly;
        boolean forwarded;
        long downTime;
        MotionEvent last;
        boolean penActive;
        boolean penToOverlay;
        long penDownTime;
        MotionEvent lastPen;
    }

    private final InkOverlayView overlay;
    private final App app;
    private final float pxPerMm;
    private final HashMap<Long, Stream> streams = new HashMap<>();

    private boolean enabled = true;
    private long graceMs = 700;
    private long zoneMs = 2500;
    private float zoneMm = 90;
    private float palmMm = 20;

    private boolean penDown;
    private boolean penHover;
    private long lastPenTime = NEVER;
    private long lastContactTime = NEVER;
    private float penX;
    private float penY;
    // if the panel reports unreliable contact areas, the size check turns itself off
    private int sizeOnlyRejects;
    private boolean sizeTrusted = true;

    InputRouter(InkOverlayView overlay, App app, DisplayMetrics metrics) {
        this.overlay = overlay;
        this.app = app;
        float dpi = metrics.xdpi;
        if (dpi < metrics.densityDpi * 0.5f || dpi > metrics.densityDpi * 2f) dpi = metrics.densityDpi;
        this.pxPerMm = dpi / 25.4f;
    }

    void configure(boolean enabled, long graceMs, long zoneMs, float zoneMm, float palmMm) {
        this.enabled = enabled;
        this.graceMs = graceMs;
        this.zoneMs = zoneMs;
        this.zoneMm = zoneMm;
        this.palmMm = palmMm;
        this.sizeTrusted = true;
        this.sizeOnlyRejects = 0;
    }

    private static boolean isPen(int tool) {
        return tool == MotionEvent.TOOL_TYPE_STYLUS || tool == MotionEvent.TOOL_TYPE_ERASER;
    }

    private static boolean isHand(int tool) {
        return tool == MotionEvent.TOOL_TYPE_FINGER || tool == TOOL_TYPE_PALM || tool == MotionEvent.TOOL_TYPE_UNKNOWN;
    }

    boolean dispatch(MotionEvent ev) {
        int action = ev.getActionMasked();
        long key = ((long) ev.getDeviceId() << 32) ^ (ev.getSource() & 0xffffffffL);
        Stream s = streams.get(key);
        if (action == MotionEvent.ACTION_DOWN) {
            if (s != null) release(s);
            s = new Stream();
            s.downTime = ev.getEventTime();
            streams.put(key, s);
        } else if (s == null) {
            return app.dispatch(ev); // gesture whose start was not seen
        }

        int pen = -1;
        boolean hands = false;
        for (int i = 0; i < ev.getPointerCount(); i++) {
            int tool = ev.getToolType(i);
            if (isPen(tool)) {
                if (pen < 0) pen = i;
            } else if (isHand(tool)) hands = true;
        }

        boolean result = true;
        boolean ended = action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL;
        boolean mixed = pen >= 0 || s.penActive;
        if (mixed) {
            handlePen(s, ev, action, pen);
            // fingers never pass in the same stream as the pen
            if (hands) reject(s);
        } else if (hands) {
            result = handleHands(s, ev, action);
        } else {
            result = app.dispatch(ev); // mouse or other
        }
        if (ended) {
            streams.remove(key);
            release(s);
        }
        return result;
    }

    // --- Pen ---
    private void handlePen(Stream s, MotionEvent ev, int action, int pen) {
        long now = ev.getEventTime();
        int penAction;
        if (!s.penActive) {
            boolean leaving = action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL
                || (action == MotionEvent.ACTION_POINTER_UP && ev.getActionIndex() == pen);
            if (pen < 0 || leaving) return;
            penAction = MotionEvent.ACTION_DOWN;
            s.penActive = true;
            s.penDownTime = now;
            penDown = true;
            penHover = false;
            cancelHands(Long.MAX_VALUE, now);
        } else if (action == MotionEvent.ACTION_CANCEL || pen < 0) {
            penAction = MotionEvent.ACTION_CANCEL;
        } else if (action == MotionEvent.ACTION_UP || (action == MotionEvent.ACTION_POINTER_UP && ev.getActionIndex() == pen)) {
            penAction = MotionEvent.ACTION_UP;
        } else {
            penAction = MotionEvent.ACTION_MOVE;
        }

        MotionEvent pe;
        boolean synthesized = false;
        if (pen < 0) {
            pe = MotionEvent.obtain(s.lastPen);
            pe.setAction(MotionEvent.ACTION_CANCEL);
            synthesized = true;
        } else if (ev.getPointerCount() == 1 && action == penAction && ev.getDownTime() == s.penDownTime) {
            pe = ev;
        } else {
            pe = penOnly(ev, pen, penAction, s.penDownTime);
            synthesized = true;
        }

        if (pen >= 0) {
            penX = ev.getX(pen);
            penY = ev.getY(pen);
        }
        lastPenTime = now;
        lastContactTime = now;

        if (penAction == MotionEvent.ACTION_DOWN) s.penToOverlay = overlay.handle(pe);
        else if (s.penToOverlay) overlay.handle(pe);
        if (!s.penToOverlay) app.dispatch(pe);

        if (s.lastPen != null) s.lastPen.recycle();
        s.lastPen = null;
        if (penAction == MotionEvent.ACTION_UP || penAction == MotionEvent.ACTION_CANCEL) {
            s.penActive = false;
            penDown = false;
        } else {
            s.lastPen = MotionEvent.obtain(pe);
        }
        if (synthesized) pe.recycle();
    }

    // Event with only the pen (and its historical samples), split out of a stream that also has fingers.
    private static MotionEvent penOnly(MotionEvent ev, int pen, int action, long downTime) {
        MotionEvent.PointerProperties[] props = { new MotionEvent.PointerProperties() };
        MotionEvent.PointerCoords[] coords = { new MotionEvent.PointerCoords() };
        ev.getPointerProperties(pen, props[0]);
        int history = action == MotionEvent.ACTION_MOVE ? ev.getHistorySize() : 0;
        MotionEvent out = null;
        for (int h = 0; h <= history; h++) {
            long time;
            if (h < history) {
                ev.getHistoricalPointerCoords(pen, h, coords[0]);
                time = ev.getHistoricalEventTime(h);
            } else {
                ev.getPointerCoords(pen, coords[0]);
                time = ev.getEventTime();
            }
            if (out == null) {
                out = MotionEvent.obtain(
                    downTime, time, action, 1, props, coords, ev.getMetaState(), ev.getButtonState(),
                    ev.getXPrecision(), ev.getYPrecision(), ev.getDeviceId(), ev.getEdgeFlags(), ev.getSource(), ev.getFlags()
                );
            } else {
                out.addBatch(time, coords, ev.getMetaState());
            }
        }
        return out;
    }

    /** Pen hovering over the screen (hover events). */
    void onHover(MotionEvent ev) {
        if (!isPen(ev.getToolType(0))) return;
        int action = ev.getActionMasked();
        long now = ev.getEventTime();
        boolean was = penHover;
        penHover = action != MotionEvent.ACTION_HOVER_EXIT;
        lastPenTime = now;
        penX = ev.getX();
        penY = ev.getY();
        // the pen is approaching: a touch that just started is almost certainly the hand coming to rest
        if (penHover && !was && enabled) cancelHands(YOUNG_GESTURE_MS, now);
    }

    // --- Fingers ---
    private boolean handleHands(Stream s, MotionEvent ev, int action) {
        if (!s.decided) {
            s.decided = true;
            decide(s, ev);
        }
        if (s.rejected) return true;
        if (enabled && palmSized(ev)) {
            cancel(s);
            return true;
        }
        s.forwarded = true;
        if (s.last != null) s.last.recycle();
        s.last = MotionEvent.obtain(ev);
        return app.dispatch(ev);
    }

    private void decide(Stream s, MotionEvent ev) {
        if (!enabled) return;
        long now = ev.getEventTime();
        boolean byPen =
            (penDown && now - lastPenTime < PEN_STUCK_MS)
                || (penHover && now - lastPenTime < HOVER_STALE_MS)
                || now - lastPenTime < graceMs;
        if (!byPen && zoneMs > 0 && now - lastContactTime < zoneMs) {
            float limit = zoneMm * pxPerMm;
            float dx = ev.getX() - penX, dy = ev.getY() - penY;
            byPen = dx * dx + dy * dy < limit * limit;
        }
        if (byPen) {
            s.rejected = true;
        } else if (palmSized(ev)) {
            s.rejected = true;
            s.rejectedBySizeOnly = true;
            if (++sizeOnlyRejects >= SIZE_REJECTS_BEFORE_DISTRUST) sizeTrusted = false;
        } else {
            sizeOnlyRejects = 0;
        }
    }

    private boolean palmSized(MotionEvent ev) {
        for (int i = 0; i < ev.getPointerCount(); i++) {
            if (ev.getToolType(i) == TOOL_TYPE_PALM) return true;
            if (!sizeTrusted || palmMm <= 0) continue;
            float mm = ev.getTouchMajor(i) / pxPerMm;
            if (mm > palmMm && mm < 90) return true;
        }
        return false;
    }

    private void reject(Stream s) {
        if (s.forwarded && !s.rejected) cancel(s);
        s.decided = true;
        s.rejected = true;
    }

    // Cancels a finger gesture already started in the app: no half-finished clicks or scrolls are left.
    private void cancel(Stream s) {
        if (s.forwarded && s.last != null) {
            MotionEvent c = MotionEvent.obtain(s.last);
            c.setAction(MotionEvent.ACTION_CANCEL);
            app.dispatch(c);
            c.recycle();
        }
        s.forwarded = false;
        s.decided = true;
        s.rejected = true;
    }

    private void cancelHands(long maxAgeMs, long now) {
        if (!enabled) return;
        for (Stream s : streams.values()) {
            if (s.forwarded && !s.rejected && now - s.downTime <= maxAgeMs) cancel(s);
        }
    }

    private static void release(Stream s) {
        if (s.last != null) s.last.recycle();
        if (s.lastPen != null) s.lastPen.recycle();
        s.last = null;
        s.lastPen = null;
    }
}
