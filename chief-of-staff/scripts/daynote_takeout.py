"""Read selected Google Health CSVs in a Takeout ZIP; never extract unrelated data.
Dependency on Windows: python -m pip install --target .local/daynote-python tzdata
Raw rows/normalized records are kept in memory, not written into the repository.
"""
import argparse, csv, hashlib, json, math, re, sys
from collections import defaultdict
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from urllib.request import Request, urlopen
from zipfile import ZipFile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'.local/daynote-python'))
from zoneinfo import ZoneInfo
TZ=ZoneInfo('Asia/Jerusalem')

def stamp(value):
    d=datetime.fromisoformat(value.replace('Z','+00:00'))
    if d.tzinfo is None: raise ValueError('A UTC/offset timestamp is required')
    return d.astimezone(timezone.utc)
def iso(d): return d.isoformat().replace('+00:00','Z')
def num(value,low=0,high=100000):
    if value is None or str(value).strip()=='': return None
    v=float(value)
    if not math.isfinite(v) or not low<=v<=high: raise ValueError('Out-of-range measurement')
    return v

def parse_archive(path):
    path=Path(path);sha=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1048576),b''): sha.update(chunk)
    archive_hash=sha.hexdigest();match=re.search(r'(20\d{6}T\d{6}Z)',path.name)
    exported=datetime.strptime(match.group(1),'%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc) if match else datetime.now(timezone.utc)
    cutoff=exported.astimezone(TZ).date().isoformat();points={};stages=defaultdict(list);cardio={};warnings=[];selected=[];conflicted=set()
    def add(id,kind,date,value,filename,row,raw=None,start=None,end=None):
        if value is None:return
        key='takeout:google:'+id
        if key in conflicted:return
        point={'id':key,'type':kind,'date':date,'value':value,'start_at':start,'end_at':end,'raw':{'source':'google_takeout','archive_sha256':archive_hash,'exported_at':iso(exported),'file':filename,'row':row,**(raw or {})}}
        previous=points.get(key)
        if previous and any(previous[k]!=point[k] for k in ['date','value','start_at','end_at']):
            if previous['raw'].get('updated_at') and point['raw'].get('updated_at') and previous['raw']['updated_at']!=point['raw']['updated_at']:
                if previous['raw']['updated_at']>point['raw']['updated_at']:return
            else:
                del points[key];conflicted.add(key);warnings.append({'conflicting_measurement_skipped':id});return
        points[key]=point
    with ZipFile(path) as z:
        for info in z.infolist():
            name=info.filename;base=name.rsplit('/',1)[-1]
            if '/Google Health/' not in name:continue
            kind=('readiness' if base=='daily_readiness.csv' else 'cardio' if re.fullmatch(r'cardio_load_\d{4}-\d{2}-\d{2}\.csv',base) else 'hrv' if base=='daily_heart_rate_variability.csv' else 'rhr' if base=='daily_resting_heart_rate.csv' else 'sleep' if re.fullmatch(r'UserSleeps(?:_\d{4}-\d{2}-\d{2})?\.csv',base) else 'stages' if re.fullmatch(r'UserSleepStages(?:_\d{4}-\d{2}-\d{2})?\.csv',base) else None)
            if not kind:continue
            if info.file_size>30*1048576:raise ValueError('Selected CSV exceeds 30 MB: '+name)
            selected.append(name)
            for i,r in enumerate(csv.DictReader(StringIO(z.read(info).decode('utf-8-sig'))),2):
                if kind in ['readiness','hrv','rhr']:
                    ts=r.get('timestamp','');date=ts[:10];datetime.strptime(date,'%Y-%m-%d')
                    # Daily midnight timestamps label a calendar day, not an activity instant.
                    value=num(r.get({'readiness':'score','hrv':'average heart rate variability milliseconds','rhr':'beats per minute'}[kind]),0,100 if kind=='readiness' else 500)
                    add(kind+':'+date,{'readiness':'google_readiness','hrv':'daily-heart-rate-variability','rhr':'daily-resting-heart-rate'}[kind],date,value,name,i,{'data_source':r.get('data source'),'calendar_date':True,'original':r})
                elif kind=='cardio':
                    ts=iso(stamp(r['timestamp']));source=r.get('data source','');total=num(r.get('total'));workout=num(r.get('workout'));background=num(r.get('background'))
                    if total is None:continue
                    if workout is not None and background is not None and abs(total-workout-background)>.001:raise ValueError('Cardio components do not match total')
                    k=(ts,source);entry={'total':total,'file':name,'row':i}
                    if k in cardio and abs(cardio[k]['total']-total)>.000001:raise ValueError('Conflicting minute cardio values')
                    cardio[k]=entry
                elif kind=='sleep':
                    start=stamp(r['sleep_start']);end=stamp(r['sleep_end']);value=num(r.get('minutes_asleep'),0,1440)
                    if end<=start or value is None or value>(end-start).total_seconds()/60+1:raise ValueError('Invalid sleep duration')
                    add('sleep:'+r['sleep_id'],'sleep',end.astimezone(TZ).date().isoformat(),value,name,i,{'sleep_id':r['sleep_id'],'updated_at':r.get('sleep_last_updated'),'sleep':{'interval':{'startTime':iso(start),'endTime':iso(end)},'summary':{'minutesAsleep':value},'metadata':{'data_source':r.get('data_source'),'start_utc_offset':r.get('start_utc_offset'),'end_utc_offset':r.get('end_utc_offset')}}},iso(start),iso(end))
                elif kind=='stages':
                    start=stamp(r['sleep_stage_start']);end=stamp(r['sleep_stage_end'])
                    if end<start:raise ValueError('Invalid sleep stage')
                    stages[r['sleep_id']].append({'id':r['sleep_stage_id'],'type':r['sleep_stage_type'],'startTime':iso(start),'endTime':iso(end)})
    by_time=defaultdict(list)
    for (ts,source),r in cardio.items():by_time[ts].append((source,r))
    days=defaultdict(lambda:{'value':0,'sources':set(),'files':set(),'samples':0,'start':None,'end':None});ambiguous=set()
    for ts,items in by_time.items():
        date=stamp(ts).astimezone(TZ).date().isoformat()
        if len({round(p['total'],6) for _,p in items})>1:
            authoritative=[p for s,p in items if s=='Google Health App']
            if len(authoritative)!=1:ambiguous.add(date);continue
            p=authoritative[0]
        else:p=items[0][1]
        d=days[date];d['value']+=p['total'];d['samples']+=1;d['sources'].update(s for s,_ in items);d['files'].update(p['file'] for _,p in items);d['start']=min(d['start'] or ts,ts);d['end']=max(d['end'] or ts,ts)
    for date,d in days.items():
        if date in ambiguous:continue
        add('cardio:'+date,'google_cardio_load',date,round(d['value'],6),'Cardio Load (daily sum)',None,{'aggregation':'sum_of_unique_minute_increments','sources':sorted(d['sources']),'files':sorted(d['files']),'samples':d['samples'],'first_sample':d['start'],'last_sample':d['end'],'final':date<cutoff})
    if ambiguous:warnings.append({'ambiguous_cardio_days_skipped':sorted(ambiguous)})
    for p in points.values():
        if p['type']=='sleep':
            p['raw']['sleep']['stages']=sorted({s['id']:s for s in stages[p['raw']['sleep_id']]}.values(),key=lambda s:s['startTime'])
    stats={}
    for kind in sorted({p['type'] for p in points.values()}):
        subset=[p for p in points.values() if p['type']==kind];dates=sorted(p['date'] for p in subset);stats[kind]={'records':len(subset),'first':dates[0],'last':dates[-1]}
    return list(points.values()),{'archive_sha256':archive_hash,'exported_at':iso(exported),'files_read':len(selected),'metrics':stats,'warnings':warnings}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('archive');parser.add_argument('--import-url');args=parser.parse_args();points,summary=parse_archive(args.archive);print(json.dumps(summary))
    if not args.import_url:return
    if args.import_url!='https://chief-of-staff.gremiercoffee.workers.dev/api/agent/takeout-import-once-20261101':raise ValueError('Import destination must be the existing Chief of Staff worker')
    agent=Path('C:/Users/Yoni/.tokens/cos-agent-key.txt').read_text().strip();ack=0
    for offset in range(0,len(points),20):
        body=json.dumps({'archive_sha256':summary['archive_sha256'],'exported_at':summary['exported_at'],'records':points[offset:offset+20]}).encode()
        request=Request(args.import_url,data=body,headers={'content-type':'application/json','x-agent-key':agent,'user-agent':'DaynotePersonalImporter/1.0'},method='POST')
        with urlopen(request,timeout=90) as response:result=json.load(response)
        ack+=result['imported']
        if offset%200==0:print(json.dumps({'acknowledged_records':ack}),flush=True)
    print(json.dumps({'import_complete':True,'acknowledged_records':ack}))
if __name__=='__main__':main()
