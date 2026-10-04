package il.co.gremiercoffee.cos

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Talks to the Chief of Staff Worker (/api/widget) and keeps the last list for instant redraws. */
object Cos {
    const val APP_URL = "https://chief-of-staff.gremiercoffee.workers.dev"
    private const val PREFS = "cos"

    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun passcode(c: Context): String? = prefs(c).getString("passcode", null)
    fun setPasscode(c: Context, p: String?) = prefs(c).edit().putString("passcode", p).apply()
    fun cached(c: Context): JSONObject? = prefs(c).getString("widget", null)?.let { runCatching { JSONObject(it) }.getOrNull() }
    private fun save(c: Context, j: JSONObject) = prefs(c).edit().putString("widget", j.toString()).apply()

    class CosException(message: String) : Exception(message)

    private fun request(c: Context, method: String, path: String, body: JSONObject? = null, code: String? = null): JSONObject {
        val pass = code ?: passcode(c) ?: throw CosException("Open Chief of Staff and enter your passcode")
        val conn = (URL(APP_URL + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10000
            readTimeout = 20000
            setRequestProperty("Authorization", "Bearer $pass")
            setRequestProperty("Content-Type", "application/json")
            if (body != null) doOutput = true
        }
        try {
            if (body != null) conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val status = conn.responseCode
            val text = (if (status in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            if (status == 401) throw CosException("Passcode not accepted")
            if (status !in 200..299) throw CosException("Couldn't reach Chief of Staff ($status)")
            return runCatching { JSONObject(text) }.getOrElse { JSONObject() }
        } finally {
            conn.disconnect()
        }
    }

    /** Checks a passcode by loading the list with it. */
    fun verify(c: Context, code: String): Boolean = runCatching { request(c, "GET", "/api/widget", code = code) }.isSuccess

    fun fetch(c: Context): JSONObject {
        val j = request(c, "GET", "/api/widget")
        save(c, j)
        return j
    }

    fun markDone(c: Context, id: String) {
        removeLocally(c, id)
        request(c, "POST", "/api/widget/act", JSONObject().put("id", id).put("action", "done"))
    }

    /** Optimistic: the row disappears immediately, before the server answers. */
    private fun removeLocally(c: Context, id: String) {
        val j = cached(c) ?: return
        val sections = j.optJSONArray("sections") ?: return
        val kept = JSONArray()
        var removed = 0
        for (s in 0 until sections.length()) {
            val sec = sections.getJSONObject(s)
            val items = sec.optJSONArray("items") ?: JSONArray()
            val left = JSONArray()
            for (i in 0 until items.length()) {
                val it = items.getJSONObject(i)
                if (it.optString("id") == id) removed++ else left.put(it)
            }
            if (left.length() > 0) kept.put(JSONObject(sec.toString()).put("items", left))
        }
        j.put("sections", kept).put("count", maxOf(0, j.optInt("count") - removed))
        save(c, j)
    }

    /** Flattened rows for the list: section headers and items. */
    data class Row(val header: String?, val id: String, val title: String, val sub: String, val high: Boolean)

    fun rows(c: Context): List<Row> {
        val out = mutableListOf<Row>()
        val sections = cached(c)?.optJSONArray("sections") ?: return out
        for (s in 0 until sections.length()) {
            val sec = sections.getJSONObject(s)
            out += Row(sec.optString("title"), "", "", "", false)
            val items = sec.optJSONArray("items") ?: continue
            for (i in 0 until items.length()) {
                val it = items.getJSONObject(i)
                out += Row(null, it.optString("id"), it.optString("title"), it.optString("sub"), it.optBoolean("high"))
            }
        }
        return out
    }
}
