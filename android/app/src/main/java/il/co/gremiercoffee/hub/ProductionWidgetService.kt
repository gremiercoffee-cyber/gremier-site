package il.co.gremiercoffee.hub

import android.content.Intent
import android.view.View
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Color
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import org.json.JSONArray
import org.json.JSONObject

/** One collection item per section: its header and actions always stay together. */
class ProductionWidgetService:RemoteViewsService(){
 private val labels=mutableMapOf<String,Bitmap>()
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
    val items=(0 until buttons.length()).map{buttons.getJSONObject(it)}.filterNot{it.optString("action").startsWith("production_clock_")||it.optString("id")=="no_drains"}
    items.chunked(5).forEachIndexed{index,chunk->result.add((group.optString("title")+(if(index>0) " (continued)" else "")) to chunk)}
   }
   // Upgrades can briefly have the older cached, flat config. Still give it real headers.
   if(result.isEmpty()){
    val flat=cfg?.optJSONArray("buttons")?:JSONArray()
    val grouped=linkedMapOf<String,MutableList<JSONObject>>()
    for(i in 0 until flat.length()){
     val b=flat.getJSONObject(i);if(b.optString("action").startsWith("production_clock_")||b.optString("id")=="no_drains")continue
     val title=when(b.optString("action")){"start_brew"->"Brewing";"log_bottling"->"Bottling";"log_labeling"->"Labelling";"complete_drain"->"Draining";"production_clock_in","production_clock_out"->"Workers";else->"Tools"}
     grouped.getOrPut(title){mutableListOf()}.add(b)
    }
    for((title,items) in grouped)items.chunked(5).forEach{result.add(title to it)}
   }
   rows=result.sortedBy{if(it.second.any{b->b.optString("action")=="complete_drain"})0 else 1}
  }
  override fun getCount()=rows.size
  override fun getViewAt(position:Int):RemoteViews{
   val (title,buttons)=rows[position];val brewing=buttons.firstOrNull()?.optString("action")=="start_brew";val view=RemoteViews(packageName,if(brewing)R.layout.widget_brewing else R.layout.widget_section)
   view.setTextViewText(R.id.section_title,title.uppercase())
   for(i in 0..4){
    fun id(suffix:String="")=resources.getIdentifier("action_$i$suffix","id",packageName)
    val b=buttons.getOrNull(i);view.setViewVisibility(id(),if(b==null)View.GONE else View.VISIBLE)
    if(b!=null){
     val label=shortLabel(b)
     if(brewing)view.setImageViewBitmap(id("_icon"),roastLabel(b.optJSONObject("args")?.optString("product")?:"classic"))
     else{view.setImageViewResource(id("_icon"),actionIcon(b));view.setViewVisibility(id("_icon"),if(b.optString("action")=="complete_drain")View.GONE else View.VISIBLE)}
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
  override fun getViewTypeCount()=2
  override fun getItemId(position:Int)=position.toLong()
  override fun hasStableIds()=false
  override fun onDestroy(){}
 }
 private fun roastLabel(product:String):Bitmap=labels.getOrPut(product){
  val resource=when(product){"houseBlend"->R.drawable.roast_house;"colombia"->R.drawable.roast_colombia;"decaf"->R.drawable.roast_decaf;else->R.drawable.roast_classic}
  val original=BitmapFactory.decodeResource(resources,resource)
  // Viewports of the actual front labels; source photographs stay unchanged.
  val rect=if(product=="decaf")intArrayOf(725,408,215,345) else intArrayOf(53,137,174,232)
  val cropped=Bitmap.createBitmap(original,rect[0],rect[1],rect[2],rect[3])
  val result=requireNotNull(Bitmap.createScaledBitmap(cropped,96,128,true).copy(Bitmap.Config.ARGB_8888,true))
  if(product=="unfiltered"){
   val canvas=Canvas(result);val paint=Paint(Paint.ANTI_ALIAS_FLAG)
   paint.color=Color.parseColor("#D8C3A1");canvas.drawRect(7f,83f,89f,121f,paint)
   paint.color=Color.parseColor("#292929");paint.textAlign=Paint.Align.CENTER;paint.typeface=android.graphics.Typeface.DEFAULT_BOLD;paint.textSize=10f
   canvas.drawText("UNFILTERED",48f,101f,paint);paint.textSize=7f;canvas.drawText("Classic Dark Roast",48f,113f,paint)
  }
  original.recycle();if(cropped!==original)cropped.recycle();result
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
