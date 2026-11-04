import unittest,tempfile,sys
from pathlib import Path
from zipfile import ZipFile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from daynote_takeout import parse_archive
BASE='Takeout/Google Health/'
class TakeoutTests(unittest.TestCase):
 def archive(self,files):
  root=(Path(__file__).resolve().parents[1]/'.local'/'takeout-test-fixtures').resolve();root.mkdir(parents=True,exist_ok=True);folder=tempfile.TemporaryDirectory(dir=root);assert Path(folder.name).resolve().is_relative_to(root);self.addCleanup(folder.cleanup);path=Path(folder.name)/'takeout-20261101T091057Z-1-001.zip'
  with ZipFile(path,'w') as z:
   for name,text in files.items():z.writestr(BASE+name,text)
  return path
 def test_real_schema_dates_and_dst_cardio_sum_not_average(self):
  rows='timestamp,workout,background,total,data source\n2026-10-24T22:30:00Z,1,1,2,Pixel Watch 4\n2026-10-24T23:30:00Z,2,1,3,Pixel Watch 4\n2026-11-01T08:00:00Z,0,0,0,Pixel Watch 4\n'
  path=self.archive({'Daily Readiness/daily_readiness.csv':'timestamp,score,type,data source\n2026-10-25,65,HIGH,Google Health App\n','Cardio Load/cardio_load_2026-10-01.csv':rows,'Cardio Load/cardio_load_2026-10-02.csv':rows})
  points,summary=parse_archive(path);by={p['id']:p for p in points};self.assertEqual(by['takeout:google:cardio:2026-10-25']['value'],5);self.assertTrue(by['takeout:google:cardio:2026-10-25']['raw']['final']);self.assertEqual(by['takeout:google:cardio:2026-11-01']['value'],0);self.assertFalse(by['takeout:google:cardio:2026-11-01']['raw']['final']);self.assertEqual(summary['metrics']['google_readiness']['records'],1);self.assertNotIn('takeout:google:cardio:2026-10-26',by)
 def test_conflicting_daily_values_are_skipped_not_arbitrarily_chosen(self):
  path=self.archive({'daily_resting_heart_rate.csv':'timestamp,beats per minute,data source\n2026-03-27T00:00:00Z,50,Google Health App\n2026-03-27T00:00:00Z,52,Google Health App\n'});points,summary=parse_archive(path);self.assertEqual(points,[]);self.assertEqual(len(summary['warnings']),1)
 def test_invalid_components_are_rejected(self):
  path=self.archive({'cardio_load_2026-10-01.csv':'timestamp,workout,background,total,data source\n2026-10-25T08:00:00Z,1,1,9,Pixel Watch 4\n'})
  with self.assertRaisesRegex(ValueError,'components'):parse_archive(path)
 def test_unrelated_archive_files_are_not_ingested(self):
  path=self.archive({'User Profile_GoogleData/profile.csv':'name,email\nPrivate,private@example.com\n'});points,summary=parse_archive(path);self.assertEqual(points,[]);self.assertEqual(summary['files_read'],0)
 def test_sleep_intervals_and_stages_keep_real_utc_timestamps(self):
  path=self.archive({'UserSleeps_2026-10-01.csv':'sleep_id,sleep_type,minutes_asleep,sleep_start,sleep_end,data_source,sleep_last_updated\nx,STAGES,480,2026-10-24T20:00:00Z,2026-10-25T05:00:00Z,DERIVED,2026-10-25T06:00:00Z\n','UserSleepStages_2026-10-01.csv':'sleep_id,sleep_stage_id,sleep_stage_type,sleep_stage_start,sleep_stage_end\nx,s1,DEEP,2026-10-24T22:30:00Z,2026-10-24T23:30:00Z\n'});points,_=parse_archive(path);p=points[0];self.assertEqual(p['value'],480);self.assertEqual(p['date'],'2026-10-25');self.assertEqual(p['raw']['sleep']['stages'][0]['type'],'DEEP');self.assertEqual(p['start_at'],'2026-10-24T20:00:00Z')
if __name__=='__main__':unittest.main()
