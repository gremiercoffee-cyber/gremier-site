package com.gremier.healthcompanion;
import android.app.*;
import android.os.*;
import android.content.*;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.concurrent.*;
public class MainActivity extends Activity {
 private static final String BASE="https://chief-of-staff.gremiercoffee.workers.dev/api/daynote/android-device/";
 private final ExecutorService executor=Executors.newSingleThreadExecutor();
 private android.content.SharedPreferences prefs; private LinearLayout content;private TextView status,diagnostic;
 private EditText code,date,readiness,load;private CheckBox reviewed,finished;private Button pair,upload;private long capture;
 private String today(){return LocalDate.now(ZoneId.of("Asia/Jerusalem")).toString();}
 @Override public void onCreate(Bundle state){super.onCreate(state);prefs=getSharedPreferences("health",MODE_PRIVATE);
  ScrollView scroll=new ScrollView(this);scroll.setBackgroundColor(Color.rgb(10,15,17));content=new LinearLayout(this);content.setOrientation(1);content.setPadding(dp(24),dp(32),dp(24),dp(32));scroll.addView(content);setContentView(scroll);
  label("HEALTH COMPANION",26);label("Google Health reader · test build",15);
  label("1 · Pair with Health Journal",19);label("In Health Journal → Settings → Pixel companion, create a code. Paste it here. No Chief of Staff passcode needed.",15);
  code=input("Pairing code",false);pair=button("Pair phone",v->pair());
  label("2 · Enable screen reader",19);label("Android grants screen-reading permission. This companion filters for Google Health only. It does not take screenshots or upload full screen text. If blocked, open Android App info → menu → Allow restricted settings, then return here.",15);
  button("Open Accessibility settings",v->startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
  button("Open companion App info",v->startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,android.net.Uri.parse("package:"+getPackageName()))));
  label("3 · Open a score in Google Health",19);label("Open Readiness or daily Cardio load, wait a moment, then return here. The latest readable screen replaces the previous capture. Weekly percentages and target load are not accepted as daily load. English labels only in this test.",15);
  button("Open Google Health",v->{Intent i=getPackageManager().getLaunchIntentForPackage(HealthReader.PACKAGE);if(i!=null)startActivity(i);else status.setText("Google Health is not installed on this device.");});
  diagnostic=label("No screen capture yet.",15);button("Refresh captured values",v->loadCapture());
  label("4 · Review and upload",19);date=input("Date · YYYY-MM-DD",false);date.setText(today());readiness=input("Readiness · 0–100 (optional)",true);load=input("Daily cardio load · native units (optional)",true);
  reviewed=new CheckBox(this);reviewed.setText("I checked the date and numbers against Google Health");reviewed.setTextColor(Color.WHITE);reviewed.setMinHeight(dp(64));content.addView(reviewed);
  finished=new CheckBox(this);finished.setText("This is a finished previous day's load");finished.setTextColor(Color.WHITE);finished.setMinHeight(dp(64));content.addView(finished);
  upload=button("Upload reviewed scores",v->upload());status=label("",16);
  button("Forget pairing & captured scores",v->{prefs.edit().clear().commit();capture=0;code.setText("");readiness.setText("");load.setText("");reviewed.setChecked(false);status.setText("Local data cleared. Revoke phone access in Health Journal to invalidate its server credential too.");});
  label("This build does not upload automatically or read a locked phone. Review is required. Scores stay locally until you upload or clear them. Raw screen text is discarded immediately. Disable the service in Accessibility settings to stop reading.",14);
 }
 @Override public void onResume(){super.onResume();if(diagnostic!=null)loadCapture();}
 private void loadCapture(){capture=prefs.getLong("captured",0);boolean fresh=capture>0&&System.currentTimeMillis()-capture<86400000;
  readiness.setText(fresh?prefs.getString("readiness",""):"");load.setText(fresh?prefs.getString("load",""):"");reviewed.setChecked(false);finished.setChecked(false);
  diagnostic.setText(capture==0?"No Google Health screen read yet.":!fresh?"Capture expired. Open Google Health again.":prefs.getString("diagnostic","")+" Captured "+Instant.ofEpochMilli(capture).atZone(ZoneId.systemDefault()).toLocalTime().withNano(0));
  status.setText(prefs.contains("token")?"Phone paired. No automatic uploads.":"Phone not paired yet.");
 }
 private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
 private TextView label(String text,int size){TextView t=new TextView(this);t.setText(text);t.setTextSize(size);t.setTextColor(Color.rgb(222,230,230));t.setPadding(0,dp(12),0,dp(10));if(size>18)t.setTypeface(null,Typeface.BOLD);content.addView(t);return t;}
 private EditText input(String hint,boolean number){EditText e=new EditText(this);e.setHint(hint);e.setTextColor(Color.WHITE);e.setHintTextColor(Color.LTGRAY);e.setSingleLine(true);e.setTextSize(17);e.setMinHeight(dp(56));e.setInputType(number?android.text.InputType.TYPE_CLASS_NUMBER|android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL:android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);e.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);content.addView(e);return e;}
 private Button button(String text,View.OnClickListener click){Button b=new Button(this);b.setText(text);b.setAllCaps(false);b.setTextSize(16);b.setTextColor(Color.BLACK);GradientDrawable bg=new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,new int[]{0xFFD6FF69,0xFFACD72C});bg.setCornerRadius(dp(30));b.setBackground(bg);b.setElevation(dp(5));LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,dp(56));lp.setMargins(0,dp(12),0,dp(12));content.addView(b,lp);b.setOnClickListener(click);return b;}
 private interface Operation{String run()throws Exception;}
 private void network(Operation op){pair.setEnabled(false);upload.setEnabled(false);status.setText("Working…");executor.execute(()->{String msg;try{msg=op.run();}catch(Exception e){msg=e.getMessage()==null?"Could not connect. Retry; nothing was acknowledged.":e.getMessage();}final String message=msg;runOnUiThread(()->{status.setText(message);pair.setEnabled(true);upload.setEnabled(true);});});}
 private JSONObject post(String route,JSONObject data,String token)throws Exception{
  HttpURLConnection c=(HttpURLConnection)new URL(BASE+route).openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(20000);c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");if(token!=null)c.setRequestProperty("Authorization","Bearer "+token);
  try{try(OutputStream out=c.getOutputStream()){out.write(data.toString().getBytes(StandardCharsets.UTF_8));}int status=c.getResponseCode();InputStream in=status>=400?c.getErrorStream():c.getInputStream();if(in==null)throw new IOException("Server unavailable. Retry.");ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream stream=in){byte[] buf=new byte[1024];int n;while((n=stream.read(buf))!=-1){bytes.write(buf,0,n);if(bytes.size()>10000)throw new IOException("Unexpected server response");}}JSONObject r=new JSONObject(bytes.toString("UTF-8"));if(status!=200)throw new IOException(r.optString("error","Upload not accepted"));return r;}finally{c.disconnect();}
 }
 private void pair(){String value=code.getText().toString().replaceAll("\\s","").toLowerCase(java.util.Locale.ROOT);if(!value.matches("[a-f0-9]{48}")){status.setText("Paste the complete pairing code from Health Journal.");return;}network(()->{JSONObject p=new JSONObject();p.put("code",value);JSONObject r=post("redeem",p,null);if(!prefs.edit().putString("token",r.getString("token")).commit())throw new IOException("Could not save pairing. Create a new code.");runOnUiThread(()->code.setText(""));return "Paired. Open Google Health to test screen reading.";});}
 private void upload(){
  try{
   if(!prefs.contains("token"))throw new Exception("Pair the phone first.");if(!reviewed.isChecked())throw new Exception("Check the date and numbers first.");if(capture==0||System.currentTimeMillis()-capture>86400000)throw new Exception("Open Google Health for a fresh capture first.");
   String d=date.getText().toString().trim();LocalDate day=LocalDate.parse(d);if(day.isAfter(LocalDate.parse(today())))throw new Exception("Choose today or a previous date.");
   JSONObject p=new JSONObject();p.put("date",d);p.put("captured_at",Instant.ofEpochMilli(capture).toString());p.put("confirmed",true);p.put("package",HealthReader.PACKAGE);p.put("final",finished.isChecked());
   String rec=readiness.getText().toString().trim(),cardio=load.getText().toString().trim();if(rec.isEmpty()&&cardio.isEmpty())throw new Exception("No scores found. Open the detailed score screen, or enter the numbers after checking them.");
   if(!rec.isEmpty()){int v=Integer.parseInt(rec);if(v<0||v>100)throw new Exception("Readiness must be 0–100.");p.put("readiness",v);}if(!cardio.isEmpty()){double v=Double.parseDouble(cardio);if(!Double.isFinite(v)||v<0||v>100000)throw new Exception("Invalid daily load.");p.put("cardio_load",v);}
   final String token=prefs.getString("token","");network(()->{JSONObject r=post("scores",p,token);if(!r.optBoolean("ok"))throw new IOException("Upload not acknowledged");return "Uploaded "+r.getInt("count")+" score(s) for "+d+". Refresh Health Journal to view them.";});
  }catch(Exception e){status.setText(e.getMessage()==null?"Check the score values and date.":e.getMessage());}
 }
}
