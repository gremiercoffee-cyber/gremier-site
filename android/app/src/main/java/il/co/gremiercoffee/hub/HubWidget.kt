package il.co.gremiercoffee.hub

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * 4×1 home-screen widget. Buttons come from the server (hub-api "widget_config"), 4 per page,
 * flipped with ‹ ›. Tapping a button opens a link,
 * asks for confirmation / a short form (QuickActionActivity), or runs the action directly.
 */
class HubWidget : AppWidgetProvider() {

    companion object {
        private const val ACT_PAGE = "il.co.gremiercoffee.hub.PAGE"
        private const val ACT_RUN = "il.co.gremiercoffee.hub.RUN"
        private const val ROWS = 3
        private const val COLS = 5
        private val ROW_IDS = intArrayOf(R.id.r0, R.id.r1, R.id.r2)
        /** [container, icon, label, sub] view ids for slot i (row-major, 3×5). */
        private fun slot(c: Context, i: Int): IntArray {
            val r = c.resources
            fun id(n: String) = r.getIdentifier(n, "id", c.packageName)
            return intArrayOf(id("b$i"), id("b${i}_icon"), id("b${i}_label"), id("b${i}_sub"))
        }

        /** Redraw every widget from the cache, then fetch fresh buttons/counts in the background. */
        fun refreshAll(c: Context, fetch: Boolean = true) {
            val mgr = AppWidgetManager.getInstance(c)
            val ids = mgr.getAppWidgetIds(ComponentName(c, HubWidget::class.java))
            ids.forEach { render(c, mgr, it) }
            if (fetch && Hub.key(c) != null) thread {
                runCatching { Hub.fetchConfig(c) }
                ids.forEach { render(c, mgr, it) }
            }
        }

        /** Rows × columns of fixed-size buttons that fit the widget as currently sized. */
        private fun grid(mgr: AppWidgetManager, id: Int): Pair<Int, Int> {
            val o = mgr.getAppWidgetOptions(id)
            val w = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250)   // portrait width
            val h = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 70)   // portrait height
            val cols = ((w - 44) / 64).coerceIn(1, COLS)   // 36dp arrows + padding, 64dp per button
            val rows = ((h - 20) / 60).coerceIn(1, ROWS)   // dots + padding, 60dp per button
            return rows to cols
        }

        fun render(c: Context, mgr: AppWidgetManager, id: Int) {
            val v = RemoteViews(c.packageName, R.layout.widget)
            val cfg = Hub.cachedConfig(c)
            val buttons: JSONArray = cfg?.optJSONArray("buttons") ?: JSONArray()
            val (rows, cols) = grid(mgr, id)
            val per = rows * cols
            val pages = maxOf(1, (buttons.length() + per - 1) / per)
            val page = Hub.page(c, id).coerceIn(0, pages - 1)

            if (Hub.key(c) == null || buttons.length() == 0) {
                // Not set up yet: one slot that opens the app.
                ROW_IDS.forEachIndexed { r, rid -> v.setViewVisibility(rid, if (r == 0) View.VISIBLE else View.GONE) }
                for (i in 0 until ROWS * COLS) v.setViewVisibility(slot(c, i)[0], if (i == 0) View.VISIBLE else View.GONE)
                v.setTextViewText(R.id.b0_icon, "☕")
                v.setTextViewText(R.id.b0_label, if (Hub.key(c) == null) "Set up" else "Loading…")
                v.setTextViewText(R.id.b0_sub, "Gremier Hub")
                v.setOnClickPendingIntent(R.id.b0, PendingIntent.getActivity(c, id * 1000 + 999, Intent(c, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
                v.setTextViewText(R.id.dots, "")
                mgr.updateAppWidget(id, v)
                return
            }

            val flash = Hub.flash(c)
            for (r in 0 until ROWS) {
                v.setViewVisibility(ROW_IDS[r], if (r < rows) View.VISIBLE else View.GONE)
                for (col in 0 until COLS) {
                    val sl = slot(c, r * COLS + col)
                    if (r >= rows || col >= cols) { v.setViewVisibility(sl[0], View.GONE); continue }
                    val idx = page * per + r * cols + col
                    if (idx >= buttons.length()) { v.setViewVisibility(sl[0], View.INVISIBLE); continue }
                    val b = buttons.getJSONObject(idx)
                    v.setViewVisibility(sl[0], View.VISIBLE)
                    val justDone = flash != null && flash.first == b.optString("id") && System.currentTimeMillis() - flash.second < 60_000
                    v.setTextViewText(sl[1], if (justDone) "✅" else b.optString("icon", "•"))
                    val badge = b.optInt("badge", 0)
                    v.setTextViewText(sl[2], b.optString("label") + if (badge > 0) " ($badge)" else "")
                    v.setTextViewText(sl[3], if (justDone) "done" else b.optString("sub", ""))
                    v.setOnClickPendingIntent(sl[0], buttonIntent(c, id, idx, b))
                }
            }
            // Everything fits on one page → no arrows or dots.
            v.setViewVisibility(R.id.prev, if (pages > 1) View.VISIBLE else View.INVISIBLE)
            v.setViewVisibility(R.id.next, if (pages > 1) View.VISIBLE else View.INVISIBLE)
            v.setTextViewText(R.id.dots, if (pages > 1) (0 until pages).joinToString(" ") { if (it == page) "●" else "○" } else "")
            v.setOnClickPendingIntent(R.id.prev, pageIntent(c, id, (page - 1 + pages) % pages))
            v.setOnClickPendingIntent(R.id.next, pageIntent(c, id, (page + 1) % pages))
            mgr.updateAppWidget(id, v)
        }

        private fun pageIntent(c: Context, id: Int, page: Int): PendingIntent {
            val i = Intent(c, HubWidget::class.java).setAction(ACT_PAGE)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).putExtra("page", page)
            return PendingIntent.getBroadcast(c, id * 1000 + 900 + page, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }

        private fun buttonIntent(c: Context, id: Int, idx: Int, b: JSONObject): PendingIntent {
            val req = id * 1000 + idx
            val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            return when (b.optString("kind")) {
                "open" -> PendingIntent.getActivity(c, req, Intent(Intent.ACTION_VIEW, Uri.parse(b.optString("url"))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), flags)
                "run" -> PendingIntent.getBroadcast(c, req, Intent(c, HubWidget::class.java).setAction(ACT_RUN).putExtra("button", b.toString()), flags)
                else -> PendingIntent.getActivity(c, req, Intent(c, QuickActionActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                    .putExtra("button", b.toString()), flags)
            }
        }
    }

    override fun onUpdate(c: Context, mgr: AppWidgetManager, ids: IntArray) = refreshAll(c)

    override fun onAppWidgetOptionsChanged(c: Context, mgr: AppWidgetManager, id: Int, o: Bundle) = render(c, mgr, id)

    override fun onReceive(c: Context, intent: Intent) {
        super.onReceive(c, intent)
        when (intent.action) {
            ACT_PAGE -> {
                val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 0)
                Hub.setPage(c, id, intent.getIntExtra("page", 0))
                render(c, AppWidgetManager.getInstance(c), id)
            }
            ACT_RUN -> {
                val b = JSONObject(intent.getStringExtra("button") ?: return)
                val pending = goAsync()
                thread {
                    try {
                        val body = (b.optJSONObject("args") ?: JSONObject()).put("action", b.getString("action"))
                        Hub.call(c, body)
                        Hub.setFlash(c, b.optString("id"))
                        val msg = b.optString("done_message", b.optString("label") + " ✓")
                        android.os.Handler(c.mainLooper).post { Toast.makeText(c, "✅ $msg", Toast.LENGTH_SHORT).show() }
                    } catch (e: Exception) {
                        android.os.Handler(c.mainLooper).post { Toast.makeText(c, e.message, Toast.LENGTH_LONG).show() }
                    } finally {
                        refreshAll(c)
                        pending.finish()
                    }
                }
            }
        }
    }
}
