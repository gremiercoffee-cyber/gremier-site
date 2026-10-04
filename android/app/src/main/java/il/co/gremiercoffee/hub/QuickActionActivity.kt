package il.co.gremiercoffee.hub

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * Small pop-up for a widget button: a confirmation, or a short form built from the
 * server's field list (choice / number / text). Runs the action, shows the result, closes.
 */
class QuickActionActivity : Activity() {
    private lateinit var button: JSONObject
    private val inputs = mutableListOf<Pair<JSONObject, View>>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        button = JSONObject(intent.getStringExtra("button") ?: run { finish(); return })
        val d = resources.displayMetrics.density
        val pad = (20 * d).toInt()
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad); setBackgroundColor(Color.WHITE) }
        box.addView(TextView(this).apply {
            text = "${button.optString("icon")}  ${button.optString("title", button.optString("label"))}"
            textSize = 19f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.parseColor("#1A1A1A"))
        })
        if (button.optString("kind") == "confirm") {
            box.addView(TextView(this).apply { text = button.optString("confirm"); textSize = 15f; setPadding(0, pad / 2, 0, pad / 2); setTextColor(Color.parseColor("#444444")) })
        }
        val fields = button.optJSONArray("fields")
        if (fields != null) for (i in 0 until fields.length()) {
            val f = fields.getJSONObject(i)
            box.addView(TextView(this).apply { text = f.optString("label"); textSize = 13f; setPadding(0, pad / 2, 0, 0); setTextColor(Color.parseColor("#8A8178")) })
            val view: View = when (f.optString("type")) {
                "choice" -> Spinner(this).apply {
                    val opts = f.optJSONArray("options")
                    val labels = (0 until (opts?.length() ?: 0)).map { opts!!.getJSONObject(it).optString("label") }
                    adapter = ArrayAdapter(this@QuickActionActivity, android.R.layout.simple_spinner_dropdown_item, labels)
                    val def = f.opt("default")?.toString()
                    (0 until (opts?.length() ?: 0)).firstOrNull { opts!!.getJSONObject(it).opt("value").toString() == def }?.let { setSelection(it) }
                }
                "number" -> EditText(this).apply { inputType = InputType.TYPE_CLASS_NUMBER; hint = "0"; val v = f.optInt("default", 0); if (v > 0) setText(v.toString()) }
                else -> EditText(this).apply { inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_MULTI_LINE; minLines = 2 }
            }
            inputs += f to view
            box.addView(view, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        }
        val status = TextView(this).apply { textSize = 14f; setPadding(0, pad / 2, 0, 0) }
        box.addView(status)
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, pad / 2, 0, 0) }
        val cancel = Button(this).apply { text = "Cancel"; setOnClickListener { finish() } }
        val go = Button(this).apply { text = button.optString("submit", if (button.optString("kind") == "confirm") "Yes, do it" else "Save") }
        row.addView(cancel, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        row.addView(go, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        box.addView(row)
        go.setOnClickListener {
            val body = collect() ?: run { status.text = "Fill in at least one amount"; return@setOnClickListener }
            go.isEnabled = false; cancel.isEnabled = false; status.text = "Saving…"
            thread {
                val (ok, msg) = try {
                    Hub.call(this, body)
                    Hub.setFlash(this, button.optString("id"))
                    true to "✅ Done"
                } catch (e: Exception) { false to "⚠️ ${e.message}" }
                runOnUiThread {
                    status.text = msg
                    HubWidget.refreshAll(this)
                    if (ok) status.postDelayed({ finish() }, 900) else { go.isEnabled = true; cancel.isEnabled = true }
                }
            }
        }
        setContentView(ScrollView(this).apply { addView(box) }, android.view.ViewGroup.LayoutParams((320 * d).toInt(), WRAP_CONTENT))
    }

    /** Builds {action, ...args, ...fields}; "a.b" field keys become nested objects. Null = nothing entered in a numbers-only form. */
    private fun collect(): JSONObject? {
        val body = (button.optJSONObject("args")?.let { JSONObject(it.toString()) } ?: JSONObject()).put("action", button.getString("action"))
        var numbers = 0; var anyNumber = false
        for ((f, v) in inputs) {
            val value: Any? = when (v) {
                is Spinner -> f.optJSONArray("options")?.optJSONObject(v.selectedItemPosition)?.opt("value")
                is EditText -> if (f.optString("type") == "number") v.text.toString().toIntOrNull()?.also { anyNumber = true; if (it > 0) numbers++ } ?: 0.also { anyNumber = true } else v.text.toString().trim()
                else -> null
            }
            if (value == null) continue
            if (f.optString("type") == "number" && value == 0) continue
            val parts = f.getString("key").split(".")
            var o = body
            for (p in parts.dropLast(1)) o = o.optJSONObject(p) ?: JSONObject().also { o.put(p, it) }
            o.put(parts.last(), value)
        }
        if (anyNumber && numbers == 0) return null
        return body
    }
}
