package il.co.gremiercoffee.hub

import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import org.json.JSONArray
import org.json.JSONObject

class ProductionWidgetService:RemoteViewsService(){
 override fun onGetViewFactory(intent:Intent):RemoteViewsFactory=Factory()
 inner class Factory:RemoteViewsFactory{
  private var rows=listOf<Pair<String,List<JSONObject>>>()
  override fun onCreate(){onDataSetChanged()}
  override fun onDataSetChanged(){
   val cfg=Hub.cachedConfig(this@ProductionWidgetService)
   val groups=cfg?.optJSONArray("sections")?:JSONArray()
   val result=mutableListOf<Pair<String,List<JSONObject>>>()
   for(i in 0 until groups.length()){
    val group=groups.getJSONObject(i);val buttons=group.optJSONArray("buttons")?:JSONArray()
    val items=(0 until buttons.length()).map{buttons.getJSONObject(it)}
    items.chunked(3).forEachIndexed{index,chunk->result.add((if(index==0)group.optString("title") else "") to chunk)}
   }
   rows=result
  }
  override fun getCount()=rows.size
  override fun getViewAt(position:Int):RemoteViews{
   val row=rows[position];val view=RemoteViews(packageName,R.layout.widget_section)
   view.setTextViewText(R.id.section_title,row.first);view.setViewVisibility(R.id.section_title,if(row.first.isEmpty())View.GONE else View.VISIBLE)
   for(i in 0..2){
    fun id(suffix:String="")=resources.getIdentifier("action_$i$suffix","id",packageName)
    val b=row.second.getOrNull(i);view.setViewVisibility(id(),if(b==null)View.INVISIBLE else View.VISIBLE)
    if(b!=null){view.setTextViewText(id("_icon"),b.optString("icon"));view.setTextViewText(id("_label"),b.optString("label"));view.setTextViewText(id("_sub"),b.optString("sub"));view.setOnClickFillInIntent(id(),Intent().putExtra("button",b.toString()))}
   }
   return view
  }
  override fun getLoadingView():RemoteViews?=null
  override fun getViewTypeCount()=1
  override fun getItemId(position:Int)=position.toLong()
  override fun hasStableIds()=false
  override fun onDestroy(){}
 }
}
