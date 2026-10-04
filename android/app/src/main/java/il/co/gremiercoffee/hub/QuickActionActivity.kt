package il.co.gremiercoffee.hub

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.speech.RecognizerIntent
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
        when (button.optString("kind")) {
            "info" -> { showMessage(button.optString("message")); return }
            "view" -> { showView(); return }
            "voice" -> { startVoice(); return }
        }
        val dd = resources.displayMetrics.density
        val pad = (20 * dd).toInt()
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


    // ── simple screens built in code (no layouts) ──
    private val d get() = resources.displayMetrics.density
    private fun panel(): LinearLayout {
        val pad = (20 * d).toInt()
        return LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad); setBackgroundColor(Color.WHITE) }
    }
    private fun title(box: LinearLayout, text: String) = box.addView(TextView(this).apply {
        this.text = text; textSize = 19f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.parseColor("#1A1A1A"))
    })
    private fun body(box: LinearLayout, text: String, color: String = "#444444", size: Float = 15f) = TextView(this).apply {
        this.text = text; textSize = size; setTextColor(Color.parseColor(color)); setPadding(0, (8 * d).toInt(), 0, 0)
    }.also { box.addView(it) }
    private fun show(box: LinearLayout) = setContentView(ScrollView(this).apply { addView(box) }, android.view.ViewGroup.LayoutParams((320 * d).toInt(), WRAP_CONTENT))

    private fun showMessage(message: String) {
        val box = panel()
        title(box, "${button.optString("icon")}  ${button.optString("title", button.optString("label"))}")
        body(box, message)
        box.addView(Button(this).apply { text = "OK"; setOnClickListener { finish() } })
        show(box)
    }

    /** Read-only pop-up (e.g. Stock): rows grouped by section. */
    private fun showView() {
        val box = panel()
        title(box, "${button.optString("icon")}  ${button.optString("title", button.optString("label"))}")
        val status = body(box, "Loading…")
        box.addView(Button(this).apply { text = "Close"; setOnClickListener { finish() } })
        show(box)
        thread {
            try {
                val r = Hub.call(this, JSONObject().put("action", button.getString("action"))).getJSONObject("result")
                val lines = r.optJSONArray("lines")
                runOnUiThread {
                    box.removeView(status)
                    var section = ""
                    var at = 1
                    for (i in 0 until (lines?.length() ?: 0)) {
                        val l = lines!!.getJSONObject(i)
                        if (l.optString("section") != section) {
                            section = l.optString("section")
                            box.addView(TextView(this).apply { text = section.uppercase(); textSize = 11f; letterSpacing = 0.1f; setTextColor(Color.parseColor("#8A8178")); setPadding(0, (14 * d).toInt(), 0, (2 * d).toInt()) }, at++)
                        }
                        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, (3 * d).toInt(), 0, (3 * d).toInt()) }
                        row.addView(TextView(this).apply { text = l.optString("label"); textSize = 15f; setTextColor(Color.parseColor("#1A1A1A")) }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
                        row.addView(TextView(this).apply { text = l.optString("value"); textSize = 15f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.parseColor("#1A1A1A")) })
                        box.addView(row, at++)
                    }
                }
            } catch (e: Exception) {
                runOnUiThread { status.text = "⚠️ ${e.message}" }
            }
        }
    }

    // ── Voice: system microphone → "I understood…" → Confirm runs it ──
    private val VOICE_REQ = 7
    private fun startVoice() {
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "What did you do?")
        try { startActivityForResult(i, VOICE_REQ) } catch (_: ActivityNotFoundException) { showMessage("This phone has no speech recognition available.") }
    }
    @Deprecated("startActivityForResult is fine for this tiny pop-up")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != VOICE_REQ) return
        val text = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (resultCode != RESULT_OK || text.isNullOrBlank()) { finish(); return }
        val box = panel()
        title(box, "🎙️  Voice log")
        body(box, "“$text”", "#8A8178", 14f)
        val status = body(box, "Working out what to log…")
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, (12 * d).toInt(), 0, 0) }
        val again = Button(this).apply { this.text = "Try again"; setOnClickListener { startVoice() } }
        val go = Button(this).apply { this.text = "Confirm"; isEnabled = false }
        row.addView(again, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        row.addView(go, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        box.addView(row)
        box.addView(Button(this).apply { this.text = "Cancel"; setOnClickListener { finish() } })
        show(box)
        thread {
            try {
                val r = Hub.call(this, JSONObject().put("action", "voice_parse").put("text", text)).getJSONObject("result")
                runOnUiThread {
                    status.text = r.optString("say")
                    status.textSize = 17f
                    status.setTypeface(status.typeface, Typeface.BOLD)
                    status.setTextColor(Color.parseColor("#1A1A1A"))
                    go.isEnabled = true
                    go.setOnClickListener {
                        go.isEnabled = false; again.isEnabled = false
                        val call = JSONObject((r.optJSONObject("args") ?: JSONObject()).toString()).put("action", r.getString("action"))
                        thread {
                            val (ok, msg) = try { Hub.call(this, call); Hub.setFlash(this, "voice"); true to "✅ Done" } catch (e: Exception) { false to "⚠️ ${e.message}" }
                            runOnUiThread {
                                status.text = msg
                                HubWidget.refreshAll(this)
                                if (ok) status.postDelayed({ finish() }, 900) else { go.isEnabled = true; again.isEnabled = true }
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                runOnUiThread { status.text = "⚠️ ${e.message}" }
            }
        }
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
