#!/usr/bin/env python3
"""Explains the 7 forecast rows whose direction changed between the production engine and the session-volume fix (v1 rule).
Reads ONLY two saved artifacts (no snapshot is opened): FCST-0004-session-volume-compare.json and FCST-0003-engine-trace.json.
usage: fcst0004-direction-rows.py <compare.json> <engine-trace.json> <out.json>"""
import json,math,sys
c=json.load(open(sys.argv[1])); t=json.load(open(sys.argv[2]))
T={(r['symbol'],r['h']):r for r in t['rows']}
thr=lambda h:.1 if h==1 else .25 if h<=5 else .5          # neutral band (%), as in tests/forecast-fcst0003.test.mjs
rows=[]
for x in c['rows']:
    for o,n in zip(x['old']['fc'],x['new']['fc']):
        if o['direction']==n['direction']: continue
        h=o['h']; tr=T[(x['symbol'],h)]
        oc=100*math.expm1(o['center']) if o.get('center') is not None else None
        # old engine output has no `center` field: use predictedPrice / reference
        oc=100*(o['predictedPrice']/tr['referencePrice']-1)
        nc=100*math.expm1(n['center'])
        orv=x['old']['cond']['relativeVolume']; nrv=x['new']['cond']['relativeVolume']
        om=tr['positiveTiltMultiplier']; nm=.6 if nrv<1.1 else 1.0           # rule in lib/forecast-conditions.ts:112
        ceil=.15*h/252
        implied_new_bias=(math.log1p(nc/100)/(ceil*nm)) if h>1 else None
        rows.append(dict(symbol=x['symbol'],h=h,oldDirection=o['direction'],newDirection=n['direction'],neutralBandPct=thr(h),
          oldChangePct=round(oc,4),newChangePct=round(nc,4),oldBias=round(tr['bias'],4),impliedNewBias=None if implied_new_bias is None else round(implied_new_bias,4),
          oldRelativeVolume=round(orv,3),newRelativeVolume=round(nrv,3),oldMultiplier=om,newMultiplier=nm,
          cause=('multiplier switched 0.6 -> 1.0 (relative volume crossed 1.1); bias unchanged' if (om!=nm and h>1) else 'tiny shift across the neutral-band edge')))
json.dump(dict(id='FCST-0004-direction-rows',count=len(rows),rows=rows),open(sys.argv[3],'w'),ensure_ascii=False,indent=1)
for r in rows: print(r)
