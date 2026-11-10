package com.takenote.notes;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.WebView;
import java.util.ArrayList;

/**
 * Tratto in corso disegnato da una vista Android sopra il WebView: il disegno non passa dal motore
 * del browser, che impiegherebbe diversi fotogrammi a mostrarlo. A penna sollevata i punti vanno
 * all'app web, che aggiunge il tratto alla pagina; questa vista lo cancella quando quello della
 * pagina è pronto a comparire, così non ci sono sfarfallii.
 *
 * Interviene solo se l'app l'ha abilitata e il tocco della penna cade su una pagina fuori dalle zone
 * riservate all'interfaccia; in tutti gli altri casi l'evento arriva al WebView come sempre.
 */
public class InkOverlayView extends View {

    private static final long CLEAR_FALLBACK_MS = 1500;
    // -1 è un id valido (eventi iniettati o virtuali): serve un valore che nessun dispositivo può avere
    private static final int NO_DEVICE = Integer.MIN_VALUE;

    private static final class Stroke {
        final int id;
        final Path path = new Path();
        final Paint paint;
        final RectF clip;

        Stroke(int id, Paint paint, RectF clip) {
            this.id = id;
            this.paint = paint;
            this.clip = clip;
        }
    }

    private final WebView webView;
    private final ArrayList<Stroke> strokes = new ArrayList<>();
    private final int[] webLoc = new int[2];
    private final int[] selfLoc = new int[2];

    private boolean enabled = false;
    private int color = Color.BLACK;
    private float width = 4f;
    private float dpr = 1f;
    private float[] pages = new float[0];
    private float[] excl = new float[0];

    private Stroke active;
    private int activePointer = -1;
    private int activeDevice = NO_DEVICE;
    private int otherDevice = NO_DEVICE;
    private boolean swallowing = false;
    private int nextId = 1;
    private float[] points = new float[2048];
    private int count = 0;
    private float lastX;
    private float lastY;

    public InkOverlayView(Context context, WebView webView) {
        super(context);
        this.webView = webView;
        setWillNotDraw(false);
        setClickable(false);
        setFocusable(false);
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
    }

    public void configure(boolean enabled, int color, float width, float dpr, float[] pages, float[] excl) {
        this.enabled = enabled;
        this.color = color;
        this.width = width;
        this.dpr = dpr > 0 ? dpr : 1f;
        this.pages = pages;
        this.excl = excl;
    }

    /** @return true se l'evento è stato consumato qui e non deve arrivare al WebView */
    public boolean handle(MotionEvent ev) {
        int action = ev.getActionMasked();
        int device = ev.getDeviceId();

        // tocchi di un altro dispositivo iniziati durante il tratto (il palmo): spariscono interi
        if (device == otherDevice) {
            if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) otherDevice = NO_DEVICE;
            return true;
        }
        if (swallowing && device != activeDevice) {
            if (action == MotionEvent.ACTION_DOWN) otherDevice = device;
            return true;
        }
        if (swallowing) {
            continueStroke(ev, action);
            if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) swallowing = false;
            return true;
        }

        if (!enabled || action != MotionEvent.ACTION_DOWN || ev.getToolType(0) != MotionEvent.TOOL_TYPE_STYLUS) return false;
        webView.getLocationInWindow(webLoc);
        getLocationInWindow(selfLoc);
        float cssX = (ev.getX() - webLoc[0]) / dpr;
        float cssY = (ev.getY() - webLoc[1]) / dpr;
        if (rectAt(excl, cssX, cssY) >= 0) return false;
        int page = rectAt(pages, cssX, cssY);
        if (page < 0) return false;

        startStroke(ev, page);
        swallowing = true;
        activeDevice = device;
        return true;
    }

    private static int rectAt(float[] rects, float x, float y) {
        for (int i = 0; i + 3 < rects.length; i += 4) {
            if (x >= rects[i] && x <= rects[i + 2] && y >= rects[i + 1] && y <= rects[i + 3]) return i;
        }
        return -1;
    }

    private void startStroke(MotionEvent ev, int page) {
        float ox = webLoc[0] - selfLoc[0];
        float oy = webLoc[1] - selfLoc[1];
        RectF clip = new RectF(
            pages[page] * dpr + ox,
            pages[page + 1] * dpr + oy,
            pages[page + 2] * dpr + ox,
            pages[page + 3] * dpr + oy
        );
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setStrokeJoin(Paint.Join.ROUND);
        paint.setStrokeWidth(width);
        paint.setColor(color);
        active = new Stroke(nextId++, paint, clip);
        strokes.add(active);
        activePointer = ev.getPointerId(0);
        count = 0;
        float x = ev.getX(), y = ev.getY();
        active.path.moveTo(x - selfLoc[0], y - selfLoc[1]);
        // segmento minuscolo: anche un tocco singolo lascia un puntino
        active.path.lineTo(x - selfLoc[0] + 0.01f, y - selfLoc[1]);
        store(x, y);
        lastX = x;
        lastY = y;
        emit("{phase:'down'}");
        invalidate();
    }

    private void continueStroke(MotionEvent ev, int action) {
        if (active == null) return;
        int index = ev.findPointerIndex(activePointer);
        if (index >= 0 && action == MotionEvent.ACTION_MOVE) {
            int history = ev.getHistorySize();
            for (int h = 0; h < history; h++) add(ev.getHistoricalX(index, h), ev.getHistoricalY(index, h));
            add(ev.getX(index), ev.getY(index));
            invalidate();
        }
        boolean penLifted = action == MotionEvent.ACTION_POINTER_UP && ev.getActionIndex() == index;
        if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL || penLifted) {
            if (index >= 0 && action != MotionEvent.ACTION_CANCEL) add(ev.getX(index), ev.getY(index));
            finishStroke();
        }
    }

    private void add(float x, float y) {
        float dx = x - lastX, dy = y - lastY;
        if (dx * dx + dy * dy < 0.25f) return;
        lastX = x;
        lastY = y;
        active.path.lineTo(x - selfLoc[0], y - selfLoc[1]);
        store(x, y);
    }

    private void store(float x, float y) {
        if (count + 2 > points.length) {
            float[] grown = new float[points.length * 2];
            System.arraycopy(points, 0, grown, 0, count);
            points = grown;
        }
        points[count++] = (x - webLoc[0]) / dpr;
        points[count++] = (y - webLoc[1]) / dpr;
    }

    private void finishStroke() {
        final Stroke done = active;
        active = null;
        activePointer = -1;
        StringBuilder json = new StringBuilder(count * 8 + 48);
        json.append("{phase:'up',id:").append(done.id).append(",points:[");
        for (int i = 0; i < count; i++) {
            if (i > 0) json.append(',');
            json.append(Math.round(points[i] * 100f) / 100f);
        }
        json.append("]}");
        emit(json.toString());
        invalidate();
        // rete di sicurezza: un tratto non deve mai restare sopra la pagina
        postDelayed(() -> remove(done.id), CLEAR_FALLBACK_MS);
    }

    private void emit(String detail) {
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('nativeink',{detail:" + detail + "}))", null);
    }

    /** L'app ha aggiunto il tratto alla pagina: lo si cancella qui quando quello è pronto a comparire. */
    public void committed(final int id) {
        webView.postVisualStateCallback(
            id,
            new WebView.VisualStateCallback() {
                @Override
                public void onComplete(long requestId) {
                    remove(id);
                }
            }
        );
    }

    private void remove(int id) {
        for (int i = strokes.size() - 1; i >= 0; i--) {
            if (strokes.get(i).id == id && strokes.get(i) != active) {
                strokes.remove(i);
                invalidate();
                return;
            }
        }
    }

    @Override
    protected void onDraw(Canvas canvas) {
        for (int i = 0; i < strokes.size(); i++) {
            Stroke s = strokes.get(i);
            canvas.save();
            canvas.clipRect(s.clip);
            canvas.drawPath(s.path, s.paint);
            canvas.restore();
        }
    }
}
