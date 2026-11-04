import com.gremier.healthcompanion.ScoreParser;
import java.util.*;
public class ScoreParserTest {
 static ScoreParser.Result parse(String...s){return ScoreParser.parse(Arrays.asList(s));}
 static void equal(Object a,Object b){if(!Objects.equals(a,b))throw new AssertionError(a+" != "+b);}
 public static void main(String[] args){
  equal(parse("Readiness","72").readiness,72.0);
  equal(parse("Readiness: 0").readiness,0.0);
  equal(parse("Daily cardio load","32.5").load,32.5);
  equal(parse("Cardio load","80%").load,null);
  equal(parse("Weekly cardio load","85").load,null);
  equal(parse("Cardio load","45","Target load","30–60").load,null);
  equal(parse("Readiness","101").readiness,null);
  equal(parse("Readiness","72","Readiness","30").readiness,null);
  equal(parse("Readiness","HIGH","72").readiness,null);
  equal(parse("Readiness","72.5").readiness,null);
  equal(parse("Heart rate","72").readiness,null);
  ScoreParser.Result missing=parse("Analyzing data...","Weekly cardio","1%","3 of 185","Readiness","No data","Sleep","No data");
  equal(missing.readiness,null);equal(missing.load,null);equal(missing.processing,true);equal(missing.readinessUnavailable,true);equal(missing.weeklyLoad,true);
  if(!ScoreParser.diagnostic(missing,true).contains("There is no readiness score to upload yet"))throw new AssertionError("Missing-data diagnostic");
  System.out.println("17 conservative parser/diagnostic checks passed");
 }
}
