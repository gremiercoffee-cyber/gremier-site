package il.co.gremiercoffee.cos

import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/** Supplies the widget's scrolling rows from the cached list. */
class CosListService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = Factory(applicationContext)

    private class Factory(private val c: Context) : RemoteViewsFactory {
        private var rows: List<Cos.Row> = emptyList()
        override fun onCreate() { rows = Cos.rows(c) }
        override fun onDataSetChanged() { rows = Cos.rows(c) }
        override fun onDestroy() {}
        override fun getCount() = rows.size
        override fun getViewTypeCount() = 2
        override fun getItemId(position: Int) = position.toLong()
        override fun hasStableIds() = false
        override fun getLoadingView(): RemoteViews? = null

        override fun getViewAt(position: Int): RemoteViews {
            val r = rows.getOrNull(position) ?: return RemoteViews(c.packageName, R.layout.row_header)
            if (r.header != null) {
                return RemoteViews(c.packageName, R.layout.row_header).apply { setTextViewText(R.id.header, r.header) }
            }
            return RemoteViews(c.packageName, R.layout.row_item).apply {
                setTextViewText(R.id.item_title, r.title)
                setTextViewText(R.id.item_sub, r.sub)
                setTextColor(R.id.item_title, c.getColor(if (r.high) R.color.danger else R.color.ink))
                setOnClickFillInIntent(R.id.check, Intent().putExtra("id", r.id).putExtra("action", "done"))
                setOnClickFillInIntent(R.id.text, Intent().putExtra("id", r.id).putExtra("action", "open"))
            }
        }
    }
}
