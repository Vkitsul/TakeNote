package com.takenote.notes;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.os.Build;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.WebView;
import androidx.input.motionprediction.MotionEventPredictor;
import java.util.ArrayList;

/**
 * Tratto in corso disegnato da una vista Android sopra il WebView: il disegno non passa dal motore
 * del browser, che impiegherebbe diversi fotogrammi a mostrarlo. A penna sollevata i punti vanno
 * all'app web, che aggiunge il tratto alla pagina; questa vista lo cancella quando quello della
 * pagina è pronto a comparire, così non ci sono sfarfallii.
 *
 * Riceve da InputRouter solo eventi della penna. Interviene se l'app l'ha abilitata e il tocco cade
 * su una pagina fuori dalle zone riservate all'interfaccia; altrimenti l'evento va al WebView.
 *
 * Il tratto è una curva che passa per i punti medi dei campioni (stessa costruzione di
 * polylinePath in ink.js, così prima e dopo il rilascio coincidono). La punta può essere allungata
 * di qualche millisecondo con la previsione del movimento: è solo disegnata, mai salvata.
 */
public class InkOverlayView extends View {

    private static final long CLEAR_FALLBACK_MS = 1500;
    private static final int CHUNK_POINTS = 48;
    private static final float MAX_PREDICTION_DP = 28f;

    private static final class Stroke {
        final int id;
        final Paint paint;
        final int alpha;
        final RectF clip;
        // pezzi già chiusi del tratto: non cambiano più, così ogni fotogramma ricalcola solo la coda
        final ArrayList<Path> frozen = new ArrayList<>();
        Path tail = new Path();
        int tailPoints;

        Stroke(int id, Paint paint, int alpha, RectF clip) {
            this.id = id;
            this.paint = paint;
            this.alpha = alpha;
            this.clip = clip;
        }
    }

    private final WebView webView;
    private final ArrayList<Stroke> strokes = new ArrayList<>();
    private final int[] webLoc = new int[2];
    private final int[] selfLoc = new int[2];
    private final Path tip = new Path();
    private final MotionEventPredictor predictor;
    private final float maxPrediction;

    private boolean enabled = false;
    private boolean predict = true;
    private int color = Color.BLACK;
    private float width = 4f;
    private float dpr = 1f;
    private float[] pages = new float[0];
    private float[] excl = new float[0];

    private Stroke active;
    private int nextId = 1;
    private float[] points = new float[2048];
    private int count = 0;
    // ultimo campione e ultimo punto medio, in coordinate di questa vista
    private float lastX;
    private float lastY;
    private float midX;
    private float midY;
    private int samples;
    private float[] predicted = new float[32];
    private int predictedCount = 0;

    public InkOverlayView(Context context, WebView webView) {
        super(context);
        this.webView = webView;
        this.predictor = MotionEventPredictor.newInstance(this);
        this.maxPrediction = MAX_PREDICTION_DP * context.getResources().getDisplayMetrics().density;
        setWillNotDraw(false);
        setClickable(false);
        setFocusable(false);
        setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
        if (Build.VERSION.SDK_INT >= 35) setRequestedFrameRate(REQUESTED_FRAME_RATE_CATEGORY_HIGH);
    }

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        // campioni consegnati appena arrivano, senza aspettare il fotogramma successivo
        if (Build.VERSION.SDK_INT >= 30) requestUnbufferedDispatch(InputDevice.SOURCE_CLASS_POINTER);
    }

    public void configure(boolean enabled, int color, float width, float dpr, float[] pages, float[] excl, boolean predict) {
        this.enabled = enabled;
        this.color = color;
        this.width = width;
        this.dpr = dpr > 0 ? dpr : 1f;
        this.pages = pages;
        this.excl = excl;
        this.predict = predict;
    }

    /** @return true se il tratto della penna è gestito qui e non deve arrivare al WebView */
    public boolean handle(MotionEvent ev) {
        int action = ev.getActionMasked();
        if (active != null) {
            continueStroke(ev, action);
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
        // il colore è sempre pieno: la trasparenza (evidenziatore) si applica all'intero tratto in onDraw
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setStrokeJoin(Paint.Join.ROUND);
        paint.setStrokeWidth(width);
        paint.setColor(color | 0xFF000000);
        active = new Stroke(nextId++, paint, Color.alpha(color), clip);
        strokes.add(active);
        count = 0;
        samples = 1;
        predictedCount = 0;
        float x = ev.getX(), y = ev.getY();
        lastX = midX = x - selfLoc[0];
        lastY = midY = y - selfLoc[1];
        active.tail.moveTo(lastX, lastY);
        active.tailPoints = 0;
        store(x, y);
        if (predict) predictor.record(ev);
        emit("{phase:'down'}");
        invalidate();
    }

    private void continueStroke(MotionEvent ev, int action) {
        if (predict) predictor.record(ev);
        if (action == MotionEvent.ACTION_MOVE) {
            int history = ev.getHistorySize();
            for (int h = 0; h < history; h++) add(ev.getHistoricalX(h), ev.getHistoricalY(h));
            add(ev.getX(), ev.getY());
            updatePrediction();
            invalidate();
        } else if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
            if (action == MotionEvent.ACTION_UP) add(ev.getX(), ev.getY());
            finishStroke();
        }
    }

    private void add(float x, float y) {
        float vx = x - selfLoc[0], vy = y - selfLoc[1];
        float dx = vx - lastX, dy = vy - lastY;
        if (dx * dx + dy * dy < 0.25f) return;
        float mx = (lastX + vx) / 2f, my = (lastY + vy) / 2f;
        Stroke s = active;
        if (samples == 1) s.tail.lineTo(mx, my);
        else s.tail.quadTo(lastX, lastY, mx, my);
        if (++s.tailPoints >= CHUNK_POINTS) {
            s.frozen.add(s.tail);
            s.tail = new Path();
            s.tail.moveTo(mx, my);
            s.tailPoints = 0;
        }
        lastX = vx;
        lastY = vy;
        midX = mx;
        midY = my;
        samples++;
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

    // Punti previsti oltre la punta: accorciano il ritardo percepito. Scartati se troppo lontani.
    private void updatePrediction() {
        predictedCount = 0;
        if (!predict) return;
        MotionEvent p = predictor.predict();
        if (p == null) return;
        float px = lastX, py = lastY, length = 0;
        int n = p.getHistorySize();
        for (int h = 0; h <= n && predictedCount + 2 <= predicted.length; h++) {
            float x = (h < n ? p.getHistoricalX(h) : p.getX()) - selfLoc[0];
            float y = (h < n ? p.getHistoricalY(h) : p.getY()) - selfLoc[1];
            length += (float) Math.hypot(x - px, y - py);
            if (length > maxPrediction) break;
            predicted[predictedCount++] = x;
            predicted[predictedCount++] = y;
            px = x;
            py = y;
        }
        p.recycle();
    }

    private void finishStroke() {
        final Stroke done = active;
        // chiude la curva sull'ultimo campione reale
        done.tail.lineTo(lastX + (samples == 1 ? 0.01f : 0f), lastY);
        active = null;
        predictedCount = 0;
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
            int save = s.alpha < 255 ? canvas.saveLayerAlpha(s.clip, s.alpha) : canvas.save();
            canvas.clipRect(s.clip);
            for (int k = 0; k < s.frozen.size(); k++) canvas.drawPath(s.frozen.get(k), s.paint);
            canvas.drawPath(s.tail, s.paint);
            if (s == active) {
                // dal punto medio all'ultimo campione, più la punta prevista
                tip.rewind();
                tip.moveTo(midX, midY);
                tip.lineTo(lastX + (samples == 1 ? 0.01f : 0f), lastY);
                for (int k = 0; k + 1 < predictedCount; k += 2) tip.lineTo(predicted[k], predicted[k + 1]);
                canvas.drawPath(tip, s.paint);
            }
            canvas.restoreToCount(save);
        }
    }
}
