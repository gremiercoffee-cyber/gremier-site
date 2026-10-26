package il.co.gremiercoffee.hub

import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import org.json.JSONArray
import org.json.JSONObject

/** One collection item per section: its header and actions always stay together. */
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
    items.chunked(6).forEachIndexed{index,chunk->result.add((group.optString("title")+(if(index>0) " (continued)" else "")) to chunk)}
   }
   // Upgrades can briefly have the older cached, flat config. Still give it real headers.
   if(result.isEmpty()){
    val flat=cfg?.optJSONArray("buttons")?:JSONArray()
    val grouped=linkedMapOf<String,MutableList<JSONObject>>()
    for(i in 0 until flat.length()){
     val b=flat.getJSONObject(i)
     val title=when(b.optString("action")){"start_brew"->"Brewing";"log_bottling"->"Bottling";"log_labeling"->"Labelling";"complete_drain"->"Draining";"production_clock_in","production_clock_out"->"Workers";else->"Tools"}
     grouped.getOrPut(title){mutableListOf()}.add(b)
    }
    for((title,items) in grouped)items.chunked(6).forEach{result.add(title to it)}
   }
   rows=result
  }
  override fun getCount()=rows.size
  override fun getViewAt(position:Int):RemoteViews{
   val (title,buttons)=rows[position];val view=RemoteViews(packageName,R.layout.widget_section)
   view.setTextViewText(R.id.section_title,title)
   view.setImageViewResource(R.id.section_icon,sectionIcon(title))
   view.setViewVisibility(R.id.action_row_1,if(buttons.size>3)View.VISIBLE else View.GONE)
   for(i in 0..5){
    fun id(suffix:String="")=resources.getIdentifier("action_$i$suffix","id",packageName)
    val b=buttons.getOrNull(i);view.setViewVisibility(id(),if(b==null)View.GONE else View.VISIBLE)
    if(b!=null){
     val label=shortLabel(b)
     view.setImageViewResource(id("_icon"),actionIcon(b))
     view.setTextViewText(id("_label"),label)
     val sub=b.optString("sub")
     view.setTextViewText(id("_sub"),sub)
     view.setViewVisibility(id("_sub"),if(sub.isBlank())View.GONE else View.VISIBLE)
     view.setContentDescription(id(),title+": "+label+(if(sub.isNotBlank()) ", "+sub else ""))
     view.setOnClickFillInIntent(id(),Intent().putExtra("button",b.toString()))
    }
   }
   return view
  }
  override fun getLoadingView():RemoteViews?=null
  override fun getViewTypeCount()=1
  override fun getItemId(position:Int)=position.toLong()
  override fun hasStableIds()=false
  override fun onDestroy(){}
 }
 private fun sectionIcon(title:String)=when{
  title.startsWith("Brew")->R.drawable.ic_brew
  title.startsWith("Bottl")->R.drawable.ic_bottle
  title.startsWith("Labell")->R.drawable.ic_label
  title.startsWith("Drain")->R.drawable.ic_drain
  title.startsWith("Worker")->R.drawable.ic_worker
  else->R.drawable.ic_production
 }
 private fun actionIcon(b:JSONObject):Int=when{
  b.optString("action")=="production_clock_in"->R.drawable.ic_worker
  b.optString("action")=="production_clock_out"->R.drawable.ic_clock
  b.optString("action")=="start_brew"->R.drawable.ic_brew
  b.optString("action")=="log_labeling"->R.drawable.ic_label
  b.optString("action")=="complete_drain"||b.optString("id")=="no_drains"->R.drawable.ic_drain
  b.optString("id").contains("mini")->R.drawable.ic_minis
  b.optString("id").contains("jerry")->R.drawable.ic_jug
  b.optString("action")=="log_bottling"->R.drawable.ic_bottle
  b.optString("id")=="voice"->R.drawable.ic_voice
  b.optString("id")=="stock"->R.drawable.ic_stock
  else->R.drawable.ic_production
 }
 private fun shortLabel(b:JSONObject)=when(b.optString("id")){
  "bottle_liter"->"Liter bottles"
  "bottle_mini"->"Mini bottles"
  "bottle_jerry"->"5L jerry cans"
  else->b.optString("label")
 }
}
