package il.co.gremiercoffee.hub

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.RemoteViews
import kotlin.concurrent.thread

/** Resizable production dashboard; each section scrolls in a native widget collection. */
class HubWidget:AppWidgetProvider(){
 companion object{
  const val REFRESH="il.co.gremiercoffee.hub.REFRESH"
  fun refreshAll(c:Context,fetch:Boolean=true){
   val manager=AppWidgetManager.getInstance(c)
   val ids=manager.getAppWidgetIds(ComponentName(c,HubWidget::class.java))
   ids.forEach{render(c,manager,it)}
   if(fetch&&Hub.key(c)!=null)thread{runCatching{Hub.fetchConfig(c)};ids.forEach{render(c,manager,it)}}
  }
  fun render(c:Context,manager:AppWidgetManager,id:Int){
   val v=RemoteViews(c.packageName,R.layout.widget)
   v.setTextViewText(R.id.widget_status,if(Hub.key(c)==null)"Tap to connect Gremier Hub" else "Log production · scroll for more")
   val adapter=Intent(c,ProductionWidgetService::class.java).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id)
   adapter.data=Uri.parse(adapter.toUri(Intent.URI_INTENT_SCHEME))
   v.setRemoteAdapter(R.id.widget_list,adapter)
   v.setEmptyView(R.id.widget_list,R.id.widget_empty)
   val open=PendingIntent.getActivity(c,id*1000,Intent(c,MainActivity::class.java),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
   v.setOnClickPendingIntent(R.id.widget_title,open);v.setOnClickPendingIntent(R.id.widget_empty,open)
   val template=PendingIntent.getActivity(c,id*1000+1,Intent(c,QuickActionActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
   v.setPendingIntentTemplate(R.id.widget_list,template)
   v.setOnClickPendingIntent(R.id.widget_refresh,PendingIntent.getBroadcast(c,id*1000+2,Intent(c,HubWidget::class.java).setAction(REFRESH),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
   manager.updateAppWidget(id,v);manager.notifyAppWidgetViewDataChanged(id,R.id.widget_list)
  }
 }
 override fun onUpdate(c:Context,m:AppWidgetManager,ids:IntArray){refresh(c)}
 override fun onAppWidgetOptionsChanged(c:Context,m:AppWidgetManager,id:Int,o:Bundle){render(c,m,id)}
 override fun onReceive(c:Context,i:Intent){super.onReceive(c,i);if(i.action==REFRESH)refresh(c)}
 private fun refresh(c:Context){val pending=goAsync();thread{try{if(Hub.key(c)!=null)runCatching{Hub.fetchConfig(c)};refreshAll(c,false)}finally{pending.finish()}}}
}
