#!/usr/bin/env python3
"""FCST-0005 diagnostics: the centre equation per horizon and outcome-free counterfactuals.
INPUT : research/results/FCST-0003-engine-trace.json (a saved artifact; no price file, no snapshot and no targets are read).
USES NO OUTCOMES: nothing here compares a forecast with a later price. Counterfactuals show what the formula does to the SAME inputs.
Replication check: the reconstructed centre must equal the artifact's centerLogReturn for every row."""
import json,math,sys,statistics as st
src,out=sys.argv[1],sys.argv[2]
d=json.load(open(src)); rows=[r for r in d['rows'] if r.get('available') and not r.get('abstain')]
H=[1,5,21,63,126,252]
def center(bias,h,dsig,escale,mult,cap=True):
    req=bias*dsig*.25 if h==1 else bias*.15*h/252
    lim=escale*.5
    clip=max(-lim,min(lim,req)) if cap else req
    return (clip*mult if clip>0 else clip),req,clip
def direction(c,h):
    pct=100*(math.exp(c)-1); thr=.1 if h==1 else .25 if h<=5 else .5
    return 'up' if pct>thr else 'down' if pct<-thr else 'neutral'
# replication
maxerr=0
for r in rows:
    c,_,_=center(r['bias'],r['h'],r['dailySigma'],r['expectedScale'],r['positiveTiltMultiplier'])
    maxerr=max(maxerr,abs(c-r['centerLogReturn']))
    assert direction(c,r['h'])==({'محايد':'neutral','صاعد':'up','هابط':'down'}[r['direction']]),(r['symbol'],r['h'])
assert maxerr<1e-12,maxerr
q=lambda xs,p:sorted(xs)[min(len(xs)-1,int(p*(len(xs)-1)+.5))] if xs else None
med=lambda xs:st.median(xs) if xs else None
res={'replication':{'rows':len(rows),'maxAbsErrorCenter':maxerr,'directionsReproduced':True},'perHorizon':[]}
# factor availability / weights
factors=['growth','quality','debt','valuation','trend','momentum','liquidity','risk','levels','market','sector','events']
for h in H:
    R=[r for r in rows if r['h']==h]
    thr=.1 if h==1 else .25 if h<=5 else .5
    thr_log=math.log(1+thr/100)
    # neutral-exit requirement on bias (current mapping)
    need=[]
    for r in R:
        unit=r['dailySigma']*.25 if h==1 else .15*h/252      # log-return per unit bias
        need.append({'up':thr_log/(unit*r['positiveTiltMultiplier']),'down':-math.log(1-thr/100)/unit})
    wmed={f:med([r['weights'][f] for r in R]) for f in factors}
    avail={f:sum(1 for r in R if r['signals'].get(f) is not None) for f in factors}
    cov=[r['coverage'] for r in R]
    absb=[abs(r['bias']) for r in R]
    variants={}
    def run(name,biasf,mult_on=True,cap=True):
        cnt={'neutral':0,'up':0,'down':0};cs=[];ratio=[]
        for r in R:
            m=r['positiveTiltMultiplier'] if mult_on else 1
            c,_,_=center(biasf(r),h,r['dailySigma'],r['expectedScale'],m,cap)
            cnt[direction(c,h)]+=1; cs.append(abs(c)); ratio.append(abs(c)/r['sigmaSqrtH'])
        variants[name]={**cnt,'medianAbsCentreOverSigmaSqrtH':med(ratio),'medianAbsCentrePct':100*med(cs)}
    run('V0_current',lambda r:r['bias'])
    run('V1_renormalise_available_weights',lambda r:r['biasIfRenormalized'])
    run('V2_no_volume_multiplier',lambda r:r['bias'],mult_on=False)
    run('V3_renormalise_and_no_multiplier',lambda r:r['biasIfRenormalized'],mult_on=False)
    run('V4_current_without_cap',lambda r:r['bias'],cap=False)
    # scale the current mapping would need for the MEDIAN-|bias| stock to touch the neutral edge (diagnostic, not a proposal)
    unit_med=med([ (r['dailySigma']*.25 if h==1 else .15*h/252) for r in R])
    scale_needed=thr_log/(med(absb)*unit_med)
    res['perHorizon'].append({'h':h,'rows':len(R),'neutralThresholdPct':thr,
      'fixedDenominator':100,'medianCoveragePct':med(cov),'minCoveragePct':min(cov),
      'medianAbsBias':med(absb),'p90AbsBias':q(absb,.9),'maxAbsBias':max(absb),
      'logReturnPerUnitBias_median':unit_med,'maxPossibleCentrePct_atBias1':100*(math.exp(unit_med)-1),
      'biasNeededUp_withMultiplier06_min':min(n['up'] for n in need)*1,'biasNeededUp_noMultiplier_median':med([n['up']*r['positiveTiltMultiplier'] for n,r in zip(need,R)]),
      'biasNeededDown_median':med([n['down'] for n in need]),'biasNeededDown_min':min(n['down'] for n in need),
      'rowsWhereExitUpIsMathematicallyPossible':sum(1 for n in need if n['up']<=1),
      'rowsWhereExitDownIsMathematicallyPossible':sum(1 for n in need if n['down']<=1),
      'rowsWithObservedBiasBeyondNeeded':sum(1 for n,r in zip(need,R) if (r['bias']>0 and r['bias']>=n['up']) or (r['bias']<0 and -r['bias']>=n['down'])),
      'capBinding':sum(1 for r in R if r['clipped']),
      'multiplier06Rows':sum(1 for r in R if r['positiveTiltMultiplier']<1),
      'scaleMultipleNeededForMedianStockToTouchNeutralEdge':scale_needed,
      'medianWeights':wmed,'factorAvailableStocks':avail,'variants':variants})
# horizon convergence: spread of the six centres per stock (log return and in S units), current vs variants
bystock={}
for r in rows: bystock.setdefault(r['symbol'],{})[r['h']]=r
def spread(name,biasf,mult_on=True):
    sp=[]
    for s,hs in bystock.items():
        if len(hs)<6: continue
        cs=[center(biasf(hs[h]),h,hs[h]['dailySigma'],hs[h]['expectedScale'],hs[h]['positiveTiltMultiplier'] if mult_on else 1)[0] for h in H]
        sp.append(max(cs)-min(cs))
    return {'stocks':len(sp),'medianSpreadLogAcrossSixHorizons':med(sp)}
res['horizonSpread']={'V0_current':spread('v0',lambda r:r['bias']),'V1_renormalise':spread('v1',lambda r:r['biasIfRenormalized']),'V3_renorm_no_multiplier':spread('v3',lambda r:r['biasIfRenormalized'],False)}
# how many stocks keep the SAME direction label in all six horizons under each variant (convergence of the call)
def same_dir(biasf,mult_on=True):
    n=0
    for s,hs in bystock.items():
        if len(hs)<6: continue
        ds={direction(center(biasf(hs[h]),h,hs[h]['dailySigma'],hs[h]['expectedScale'],hs[h]['positiveTiltMultiplier'] if mult_on else 1)[0],h) for h in H}
        n+= (len(ds)==1)
    return n
res['sameDirectionInAllSixHorizons']={'V0_current':same_dir(lambda r:r['bias']),'V1':same_dir(lambda r:r['biasIfRenormalized']),'V3':same_dir(lambda r:r['biasIfRenormalized'],False),'stocks':sum(1 for hs in bystock.values() if len(hs)==6)}
json.dump(res,open(out,'w'),ensure_ascii=False,indent=1)
print(json.dumps({k:res[k] for k in('replication','horizonSpread','sameDirectionInAllSixHorizons')},ensure_ascii=False))
for p in res['perHorizon']:
    print(p['h'],{k:round(v,4) if isinstance(v,float) else v for k,v in p.items() if k in('medianCoveragePct','medianAbsBias','maxAbsBias','biasNeededUp_withMultiplier06_min','biasNeededDown_min','rowsWhereExitUpIsMathematicallyPossible','rowsWhereExitDownIsMathematicallyPossible','rowsWithObservedBiasBeyondNeeded','capBinding','multiplier06Rows','scaleMultipleNeededForMedianStockToTouchNeutralEdge')})
    for n,v in p['variants'].items(): print('   ',n,{k:(round(x,4) if isinstance(x,float) else x) for k,x in v.items()})
