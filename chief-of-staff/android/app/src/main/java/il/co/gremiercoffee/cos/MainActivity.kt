package il.co.gremiercoffee.cos

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.concurrent.thread

/** One-time setup: enter the app passcode so the widget can load your list. */
class MainActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (24 * resources.displayMetrics.density).toInt()
        val status = TextView(this).apply { textSize = 15f }
        val input = EditText(this).apply {
            hint = "Passcode"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        val save = Button(this).apply { text = "Connect widget" }
        val openApp = Button(this).apply { text = "Open Chief of Staff" }
        fun showState() {
            status.text = if (Cos.passcode(this) == null)
                "Enter your Chief of Staff passcode, then add the widget: long-press your home screen → Widgets → Chief of Staff."
            else "Connected ✓\nAdd the widget: long-press your home screen → Widgets → Chief of Staff."
        }
        save.setOnClickListener {
            val code = input.text.toString().trim()
            if (code.isEmpty()) return@setOnClickListener
            status.text = "Checking…"
            thread {
                val ok = Cos.verify(this, code)
                runOnUiThread {
                    if (ok) { Cos.setPasscode(this, code); input.setText(""); showState(); CosWidget.refreshAll(this) }
                    else status.text = "That passcode didn't work."
                }
            }
        }
        openApp.setOnClickListener { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(Cos.APP_URL))) }
        showState()
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(pad, pad, pad, pad)
            addView(TextView(context).apply { text = "Chief of Staff"; textSize = 26f })
            addView(status); addView(input); addView(save); addView(openApp)
        })
    }
}
