package il.co.gremiercoffee.cos

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import kotlin.concurrent.thread

/** Invisible: handles a tap inside a widget list (done / choose area / open a pop-up), then closes. */
class TapActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val id = intent.getStringExtra("id").orEmpty()
        val action = intent.getStringExtra("action").orEmpty()
        when {
            action == "item" || action == "event" ->
                startActivity(Intent(this, PopupActivity::class.java).putExtra("mode", action).putExtra("id", id))
            id.isNotEmpty() && (action == "done" || action.startsWith("cat:")) -> {
                val app = applicationContext
                thread {
                    val res = runCatching { Cos.act(app, id, action) }
                    CosWidget.refreshAll(app)
                    res.exceptionOrNull()?.let { e -> runOnUiThread { Toast.makeText(app, e.message ?: "Couldn't update", Toast.LENGTH_SHORT).show() } }
                }
                CosWidget.refreshAll(app, fetch = false) // instant on-screen change
            }
        }
        finish()
    }
}
