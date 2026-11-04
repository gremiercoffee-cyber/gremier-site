package com.gremier.healthcompanion;
import java.util.*;
/** Conservative English-label probe. Unrecognized, ambiguous or percentage load is left blank. */
public final class ScoreParser {
 public static final class Result {public Double readiness,load; public boolean readinessLabel,loadLabel,readinessUnavailable,processing,weeklyLoad;}
 private static String clean(String s){return s.toLowerCase(Locale.ROOT).trim().replaceAll("\\s+"," ");}
 private static Double value(String s,int max){
  if(!s.matches("[0-9]{1,6}(\\.[0-9]{1,2})?"))return null;
  double v=Double.parseDouble(s);return v<=max?v:null;
 }
 private static Double one(List<Double> values){if(values.isEmpty())return null;double first=values.get(0);for(double v:values)if(v!=first)return null;return first;}
 public static Result parse(List<String> nodes){
  Result r=new Result();List<Double> readiness=new ArrayList<>(),load=new ArrayList<>();
  r.processing=nodes.stream().map(ScoreParser::clean).anyMatch(s->s.contains("analyzing data")||s.contains("analysing data"));
  r.weeklyLoad=nodes.stream().map(ScoreParser::clean).anyMatch(s->s.contains("weekly cardio"));
  boolean loadUnsafe=nodes.stream().map(ScoreParser::clean).anyMatch(s->s.contains("weekly")||s.contains("target load")||s.contains("cardio target"));
  for(int i=0;i<nodes.size();i++){
   String s=clean(nodes.get(i));boolean rec=s.equals("readiness")||s.equals("readiness score")||s.startsWith("readiness:");
   boolean cardio=s.equals("cardio load")||s.equals("daily cardio load")||s.startsWith("cardio load:");
   if(!rec&&!cardio)continue;
   r.readinessLabel|=rec;r.loadLabel|=cardio;
   String candidate=s.contains(":")?s.substring(s.indexOf(':')+1).trim():i+1<nodes.size()?clean(nodes.get(i+1)):"";
   if(rec&&(candidate.equals("no data")||candidate.equals("not available")))r.readinessUnavailable=true;
   Double v=value(candidate,rec?100:100000);
   if(v==null||rec&&v!=Math.floor(v)||cardio&&loadUnsafe)continue;
   (rec?readiness:load).add(v);
  }
  r.readiness=one(readiness);r.load=one(load);return r;
 }
 public static String diagnostic(Result r,boolean readable){
  if(!readable)return "Google Health is visible, but exposes no readable screen text.";
  String message=r.processing?"Google Health is still analyzing data. ":"";
  if(r.readinessUnavailable)message+="Google Health says Readiness: No data. There is no readiness score to upload yet. ";
  else if(r.readiness!=null)message+="Readiness captured. ";
  else message+=r.readinessLabel?"Readiness label found, but no unambiguous numeric score. ":"Readiness label not visible. ";
  if(r.load!=null)message+="Daily cardio load captured.";
  else if(r.weeklyLoad)message+="Weekly cardio is visible; open daily Cardio load details. Weekly percentages are not daily load.";
  else message+="No daily cardio-load number found on this screen.";
  return message;
 }
}
