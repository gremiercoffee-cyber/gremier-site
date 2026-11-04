package com.gremier.healthcompanion;
import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.*;
import android.content.*;
import android.os.*;
import java.util.*;
public class HealthReader extends AccessibilityService {
 public static final String PACKAGE="com.fitbit.FitbitMobile";
 private final Handler handler=new Handler(Looper.getMainLooper());
 private boolean scheduled=false;
 private final Runnable read=()->{scheduled=false;capture();};
 @Override public void onAccessibilityEvent(AccessibilityEvent e){
  if(e.getPackageName()==null||!PACKAGE.contentEquals(e.getPackageName()))return;
  // Throttle, rather than debounce: a busy progress spinner must not postpone capture forever.
  if(!scheduled){scheduled=true;handler.postDelayed(read,250);}
 }
 private void collect(AccessibilityNodeInfo n,List<String> text,int depth){
  if(n==null||depth>35||text.size()>400)return;
  if(!n.isVisibleToUser())return;
  CharSequence t=n.getText(),description=n.getContentDescription();
  if(t!=null&&t.length()>0&&t.length()<150)text.add(t.toString());
  else if(description!=null&&description.length()>0&&description.length()<150)text.add(description.toString());
  for(int i=0;i<n.getChildCount();i++){AccessibilityNodeInfo child=n.getChild(i);if(child!=null){collect(child,text,depth+1);child.recycle();}}
 }
 private void capture(){
  AccessibilityNodeInfo root=getRootInActiveWindow();if(root==null)return;
  try{
   if(root.getPackageName()==null||!PACKAGE.contentEquals(root.getPackageName()))return;
   List<String> text=new ArrayList<>();collect(root,text,0);ScoreParser.Result r=ScoreParser.parse(text);
   // No whole-screen text is stored or transmitted. Each fresh screen replaces the previous capture.
   getSharedPreferences("health",MODE_PRIVATE).edit().putString("readiness",r.readiness==null?"":String.valueOf(r.readiness.intValue()))
    .putString("load",r.load==null?"":String.valueOf(r.load)).putLong("captured",System.currentTimeMillis())
    .putString("diagnostic",ScoreParser.diagnostic(r,!text.isEmpty())).apply();
  }finally{root.recycle();}
 }
 @Override public void onInterrupt(){handler.removeCallbacks(read);scheduled=false;}
 @Override public void onDestroy(){handler.removeCallbacks(read);super.onDestroy();}
}
