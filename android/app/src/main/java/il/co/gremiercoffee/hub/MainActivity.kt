package il.co.gremiercoffee.hub

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import kotlin.concurrent.thread

/** One-time setup: paste the key from admin → Connected apps. */
class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var keyInput: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (24 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 2, pad, pad)
            setBackgroundColor(Color.parseColor("#F7F4EF"))
        }
        root.addView(TextView(this).apply { text = "☕ Gremier Hub"; textSize = 26f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.parseColor("#1A1A1A")) })
        root.addView(TextView(this).apply {
            text = "Quick actions on your home screen.\n\n1. In the admin app open More → Connected apps, create a key named \"Widget\" (with \"Can log & change things\" ticked) and copy it.\n2. Paste it below and tap Connect.\n3. Long-press your home screen → Widgets → Gremier Hub, and drag it on."
            textSize = 15f; setTextColor(Color.parseColor("#444444")); setPadding(0, pad / 2, 0, pad)
        })
        keyInput = EditText(this).apply {
            hint = "ghk_…"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setText(Hub.key(this@MainActivity) ?: "")
        }
        root.addView(keyInput, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        root.addView(Button(this).apply { text = "Connect"; setOnClickListener { connect() } })
        status = TextView(this).apply { textSize = 15f; setPadding(0, pad / 2, 0, 0); gravity = Gravity.START }
        root.addView(status)
        root.addView(Button(this).apply { text = "Refresh widget now"; setOnClickListener { HubWidget.refreshAll(this@MainActivity); status.text = "Refreshing…" } })
        root.addView(Button(this).apply {
            text = "Disconnect"
            setOnClickListener { Hub.setKey(this@MainActivity, null); Hub.setAppName(this@MainActivity, null); keyInput.setText(""); status.text = "Disconnected"; HubWidget.refreshAll(this@MainActivity, false) }
        })
        setContentView(root)
        status.text = Hub.appName(this)?.let { "✅ Connected as \"$it\"" } ?: "Not connected yet"
    }

    private fun connect() {
        val key = keyInput.text.toString().trim()
        if (!key.startsWith("ghk_")) { status.text = "That doesn't look like a Gremier key (starts with ghk_)"; return }
        status.text = "Checking…"
        thread {
            val msg = try {
                val j = Hub.call(this, JSONObject().put("action", "help"), keyOverride = key)
                val scopes = j.optJSONArray("scopes")?.toString() ?: ""
                Hub.setKey(this, key)
                Hub.setAppName(this, j.optString("app"))
                Hub.fetchConfig(this)
                HubWidget.refreshAll(this, false)
                "✅ Connected as \"${j.optString("app")}\"" + if (!scopes.contains("write")) "\n⚠️ This key is read-only — buttons that log things won't work." else ""
            } catch (e: Exception) {
                "⚠️ ${e.message}"
            }
            runOnUiThread { status.text = msg }
        }
    }
}
