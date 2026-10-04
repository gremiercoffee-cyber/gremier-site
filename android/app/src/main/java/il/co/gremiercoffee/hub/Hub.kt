package il.co.gremiercoffee.hub

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Talks to the Gremier Hub API (supabase/functions/hub-api, docs/HUB_API.md). */
object Hub {
    private const val API = "https://ayuzmwpmhncxrugsyxmw.supabase.co/functions/v1/hub-api"
    private const val PREFS = "hub"

    private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun key(c: Context): String? = prefs(c).getString("key", null)
    fun setKey(c: Context, key: String?) = prefs(c).edit().putString("key", key).apply()
    fun appName(c: Context): String? = prefs(c).getString("app", null)
    fun setAppName(c: Context, n: String?) = prefs(c).edit().putString("app", n).apply()
    fun cachedConfig(c: Context): JSONObject? = prefs(c).getString("config", null)?.let { runCatching { JSONObject(it) }.getOrNull() }
    fun saveConfig(c: Context, j: JSONObject) = prefs(c).edit().putString("config", j.toString()).apply()
    fun page(c: Context, id: Int) = prefs(c).getInt("page_$id", 0)
    fun setPage(c: Context, id: Int, p: Int) = prefs(c).edit().putInt("page_$id", p).apply()
    fun flash(c: Context): Pair<String, Long>? {
        val t = prefs(c).getString("flash", null) ?: return null
        return t to prefs(c).getLong("flash_at", 0)
    }
    fun setFlash(c: Context, buttonId: String) = prefs(c).edit().putString("flash", buttonId).putLong("flash_at", System.currentTimeMillis()).apply()

    class HubException(message: String) : Exception(message)

    /** POST one action; returns the parsed body. Throws HubException with a readable message. */
    fun call(c: Context, body: JSONObject, keyOverride: String? = null): JSONObject {
        val key = keyOverride ?: key(c) ?: throw HubException("Not connected — open Gremier Hub and paste your key")
        val conn = (URL(API).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 10000
            readTimeout = 20000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Authorization", "Bearer $key")
        }
        try {
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            val j = runCatching { JSONObject(text) }.getOrElse { JSONObject() }
            if (code == 401) throw HubException("Key not accepted — it may have been switched off")
            if (code !in 200..299 || j.optBoolean("ok", true) == false) {
                throw HubException(j.optString("message", j.optString("error", "Something went wrong ($code)")))
            }
            return j
        } catch (e: HubException) {
            throw e
        } catch (e: Exception) {
            throw HubException("No connection — try again")
        } finally {
            conn.disconnect()
        }
    }

    fun fetchConfig(c: Context): JSONObject {
        val j = call(c, JSONObject().put("action", "widget_config"))
        val cfg = j.getJSONObject("result")
        saveConfig(c, cfg)
        return cfg
    }
}
