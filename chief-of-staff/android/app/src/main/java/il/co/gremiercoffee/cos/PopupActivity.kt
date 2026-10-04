package il.co.gremiercoffee.cos

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.MediaRecorder
import android.net.Uri
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.io.File
import java.util.Locale
import kotlin.concurrent.thread

/**
 * Small pop-up over the home screen, so the widget never has to open the full app.
 * Modes: item (details + Done / In 1 hour / Tomorrow / Not needed / area / ask), event (details),
 * add (type a sentence to the Chief of Staff), talk (speak; transcribed, answered and read aloud).
 */
class PopupActivity : Activity() {
    private lateinit var body: LinearLayout
    private lateinit var reply: TextView
    private var recorder: MediaRecorder? = null
    private var audioFile: File? = null
    private var tts: TextToSpeech? = null
    private val dp get() = resources.displayMetrics.density

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.setLayout((resources.displayMetrics.widthPixels * 0.92).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        body = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((20 * dp).toInt(), (18 * dp).toInt(), (20 * dp).toInt(), (14 * dp).toInt())
        }
        reply = text("", 15f).apply { visibility = View.GONE; setPadding(0, (10 * dp).toInt(), 0, 0) }
        setContentView(ScrollView(this).apply { addView(body) })

        if (Cos.passcode(this) == null) {
            body.addView(text("Open the Chief of Staff app once to enter your passcode.", 15f)); addClose(); return
        }
        val id = intent.getStringExtra("id").orEmpty()
        when (intent.getStringExtra("mode")) {
            "item" -> showItem(id)
            "event" -> showEvent(id)
            "add" -> showAsk("Tell your Chief of Staff", "e.g. Remind me Sunday at 10 to call the accountant", null)
            "talk" -> showTalk()
            else -> finish()
        }
    }

    // ---- Building blocks -------------------------------------------------------------
    private fun text(s: String, size: Float, color: Int = Color.parseColor("#0E1117"), bold: Boolean = false) = TextView(this).apply {
        text = s; textSize = size; setTextColor(color); if (bold) typeface = Typeface.create("serif", Typeface.NORMAL)
    }
    private fun muted(s: String) = text(s, 13f, Color.parseColor("#6A7080"))

    private fun pill(label: String, primary: Boolean = false, onClick: () -> Unit) = Button(this).apply {
        text = label; isAllCaps = false; textSize = 14f; minHeight = 0; minimumHeight = 0
        setTextColor(if (primary) Color.WHITE else Color.parseColor("#0E1117"))
        background = GradientDrawable().apply { cornerRadius = 22 * dp; setColor(Color.parseColor(if (primary) "#3540A8" else "#EEF0FA")) }
        setPadding((16 * dp).toInt(), (8 * dp).toInt(), (16 * dp).toInt(), (8 * dp).toInt())
        setOnClickListener { onClick() }
    }

    private fun row(vararg views: View) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        setPadding(0, (8 * dp).toInt(), 0, 0)
        views.forEach { v -> addView(v, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = (6 * dp).toInt() }) }
    }

    private fun addClose() = body.addView(row(pill("Close") { finish() }))

    private fun showReply(s: String) { reply.text = s; reply.visibility = View.VISIBLE }

    /** Run a widget action, show the confirmation briefly, refresh the widget, close. */
    private fun act(id: String, action: String) {
        showReply("…")
        thread {
            val msg = runCatching { Cos.act(this, id, action) }.getOrElse { it.message ?: "Couldn't update" }
            CosWidget.refreshAll(applicationContext)
            runOnUiThread { showReply(msg); body.postDelayed({ finish() }, 900) }
        }
    }

    // ---- Item ------------------------------------------------------------------------
    private fun showItem(id: String) {
        val it = Cos.find(this, id) ?: run { body.addView(muted("This item was already handled.")); addClose(); return }
        body.addView(text(it.optString("title"), 19f, bold = true))
        it.optString("sub").takeIf { s -> s.isNotBlank() }?.let { s -> body.addView(muted(s)) }
        it.optString("notes").takeIf { s -> s.isNotBlank() && s != "null" }?.let { s ->
            body.addView(text(s, 14f, Color.parseColor("#3A3F4B")).apply { setPadding(0, (8 * dp).toInt(), 0, 0) })
        }
        body.addView(row(pill("Done ✓", primary = true) { act(id, "done") }, pill("In 1 hour") { act(id, "snooze1h") }))
        body.addView(row(pill("Tomorrow") { act(id, "tomorrow") }, pill("Not needed") { act(id, "notneeded") }))
        val cat = it.optString("category").takeIf { s -> s.isNotBlank() && s != "null" }
        body.addView(muted(if (cat == null) "Which area?" else "Area").apply { setPadding(0, (12 * dp).toInt(), 0, 0) })
        body.addView(row(
            pill(if (cat == "coffee") "☕ Coffee ✓" else "☕ Coffee") { act(id, "cat:coffee") },
            pill(if (cat == "yeshiva") "📚 Yeshiva ✓" else "📚 Yeshiva") { act(id, "cat:yeshiva") },
            pill(if (cat == "personal") "🏠 Personal ✓" else "🏠 Personal") { act(id, "cat:personal") },
        ))
        askBox("Ask or tell me about this…", "About \"${it.optString("title")}\": ")
        body.addView(reply)
        addClose()
    }

    // ---- Event -----------------------------------------------------------------------
    private fun showEvent(id: String) {
        val e = Cos.find(this, id) ?: run { body.addView(muted("This event is no longer on your calendar.")); addClose(); return }
        body.addView(text(e.optString("title"), 19f, bold = true))
        body.addView(muted(e.optString("time")))
        e.optString("location").takeIf { it.isNotBlank() }?.let { body.addView(text("📍 $it", 14f).apply { setPadding(0, (8 * dp).toInt(), 0, 0) }) }
        val link = e.optString("link")
        askBox("Ask about this meeting…", "About my calendar event \"${e.optString("title")}\" (${e.optString("time")}): ")
        body.addView(reply)
        body.addView(row(
            *listOfNotNull(
                if (link.isNotBlank()) pill("Open in Calendar") { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link))); finish() } else null,
                pill("Close") { finish() },
            ).toTypedArray(),
        ))
    }

    // ---- Ask / add -------------------------------------------------------------------
    private fun askBox(hint: String, prefix: String) {
        val input = EditText(this).apply {
            this.hint = hint; textSize = 15f
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_MULTI_LINE
        }
        body.addView(input)
        body.addView(row(pill("Send", primary = true) {
            val t = input.text.toString().trim()
            if (t.isEmpty()) return@pill
            input.setText("")
            send(prefix + t, "text")
        }))
    }

    private fun showAsk(title: String, hint: String, prefix: String?) {
        body.addView(text(title, 19f, bold = true))
        askBox(hint, prefix ?: "")
        body.addView(reply)
        addClose()
    }

    private fun send(message: String, mode: String, speak: Boolean = false) {
        showReply("Thinking…")
        thread {
            val answer = runCatching { Cos.chat(this, message, mode) }.getOrElse { "Couldn't reach your Chief of Staff: ${it.message}" }
            CosWidget.refreshAll(applicationContext)
            runOnUiThread {
                showReply(answer)
                if (speak) tts?.speak(answer, TextToSpeech.QUEUE_FLUSH, null, "reply")
            }
        }
    }

    // ---- Talk ------------------------------------------------------------------------
    private lateinit var talkButton: Button
    private lateinit var heard: TextView

    private fun showTalk() {
        tts = TextToSpeech(this) { status -> if (status == TextToSpeech.SUCCESS) tts?.language = Locale.getDefault() }
        body.addView(text("Talk to your Chief of Staff", 19f, bold = true))
        heard = muted("Tap Start and speak. Tap Stop when you're done.").apply { setPadding(0, (6 * dp).toInt(), 0, 0) }
        body.addView(heard)
        talkButton = pill("● Start", primary = true) { if (recorder == null) startRecording() else stopRecording() }
        body.addView(LinearLayout(this).apply {
            gravity = Gravity.CENTER; setPadding(0, (14 * dp).toInt(), 0, (4 * dp).toInt())
            addView(talkButton, LinearLayout.LayoutParams((200 * dp).toInt(), (56 * dp).toInt()))
        })
        body.addView(reply)
        addClose()
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startRecording()
        else requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) startRecording()
        else heard.text = "Microphone permission is needed to talk. You can allow it in Settings → Apps → Chief of Staff."
    }

    private fun startRecording() {
        val f = File(cacheDir, "voice.m4a").also { audioFile = it }
        recorder = MediaRecorder(this).apply {
            setAudioSource(MediaRecorder.AudioSource.MIC)
            setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            setAudioSamplingRate(16000)
            setAudioEncodingBitRate(48000)
            setOutputFile(f.absolutePath)
            prepare(); start()
        }
        talkButton.text = "■ Stop"
        heard.text = "Listening…"
        tts?.stop()
    }

    private fun stopRecording() {
        val r = recorder ?: return
        recorder = null
        runCatching { r.stop() }
        r.release()
        talkButton.text = "● Start"
        heard.text = "Transcribing…"
        val f = audioFile ?: return
        thread {
            val said = runCatching { Cos.transcribe(this, f) }.getOrElse { "" }
            runOnUiThread {
                if (said.isBlank()) { heard.text = "I didn't catch that. Tap Start to try again."; return@runOnUiThread }
                heard.text = "You: $said"
                send(said, "dictation", speak = true)
            }
        }
    }

    override fun onDestroy() {
        recorder?.runCatching { stop(); release() }
        tts?.shutdown()
        super.onDestroy()
    }
}
