"""Summarize only Google Takeout HR CSVs in memory. --apply writes private summaries to existing D1.
No raw heart-rate samples, credentials or record payloads are printed or written into the repo.
"""
import argparse,csv,hashlib,io,json,math,sys,time
from collections import defaultdict
from datetime import datetime,timezone
from pathlib import Path
from urllib.request import Request,urlopen
from zipfile import ZipFile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'.local/daynote-python'))
from zoneinfo import ZoneInfo
TZ=ZoneInfo('Asia/Jerusalem')

def parse(path):
    archive=Path(path);digest=hashlib.sha256()
    with archive.open('rb') as f:
        for chunk in iter(lambda:f.read(1048576),b''):digest.update(chunk)
    sha=digest.hexdigest();exported=datetime.strptime(archive.name.split('-1-')[0].removeprefix('takeout-'),'%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
    # Across CSV boundaries, merge the same UTC minute/source. No GPS/account files are opened.
    minutes=defaultdict(lambda:[0.,0])
    with ZipFile(archive) as z:
        names=[n for n in z.namelist() if n.startswith('Takeout/Google Health/Physical Activity_GoogleData/Heart Rate/') and n.endswith('.csv')]
        for name in names:
            seen=set()
            with z.open(name) as f:
                for r in csv.DictReader(io.TextIOWrapper(f,encoding='utf-8-sig')):
                    try:
                        t=datetime.fromisoformat(r['timestamp'].replace('Z','+00:00'))
                        if t.tzinfo is None:raise ValueError('Timezone missing')
                        b=float(r['beats per minute']);source=r.get('data source','unknown');key=(t.isoformat(),source,b)
                        if not math.isfinite(b) or not 30<=b<=240 or key in seen:continue
                        seen.add(key);m=minutes[(int(t.timestamp())//60,source)];m[0]+=b;m[1]+=1
                    except (ValueError,KeyError):continue
    days=defaultdict(lambda:defaultdict(dict))
    for (minute,source),(total,count) in minutes.items():
        day=datetime.fromtimestamp(minute*60,timezone.utc).astimezone(TZ).date().isoformat()
        days[day][source][minute]=math.floor(total/count+.5)
    records=[]
    for day,sources in sorted(days.items()):
        source,observed=max(sorted(sources.items()),key=lambda pair:len(pair[1]));bins=defaultdict(int)
        for b in observed.values():bins[b]+=1
        raw={'source':'google_takeout_hr','archive_sha256':sha,'exported_at':exported.isoformat(),'captured_at':exported.isoformat(),'device_source':source,'coverage_minutes':len(observed),'bins':sorted(bins.items()),'method':'one-source-per-day; average per observed minute; no gap filling','final':day<exported.astimezone(TZ).date().isoformat() and len(observed)>=720}
        records.append({'id':'takeout:google:heart-rate-summary:'+day,'type':'heart-rate-summary','date':day,'start_at':datetime.fromtimestamp(min(observed)*60,timezone.utc).isoformat(),'end_at':datetime.fromtimestamp((max(observed)+1)*60,timezone.utc).isoformat(),'value':None,'raw':raw})
    return records

def apply(records):
    token=Path('C:/Users/Yoni/.tokens/cloudflare-gremiercoffee.txt').read_text().strip()
    endpoint='https://api.cloudflare.com/client/v4/accounts/dc73ca97eef41fb2bd0a80c0835bee95/d1/database/7b4ec7b1-cece-4e94-adf7-67e8ad5067ee/query'
    for i in range(0,len(records),10):
        batch=records[i:i+10];params=[]
        for r in batch:params.extend([r['id'],r['type'],r['date'],r['start_at'],r['end_at'],None,json.dumps(r['raw'],separators=(',',':')),datetime.now(timezone.utc).isoformat()])
        sql='INSERT INTO daynote_measurements(id,type,date,start_at,end_at,value,raw,updated_at) VALUES '+','.join(['(?,?,?,?,?,?,?,?)']*len(batch))+' ON CONFLICT(id) DO UPDATE SET value=excluded.value,raw=excluded.raw,start_at=excluded.start_at,end_at=excluded.end_at,updated_at=excluded.updated_at WHERE json_extract(daynote_measurements.raw,\'$.exported_at\')<=json_extract(excluded.raw,\'$.exported_at\')'
        req=Request(endpoint,data=json.dumps({'sql':sql,'params':params}).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','User-Agent':'HealthJournalPersonalImporter/1.0'},method='POST')
        with urlopen(req,timeout=40) as response:
            result=json.load(response)
            if not result.get('success') or not all(r.get('success') for r in result.get('result',[])):raise RuntimeError('D1 did not acknowledge summary batch')
    print('D1 acknowledged heart-rate summary import:',len(records),'days')

if __name__=='__main__':
    cli=argparse.ArgumentParser();cli.add_argument('archive');cli.add_argument('--apply',action='store_true');args=cli.parse_args()
    rows=parse(args.archive);print(json.dumps({'summary_days':len(rows),'first_day':rows[0]['date'] if rows else None,'last_day':rows[-1]['date'] if rows else None,'well_covered_days':sum(r['raw']['final'] for r in rows)}))
    if args.apply:apply(rows)
