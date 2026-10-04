package il.co.gremiercoffee.cos

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import kotlin.concurrent.thread

/** Invisible: handles a tap on a widget row, then closes. */
class TapActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val id = intent.getStringExtra("id").orEmpty()
        when (intent.getStringExtra("action")) {
            "done" -> if (id.isNotEmpty()) {
                val app = applicationContext
                thread {
                    val err = runCatching { Cos.markDone(app, id) }.exceptionOrNull()
                    CosWidget.refreshAll(app)
                    if (err != null) runOnUiThread { Toast.makeText(app, err.message ?: "Couldn't mark done", Toast.LENGTH_SHORT).show() }
                }
                CosWidget.refreshAll(app, fetch = false) // row disappears immediately
            }
            "open" -> startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("${Cos.APP_URL}/?item=$id")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        finish()
    }
}
