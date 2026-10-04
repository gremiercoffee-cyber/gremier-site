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
 * Resizable home-screen widget (4×2 by default) listing only unfinished things, grouped
 * (Waiting on you / Overdue / Today / Coming up / Anytime). Tapping ○ marks an item done.
 */
class CosWidget : AppWidgetProvider() {

    companion object {
        const val ACT_REFRESH = "il.co.gremiercoffee.cos.REFRESH"
        private const val REFRESH_MS = 15 * 60 * 1000L

        private fun ids(c: Context): IntArray =
            AppWidgetManager.getInstance(c).getAppWidgetIds(ComponentName(c, CosWidget::class.java))

        /** Redraw from the cached list right away; optionally fetch a fresh one in the background. */
        fun refreshAll(c: Context, fetch: Boolean = true) {
            val mgr = AppWidgetManager.getInstance(c)
            val all = ids(c)
            all.forEach { render(c, mgr, it, null) }
            mgr.notifyAppWidgetViewDataChanged(all, R.id.list)
            if (fetch && Cos.passcode(c) != null) thread {
                val err = runCatching { Cos.fetch(c) }.exceptionOrNull()?.message
                all.forEach { render(c, mgr, it, err) }
                mgr.notifyAppWidgetViewDataChanged(all, R.id.list)
            }
        }

        private fun open(c: Context, req: Int, url: String): PendingIntent =
            PendingIntent.getActivity(c, req, Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

        fun render(c: Context, mgr: AppWidgetManager, id: Int, error: String?) {
            val v = RemoteViews(c.packageName, R.layout.widget)
            val data = Cos.cached(c)

            if (Cos.passcode(c) == null) {
                v.setTextViewText(R.id.subtitle, "Tap to set up")
                v.setOnClickPendingIntent(R.id.head, PendingIntent.getActivity(c, 1, Intent(c, MainActivity::class.java),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            } else {
                val count = data?.optInt("count") ?: 0
                val next = data?.optString("next_event")?.takeIf { it.isNotBlank() && it != "null" }
                val sub = when {
                    error != null && data == null -> error
                    count == 0 -> next?.let { "Nothing open · Next: $it" } ?: "Nothing open"
                    else -> "$count open" + (next?.let { " · Next: $it" } ?: "")
                }
                v.setTextViewText(R.id.subtitle, sub)
                v.setOnClickPendingIntent(R.id.head, open(c, 2, Cos.APP_URL))
            }
            v.setOnClickPendingIntent(R.id.talk, open(c, 3, "${Cos.APP_URL}/?voice=1"))
            v.setOnClickPendingIntent(R.id.add, open(c, 4, "${Cos.APP_URL}/?type=1"))
            v.setOnClickPendingIntent(R.id.refresh, PendingIntent.getBroadcast(c, 5,
                Intent(c, CosWidget::class.java).setAction(ACT_REFRESH), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))

            // The scrolling list; each row fills in this template (TapActivity does the work).
            val svc = Intent(c, CosListService::class.java)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
            svc.data = Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME))
            v.setRemoteAdapter(R.id.list, svc)
            v.setEmptyView(R.id.list, R.id.empty)
            v.setPendingIntentTemplate(R.id.list, PendingIntent.getActivity(c, 6, Intent(c, TapActivity::class.java),
                PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            v.setViewVisibility(R.id.empty, if ((data?.optInt("count") ?: 0) == 0 && Cos.passcode(c) != null) View.VISIBLE else View.GONE)
            mgr.updateAppWidget(id, v)
        }

        private fun schedule(c: Context, on: Boolean) {
            val am = c.getSystemService(AlarmManager::class.java)
            val pi = PendingIntent.getBroadcast(c, 7, Intent(c, CosWidget::class.java).setAction(ACT_REFRESH),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
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
        if (intent.action == ACT_REFRESH) refreshAll(c)
    }
}
