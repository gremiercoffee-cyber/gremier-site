import importlib.util,unittest,tempfile,zipfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('hr',Path(__file__).resolve().parents[1]/'scripts/daynote_hr_history.py');hr=importlib.util.module_from_spec(spec);spec.loader.exec_module(hr)
class HistoryTest(unittest.TestCase):
 def test_observed_minutes_sources_missing_and_timezone(self):
  root=Path(__file__).resolve().parents[1]/'.local/takeout-test-fixtures';root.mkdir(parents=True,exist_ok=True)
  with tempfile.TemporaryDirectory(dir=root) as directory:
   path=Path(directory)/'takeout-20261101T091057Z-1-001.zip'
   with zipfile.ZipFile(path,'w') as z:
    z.writestr('Takeout/Google Health/Physical Activity_GoogleData/Heart Rate/heart_rate_2026-10-31.csv','timestamp,beats per minute,data source\n2026-10-31T22:30:00Z,80,watch\n2026-10-31T22:30:00Z,80,watch\n2026-10-31T22:30:30Z,100,watch\n2026-10-31T23:30:00Z,120,watch\n2026-10-31T22:30:00Z,150,other\n2026-10-31T22:31:00Z,NaN,watch\n')
    z.writestr('Unrelated/private.csv','must not read')
   rows=hr.parse(path);self.assertEqual(len(rows),1);self.assertEqual(rows[0]['date'],'2026-11-01');self.assertEqual(rows[0]['raw']['coverage_minutes'],2);self.assertEqual(rows[0]['raw']['bins'],[(90,1),(120,1)]);self.assertFalse(rows[0]['raw']['final']);self.assertEqual(rows[0]['raw']['device_source'],'watch')
if __name__=='__main__':unittest.main()
