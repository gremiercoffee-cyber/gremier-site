"""Prepare private FinBot income rows for the admin-only finbot_income_sources table.

Usage: python scripts/prepare-revenue-import.py PRIVATE_SNAPSHOT PRIVATE_OUTPUT
This file contains customer names: never publish the generated JSON as a site asset.
"""
import argparse
import json
import re
from pathlib import Path

def build(snapshot):
    rows=[dict(document_reference=re.sub(r'^0+(?=\d)','',str(r['document_number']).strip()),
               document_date=r['document_date'],amount_minor=r['tax_basis_minor'],
               customer_name=r['counterparty'] or '',website_order_number=r['website_order_number'])
          for r in snapshot['ledger_transactions'] if r['group']=='income']
    assert len({r['document_reference'] for r in rows})==len(rows)
    assert all(type(r['amount_minor']) is int for r in rows)
    assert sum(r['amount_minor'] for r in rows)==snapshot['metadata']['totals_minor']['income']
    return rows

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args()
    assert not args.output.resolve().is_relative_to(Path(__file__).resolve().parents[1]),'Output must stay outside the website repository'
    rows=build(json.loads(args.snapshot.read_text(encoding='utf-8')))
    args.output.write_text(json.dumps(rows,ensure_ascii=False),encoding='utf-8')
    print(json.dumps({'rows':len(rows),'amount_minor':sum(r['amount_minor'] for r in rows)}))
