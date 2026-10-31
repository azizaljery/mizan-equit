/* FCST-0002 prep: count training records per (market,h,fold) exactly as run-fcst-0001.cjs builds them
 * (WARMUP/STEP/HORIZONS/FOLDS from fcst-lib; label < fold.start). Dates only — no model, no features, no prices printed.
 * v2: reads ONLY through dev-input-guard (approved manifest, SHA-256 verified before parsing, restricted root refused).
 * The v1 run (2026-10-31) read the sealed research-data copy directly; see FCST-0002-DATA-AND-INTEGRATION.md §2.
 * usage: node fcst0002-train-counts.cjs <manifest.lock> <manifest-sha256> <restricted-root> <out.json> */
const fs=require('fs');const F=require('./fcst-lib.cjs');const {openDevInput}=require('./dev-input-guard.cjs');
const [manifestPath,manifestSha256,restricted,outFile]=process.argv.slice(2);
const input=openDevInput({manifestPath,manifestSha256,restrictedRoots:[restricted]});
const recs=[];
for(const f of input.names){
 const d=input.read(f);
 const dates=(d.rows||[]).filter(r=>Array.isArray(r)&&typeof r[0]==='string'&&r[0]<=F.DEV_CUTOFF).map(r=>r[0]);
 const m=d.symbol.endsWith('.SR')?'sa':'us';
 for(let o=F.WARMUP-1;o<dates.length-1;o+=F.STEP)for(const h of F.HORIZONS){if(o+h>=dates.length)continue;recs.push({m,h,date:dates[o],label:dates[o+h],sym:d.symbol});}
}
const out={note:'training-set sizes per fold as constructed by FCST-0001 (label < fold.start). Counts only; not power.',firstOrigin:recs.reduce((a,r)=>r.date<a?r.date:a,'9999'),cells:[]};
const folds=[{id:'design',start:'2022-01-01'},...F.FOLDS];
for(const m of ['sa','us'])for(const h of F.HORIZONS)for(const fo of folds){const tr=recs.filter(r=>r.m===m&&r.h===h&&r.label<fo.start);
 out.cells.push({market:m,h,fold:fo.id,trainRows:tr.length,trainOriginDates:new Set(tr.map(r=>r.date)).size,trainSymbols:new Set(tr.map(r=>r.sym)).size,
  trainNonOverlapDates:Math.floor(new Set(tr.map(r=>r.date)).size*F.STEP/Math.max(h,F.STEP))});}
fs.writeFileSync(outFile,JSON.stringify(out,null,1));
