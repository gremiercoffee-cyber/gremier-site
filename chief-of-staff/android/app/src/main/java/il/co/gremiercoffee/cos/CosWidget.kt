package il.co.gremiercoffee.cos

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import kotlin.concurrent.thread

/**
 * Resizable home-screen widget with three pages: To do, People (replies you owe), Calendar
 * (three day columns of event boxes). Everything is handled on the home screen: ○ marks done,
 * tapping an item or event opens a small pop-up, + and Talk open pop-ups too.
 */
class CosWidget : AppWidgetProvider() {

    companion object {
        const val ACT_REFRESH = "il.co.gremiercoffee.cos.REFRESH"
        private const val ACT_PAGE = "il.co.gremiercoffee.cos.PAGE"
        private const val ACT_FILTER = "il.co.gremiercoffee.cos.FILTER"
        private const val ACT_DAYS = "il.co.gremiercoffee.cos.DAYS"
        /** While the screen is on (non-wakeup alarm), refresh about this often. */
        private const val REFRESH_MS = 5 * 60 * 1000L

        private val TABS = intArrayOf(R.id.tab0, R.id.tab1, R.id.tab2)
        private val FILTERS = mapOf("all" to R.id.f_all, "coffee" to R.id.f_coffee, "yeshiva" to R.id.f_yeshiva, "personal" to R.id.f_personal)
        private val DAYS = intArrayOf(R.id.day0, R.id.day1, R.id.day2)
        private val DAY_LABELS = intArrayOf(R.id.day0_label, R.id.day1_label, R.id.day2_label)

        private fun ids(c: Context): IntArray =
            AppWidgetManager.getInstance(c).getAppWidgetIds(ComponentName(c, CosWidget::class.java))

        /** Redraw from the cached data right away; optionally fetch fresh data in the background. */
        fun refreshAll(c: Context, fetch: Boolean = true) {
            val mgr = AppWidgetManager.getInstance(c)
            val all = ids(c)
            redraw(c, mgr, all, null)
            if (fetch && Cos.passcode(c) != null) thread {
                val err = runCatching { Cos.fetch(c) }.exceptionOrNull()?.message
                redraw(c, mgr, all, err)
            }
        }

        private fun redraw(c: Context, mgr: AppWidgetManager, all: IntArray, err: String?) {
            all.forEach { render(c, mgr, it, err) }
            mgr.notifyAppWidgetViewDataChanged(all, R.id.list)
            DAYS.forEach { mgr.notifyAppWidgetViewDataChanged(all, it) }
        }

        private fun flags(mutable: Boolean = false) =
            PendingIntent.FLAG_UPDATE_CURRENT or (if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE)

        private fun broadcast(c: Context, req: Int, action: String, extra: String = ""): PendingIntent =
            PendingIntent.getBroadcast(c, req, Intent(c, CosWidget::class.java).setAction(action).putExtra("v", extra), flags())

        private fun popup(c: Context, req: Int, mode: String): PendingIntent =
            PendingIntent.getActivity(c, req, Intent(c, PopupActivity::class.java).putExtra("mode", mode)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK), flags())

        private fun adapter(c: Context, widgetId: Int, kind: String): Intent =
            Intent(c, CosListService::class.java).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId).putExtra("kind", kind).also {
                it.data = Uri.parse(it.toUri(Intent.URI_INTENT_SCHEME)) // unique per widget + list
            }

        fun render(c: Context, mgr: AppWidgetManager, id: Int, error: String?) {
            val v = RemoteViews(c.packageName, R.layout.widget)
            val data = Cos.cached(c)
            val page = Cos.page(c)
            val ink = c.getColor(R.color.ink)
            val muted = c.getColor(R.color.muted)

            // Header
            if (Cos.passcode(c) == null) {
                v.setTextViewText(R.id.subtitle, "Tap here to set up")
                v.setOnClickPendingIntent(R.id.title, PendingIntent.getActivity(c, 1, Intent(c, MainActivity::class.java), flags()))
            } else {
                val next = data?.optString("next_event")?.takeIf { it.isNotBlank() && it != "null" }
                v.setTextViewText(R.id.subtitle, when {
                    error != null && data == null -> error
                    next != null -> "Next: $next"
                    else -> "Nothing scheduled soon"
                })
            }
            v.setOnClickPendingIntent(R.id.talk, popup(c, 3, "talk"))
            v.setOnClickPendingIntent(R.id.add, popup(c, 4, "add"))
            v.setOnClickPendingIntent(R.id.refresh, broadcast(c, 5, ACT_REFRESH))

            // Tabs with counts: Agenda (tasks + meetings) and People (replies you owe)
            val counts = intArrayOf(Cos.agendaCount(c), data?.optInt("people_count") ?: 0)
            val names = arrayOf("Agenda", "People")
            v.setViewVisibility(R.id.tab2, View.GONE)
            TABS.take(2).forEachIndexed { i, tab ->
                v.setTextViewText(tab, if (counts[i] > 0) "${names[i]} ${counts[i]}" else names[i])
                v.setInt(tab, "setBackgroundResource", if (i == page) R.drawable.tab_on else 0)
                v.setTextColor(tab, if (i == page) c.getColor(R.color.bg) else muted)
                v.setOnClickPendingIntent(tab, broadcast(c, 10 + i, ACT_PAGE, i.toString()))
            }

            // Area filters (both pages; meetings on the Agenda always show)
            val filter = Cos.catFilter(c)
            v.setViewVisibility(R.id.filters, View.VISIBLE)
            FILTERS.entries.forEachIndexed { i, (key, view) ->
                v.setInt(view, "setBackgroundResource", if (key == filter) R.drawable.pill else 0)
                v.setTextColor(view, if (key == filter) c.getColor(R.color.accent) else muted)
                v.setOnClickPendingIntent(view, broadcast(c, 20 + i, ACT_FILTER, key))
            }

            // Day arrows (Agenda only)
            val dayNav = if (page == 0) View.VISIBLE else View.GONE
            v.setViewVisibility(R.id.prev, dayNav)
            v.setViewVisibility(R.id.next, dayNav)
            v.setOnClickPendingIntent(R.id.prev, broadcast(c, 30, ACT_DAYS, "-3"))
            v.setOnClickPendingIntent(R.id.next, broadcast(c, 31, ACT_DAYS, "3"))

            // Taps inside lists are handled by TapActivity (done / pop-up), never the full app.
            val template = PendingIntent.getActivity(c, 6, Intent(c, TapActivity::class.java), flags(mutable = true))

            if (page == 0) {
                v.setViewVisibility(R.id.list, View.GONE)
                v.setViewVisibility(R.id.cal, View.VISIBLE)
                v.setViewVisibility(R.id.empty, View.GONE)
                DAYS.forEachIndexed { col, list ->
                    val day = Cos.day(c, col)
                    val shown = Cos.rows(c, "day$col").size
                    v.setTextViewText(DAY_LABELS[col], (day?.optString("label") ?: "") + if (shown == 0) " · free" else "")
                    v.setTextColor(DAY_LABELS[col], if (col == 0 && Cos.dayOffset(c) == 0) ink else muted)
                    v.setRemoteAdapter(list, adapter(c, id, "day$col"))
                    v.setPendingIntentTemplate(list, template)
                }
            } else {
                v.setViewVisibility(R.id.cal, View.GONE)
                v.setViewVisibility(R.id.list, View.VISIBLE)
                v.setRemoteAdapter(R.id.list, adapter(c, id, "people"))
                v.setPendingIntentTemplate(R.id.list, template)
                val empty = Cos.passcode(c) != null && Cos.rows(c, "people").isEmpty()
                v.setTextViewText(R.id.empty, "No one is waiting on you ✨")
                v.setViewVisibility(R.id.empty, if (empty) View.VISIBLE else View.GONE)
            }
            mgr.updateAppWidget(id, v)
        }

        /** Partial update for filter / day changes: restyle chips, relabel columns, reload the lists. */
        fun quickUpdate(c: Context) {
            val mgr = AppWidgetManager.getInstance(c)
            val all = ids(c)
            val filter = Cos.catFilter(c)
            val muted = c.getColor(R.color.muted)
            all.forEach { id ->
                val v = RemoteViews(c.packageName, R.layout.widget)
                FILTERS.forEach { (key, view) ->
                    v.setInt(view, "setBackgroundResource", if (key == filter) R.drawable.pill else 0)
                    v.setTextColor(view, if (key == filter) c.getColor(R.color.accent) else muted)
                }
                DAYS.indices.forEach { col ->
                    val shown = Cos.rows(c, "day$col").size
                    v.setTextViewText(DAY_LABELS[col], (Cos.day(c, col)?.optString("label") ?: "") + if (shown == 0) " · free" else "")
                }
                v.setTextViewText(R.id.tab0, Cos.agendaCount(c).let { n -> if (n > 0) "Agenda $n" else "Agenda" })
                mgr.partiallyUpdateAppWidget(id, v)
            }
            mgr.notifyAppWidgetViewDataChanged(all, R.id.list)
            DAYS.forEach { mgr.notifyAppWidgetViewDataChanged(all, it) }
        }

        fun schedule(c: Context, on: Boolean) {
            val am = c.getSystemService(AlarmManager::class.java)
            val pi = broadcast(c, 7, ACT_REFRESH)
            if (on) am.setInexactRepeating(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + REFRESH_MS, REFRESH_MS, pi)
            else am.cancel(pi)
        }
    }

    override fun onUpdate(c: Context, mgr: AppWidgetManager, appWidgetIds: IntArray) {
        schedule(c, true)
        refreshAll(c)
    }

    override fun onEnabled(c: Context) = schedule(c, true)
    override fun onDisabled(c: Context) = schedule(c, false)

    override fun onReceive(c: Context, intent: Intent) {
        super.onReceive(c, intent)
        val v = intent.getStringExtra("v").orEmpty()
        when (intent.action) {
            ACT_REFRESH -> refreshAll(c)
            ACT_PAGE -> { Cos.setPage(c, v.toIntOrNull() ?: 0); refreshAll(c, fetch = false) }
            ACT_FILTER -> { Cos.setCatFilter(c, v); quickUpdate(c) }
            ACT_DAYS -> { Cos.setDayOffset(c, Cos.dayOffset(c) + (v.toIntOrNull() ?: 0)); quickUpdate(c) }
        }
    }
}
