"""Build an aggregate-only admin import from the private, validated FinBot snapshot.

Usage: python scripts/prepare-finbot-report.py PRIVATE_SNAPSHOT --output PRIVATE_OUTPUT
Never write the input or output into the public website directory.
"""
import argparse
from collections import defaultdict
from datetime import date
import hashlib
import json
from pathlib import Path


def build(snapshot):
    meta = snapshot['metadata']
    year, as_of = meta['report_year'], meta['as_of_date']
    assert year == date.fromisoformat(as_of).year
    monthly = []
    for control in snapshot['monthly_accounting']:
        month = control['month']
        assert month.startswith(str(year) + '-') and month <= as_of[:7]
        rows = [r for r in snapshot['ledger_transactions'] if r['document_date'].startswith(month)]
        assert all(r['document_date'] <= as_of for r in rows)
        categories, suppliers = defaultdict(int), defaultdict(int)
        sources = {'website': 0, 'other': 0}
        website_count = 0
        totals = dict.fromkeys(['income', 'cost_of_sales', 'operating_expenses', 'fixed_assets'], 0)
        for row in rows:
            value = row['tax_basis_minor']
            assert type(value) is int
            group = row['group']
            totals[group] += value
            categories[(row['category_he'], group)] += value
            if group == 'income':
                is_website = row['website_order_number'] is not None
                sources['website' if is_website else 'other'] += value
                website_count += int(is_website)
            elif group != 'fixed_assets':
                suppliers[row['counterparty'] or 'Unspecified supplier'] += value
        totals['expenses'] = totals['cost_of_sales'] + totals['operating_expenses']
        totals['net'] = totals['income'] - totals['expenses']
        for key, value in totals.items():
            assert value == control[key + '_minor'], f'{month}: {key} does not reconcile'
        assert sum(sources.values()) == totals['income']
        monthly.append({**control, 'sources_minor': sources, 'website_receipt_count': website_count,
            'categories': [{'label': k[0], 'group': k[1], 'amount_minor': v} for k,v in categories.items()],
            'suppliers': [{'label': k, 'amount_minor': v} for k,v in suppliers.items()]})
    assert len(set(m['month'] for m in monthly)) == len(monthly)
    for key, amount in meta['totals_minor'].items():
        assert sum(m[key + '_minor'] for m in monthly) == amount
    current_expenses = [r for r in snapshot['expense_register'] if (r['document_date'] or '').startswith(str(year)+'-')]
    payload = {'schema_version': 1, 'report_year': year, 'as_of_date': as_of,
        'currency': 'ILS', 'monthly': monthly,
        'coverage': {'ledger_transactions': len(snapshot['ledger_transactions']),
            'website_receipts': sum(m['website_receipt_count'] for m in monthly),
            'unreported_expenses_2026': sum(not r['in_reported_export'] for r in current_expenses),
            'undated_expenses_all_years': sum(r['document_date'] is None for r in snapshot['expense_register'])},
        'sources': [{k: s[k] for k in ('file','sha256')} for s in meta['sources']]}
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode('utf-8')
    return {'report_year': year, 'as_of_date': as_of, 'captured_at': meta['captured_at'],
        'source_sha256': hashlib.sha256(encoded).hexdigest(), 'payload': payload}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('snapshot', type=Path)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    public_root = Path(__file__).resolve().parents[1]
    assert not args.output.resolve().is_relative_to(public_root), 'Use a private output directory outside the website'
    result = build(json.loads(args.snapshot.read_text(encoding='utf-8')))
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'year': result['report_year'], 'as_of': result['as_of_date'],
        'months': len(result['payload']['monthly']), 'sha256': result['source_sha256']}))
