package il.co.gremiercoffee.cos

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** Talks to the Chief of Staff Worker and keeps the last widget data for instant redraws. */
object Cos {
    const val APP_URL = "https://chief-of-staff.gremiercoffee.workers.dev"
    private const val PREFS = "cos"

    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun passcode(c: Context): String? = prefs(c).getString("passcode", null)
    fun setPasscode(c: Context, p: String?) = prefs(c).edit().putString("passcode", p).apply()
    fun cached(c: Context): JSONObject? = prefs(c).getString("widget", null)?.let { runCatching { JSONObject(it) }.getOrNull() }
    private fun save(c: Context, j: JSONObject) = prefs(c).edit().putString("widget", j.toString()).apply()

    /** 0 = To do, 1 = People, 2 = Calendar. */
    fun page(c: Context) = prefs(c).getInt("page", 0)
    fun setPage(c: Context, p: Int) = prefs(c).edit().putInt("page", p).putInt("day_offset", 0).apply()
    /** First day shown on the Calendar page (0, 3 or 6 → steps of three days). */
    fun dayOffset(c: Context) = prefs(c).getInt("day_offset", 0)
    fun setDayOffset(c: Context, d: Int) = prefs(c).edit().putInt("day_offset", d.coerceIn(0, 4)).apply()

    /** Area filter for To do / People: all | coffee | yeshiva | personal. */
    fun catFilter(c: Context) = prefs(c).getString("cat", "all") ?: "all"
    fun setCatFilter(c: Context, f: String) = prefs(c).edit().putString("cat", f).apply()
    private fun shows(c: Context, item: JSONObject): Boolean {
        val f = catFilter(c)
        val cat = item.optString("category").takeIf { it.isNotBlank() && it != "null" }
        return f == "all" || cat == null || cat == f // unfiled items always show, so they get filed
    }

    class CosException(message: String) : Exception(message)

    private fun open(c: Context, method: String, path: String, code: String? = null): HttpURLConnection {
        val pass = code ?: passcode(c) ?: throw CosException("Open Chief of Staff and enter your passcode")
        return (URL(APP_URL + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10000
            readTimeout = 60000
            setRequestProperty("Authorization", "Bearer $pass")
        }
    }

    private fun read(conn: HttpURLConnection): JSONObject {
        try {
            val status = conn.responseCode
            val text = (if (status in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            val j = runCatching { JSONObject(text) }.getOrElse { JSONObject() }
            if (status == 401) throw CosException("Passcode not accepted")
            if (status !in 200..299) throw CosException(j.optString("error", "Couldn't reach Chief of Staff ($status)"))
            return j
        } finally {
            conn.disconnect()
        }
    }

    private fun json(c: Context, method: String, path: String, body: JSONObject? = null, code: String? = null): JSONObject {
        val conn = open(c, method, path, code)
        if (body != null) {
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
        }
        return read(conn)
    }

    fun verify(c: Context, code: String): Boolean = runCatching { json(c, "GET", "/api/widget", code = code) }.isSuccess

    fun fetch(c: Context): JSONObject = json(c, "GET", "/api/widget").also { save(c, it) }

    /** done | notneeded | snooze1h | tomorrow. Returns a short confirmation. */
    fun act(c: Context, id: String, action: String): String {
        if (action == "done" || action == "notneeded") removeLocally(c, id)
        if (action.startsWith("cat:")) setCategoryLocally(c, id, action.removePrefix("cat:"))
        return json(c, "POST", "/api/widget/act", JSONObject().put("id", id).put("action", action)).optString("message", "Done")
    }

    /** One message to the Chief of Staff; returns its reply. */
    fun chat(c: Context, text: String, mode: String = "text"): String =
        json(c, "POST", "/api/chat", JSONObject().put("text", text).put("mode", mode))
            .optJSONObject("reply")?.optString("content").orEmpty()

    fun transcribe(c: Context, audio: File): String {
        val boundary = "cos" + System.currentTimeMillis()
        val conn = open(c, "POST", "/api/transcribe").apply {
            doOutput = true
            setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
        }
        conn.outputStream.use { out ->
            out.write("--$boundary\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"voice.m4a\"\r\nContent-Type: audio/mp4\r\n\r\n".toByteArray())
            audio.inputStream().use { it.copyTo(out) }
            out.write("\r\n--$boundary--\r\n".toByteArray())
        }
        return read(conn).optString("text")
    }

    /** Optimistic: the row disappears immediately, before the server answers. */
    private fun removeLocally(c: Context, id: String) {
        val j = cached(c) ?: return
        var removed = 0
        val todo = j.optJSONArray("todo") ?: JSONArray()
        val keptSections = JSONArray()
        for (s in 0 until todo.length()) {
            val sec = todo.getJSONObject(s)
            val left = filter(sec.optJSONArray("items")) { it.optString("id") != id }
            removed += (sec.optJSONArray("items")?.length() ?: 0) - left.length()
            if (left.length() > 0) keptSections.put(JSONObject(sec.toString()).put("items", left))
        }
        val people = j.optJSONArray("people") ?: JSONArray()
        val keptPeople = filter(people) { it.optString("id") != id }
        val removedPeople = people.length() - keptPeople.length()
        j.put("todo", keptSections).put("people", keptPeople)
            .put("todo_count", maxOf(0, j.optInt("todo_count") - removed))
            .put("people_count", maxOf(0, j.optInt("people_count") - removedPeople))
            .put("count", maxOf(0, j.optInt("count") - removed - removedPeople))
        save(c, j)
    }

    private fun setCategoryLocally(c: Context, id: String, cat: String) {
        val j = cached(c) ?: return
        find(c, id) // ensure present
        fun fix(a: JSONArray?) { if (a != null) for (i in 0 until a.length()) a.getJSONObject(i).let { if (it.optString("id") == id) it.put("category", cat) } }
        j.optJSONArray("todo")?.let { for (s in 0 until it.length()) fix(it.getJSONObject(s).optJSONArray("items")) }
        fix(j.optJSONArray("people"))
        save(c, j)
    }

    private fun filter(a: JSONArray?, keep: (JSONObject) -> Boolean): JSONArray {
        val out = JSONArray()
        if (a != null) for (i in 0 until a.length()) a.getJSONObject(i).let { if (keep(it)) out.put(it) }
        return out
    }

    /** A list row: a section header, a task/person item, or a calendar event. */
    data class Row(val header: String? = null, val item: JSONObject? = null, val event: JSONObject? = null)

    /** Rows for a list: "todo", "people", or "day0".."day2" (relative to the calendar offset). */
    fun rows(c: Context, kind: String): List<Row> {
        val j = cached(c) ?: return emptyList()
        val out = mutableListOf<Row>()
        when {
            kind == "todo" -> j.optJSONArray("todo")?.let { secs ->
                for (s in 0 until secs.length()) {
                    val sec = secs.getJSONObject(s)
                    val items = sec.optJSONArray("items") ?: continue
                    val visible = (0 until items.length()).map { items.getJSONObject(it) }.filter { shows(c, it) }
                    if (visible.isEmpty()) continue
                    out += Row(header = sec.optString("title"))
                    visible.forEach { out += Row(item = it) }
                }
            }
            kind == "people" -> j.optJSONArray("people")?.let { for (i in 0 until it.length()) it.getJSONObject(i).let { o -> if (shows(c, o)) out += Row(item = o) } }
            kind.startsWith("day") -> day(c, kind.removePrefix("day").toInt())?.optJSONArray("events")?.let {
                for (i in 0 until it.length()) out += Row(event = it.getJSONObject(i))
            }
        }
        return out
    }

    fun day(c: Context, column: Int): JSONObject? = cached(c)?.optJSONArray("days")?.optJSONObject(dayOffset(c) + column)

    /** Finds an item or event by id in the cached data (for the detail pop-up). */
    fun find(c: Context, id: String): JSONObject? {
        val j = cached(c) ?: return null
        fun scan(a: JSONArray?): JSONObject? {
            if (a != null) for (i in 0 until a.length()) a.getJSONObject(i).let { if (it.optString("id") == id) return it }
            return null
        }
        j.optJSONArray("todo")?.let { for (s in 0 until it.length()) scan(it.getJSONObject(s).optJSONArray("items"))?.let { f -> return f } }
        scan(j.optJSONArray("people"))?.let { return it }
        j.optJSONArray("days")?.let { for (d in 0 until it.length()) scan(it.getJSONObject(d).optJSONArray("events"))?.let { f -> return f } }
        return null
    }
}
