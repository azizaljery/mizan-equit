#!/usr/bin/env python3
"""FCST-0004 valuation gap: why the valuation factor is null and what its absence does to the centre.
Inputs (read-only): the FCST-0003 engine snapshot (peers, facts) and the FCST-0003 engine trace (per stock/horizon signals).
No returns, no accuracy, no synthetic values: only counts, weights and bounds.
usage: fcst0004-valuation-gap.py <snapshot.json.gz> <engine-trace.json> <out.json>"""
import gzip,json,sys,statistics as st,collections
snapf,tracef,outf=sys.argv[1:4]
snap=json.load(gzip.open(snapf)); trace=json.load(open(tracef))
sym=[]
for e in snap['entries']:
    r=e['report']
    peers=r['peers']; pe_ok=[p for p in peers if isinstance(p.get('pe'),(int,float)) and p['pe']>0]
    sym.append(dict(symbol=e['symbol'],market='sa' if e['symbol'].endswith('.SR') else 'us',peers=len(peers),peersWithPositivePE=len(pe_ok),
                    trailingNetIncomeFacts=sum(1 for f in r['facts'] if f['key']=='netIncome' and f['period']=='trailing'),
                    sharesFacts=sum(1 for f in r['facts'] if f['key']=='shares' and f['period']!='trailing')))
dist=collections.Counter((s['market'],s['peersWithPositivePE']) for s in sym)
ge2=[s['symbol'] for s in sym if s['peersWithPositivePE']>=2]
H=[1,5,21,63,126,252]; per={}
for h in H:
    R=[r for r in trace['rows'] if r['h']==h and r.get('coverage') is not None]; n=len(R)
    keys=list(R[0]['weights']); lost=collections.Counter()
    for r in R:
        for k in keys:
            if r['signals'][k] is None: lost[k]+=r['weights'][k]
    totlost=sum(lost.values()); wv=R[0]['weights']['valuation']
    b=[abs(r['bias']) for r in R]; rn=[abs(r['biasIfRenormalized']) for r in R if r.get('biasIfRenormalized') is not None]
    per[h]=dict(n=n,valuationWeight=wv,valuationNullShare=round(sum(r['signals']['valuation'] is None for r in R)/n,4),
        coverageMedian=st.median(r['coverage'] for r in R),coverageMin=min(r['coverage'] for r in R),
        absBiasMedian=round(st.median(b),4),absBiasIfRenormalizedMedian=round(st.median(rn),4),
        renormalizationFactorMedian=round(st.median(rn)/st.median(b),3),
        valuationShareOfLostWeight=round(lost['valuation']/totlost,3) if totlost else None,
        maxExtraAbsBiasFromValuation=wv/100,
        maxExtraCentreLogReturn=round((.15*h/252*wv/100) if h>1 else None,6) if h>1 else None)
json.dump(dict(id='FCST-0004-valuation-gap',stocks=len(sym),peerCountDistribution={f'{k[0]}|{k[1]}':v for k,v in sorted(dist.items())},
               stocksWithTwoPeers=ge2,perHorizon=per,symbols=sym),open(outf,'w'),ensure_ascii=False,indent=1)
print(json.dumps(dict(peerCountDistribution={f'{k[0]}|{k[1]}':v for k,v in sorted(dist.items())},stocksWithTwoPeers=ge2,perHorizon=per),ensure_ascii=False,indent=1))
