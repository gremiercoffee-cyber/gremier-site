package il.co.gremiercoffee.cos

import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/** Rows for one of the widget's lists: "todo", "people", or a calendar day column "day0".."day2". */
class CosListService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
        Factory(applicationContext, intent.getStringExtra("kind") ?: "todo")

    private class Factory(private val c: Context, private val kind: String) : RemoteViewsFactory {
        private var rows: List<Cos.Row> = emptyList()
        override fun onCreate() { rows = Cos.rows(c, kind) }
        override fun onDataSetChanged() { rows = Cos.rows(c, kind) }
        override fun onDestroy() {}
        override fun getCount() = rows.size
        override fun getViewTypeCount() = 3
        override fun getItemId(position: Int) = position.toLong()
        override fun hasStableIds() = false
        override fun getLoadingView(): RemoteViews? = null

        private fun tap(action: String, id: String) = Intent().putExtra("action", action).putExtra("id", id)

        override fun getViewAt(position: Int): RemoteViews {
            val r = rows.getOrNull(position) ?: return RemoteViews(c.packageName, R.layout.row_header)
            r.header?.let { h ->
                return RemoteViews(c.packageName, R.layout.row_header).apply { setTextViewText(R.id.header, h) }
            }
            r.event?.let { e ->
                return RemoteViews(c.packageName, R.layout.row_event).apply {
                    setTextViewText(R.id.ev_time, e.optString("time"))
                    setTextViewText(R.id.ev_title, e.optString("title"))
                    val place = e.optString("location")
                    setTextViewText(R.id.ev_place, place)
                    setViewVisibility(R.id.ev_place, if (place.isBlank()) View.GONE else View.VISIBLE)
                    setOnClickFillInIntent(R.id.event_box, tap("event", e.optString("id")))
                }
            }
            val it = r.item!!
            val id = it.optString("id")
            val cat = it.optString("category").takeIf { s -> s.isNotBlank() && s != "null" }
            val icon = when (cat) { "coffee" -> "☕ "; "yeshiva" -> "📚 "; "personal" -> "🏠 "; else -> "" }
            return RemoteViews(c.packageName, R.layout.row_item).apply {
                setTextViewText(R.id.item_title, it.optString("title"))
                setTextViewText(R.id.item_sub, icon + it.optString("sub"))
                setTextColor(R.id.item_title, c.getColor(if (it.optBoolean("high")) R.color.danger else R.color.ink))
                setViewVisibility(R.id.ask, if (cat == null) View.VISIBLE else View.GONE)
                setOnClickFillInIntent(R.id.check, tap("done", id))
                setOnClickFillInIntent(R.id.item_title, tap("item", id))
                setOnClickFillInIntent(R.id.item_sub, tap("item", id))
                setOnClickFillInIntent(R.id.cat_coffee, tap("cat:coffee", id))
                setOnClickFillInIntent(R.id.cat_yeshiva, tap("cat:yeshiva", id))
                setOnClickFillInIntent(R.id.cat_personal, tap("cat:personal", id))
            }
        }
    }
}
