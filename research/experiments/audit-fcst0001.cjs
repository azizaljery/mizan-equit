#!/usr/bin/env node
'use strict';
// Audit a published FCST-0001 summary only. Does not load prices, train, or read holdout.
const fs = require('node:fs');
const F = require('./fcst-lib.cjs');
function audit(r) {
  if (r.protocol !== 'PROTOCOL-FCST-0001' || r.devCutoff !== F.DEV_CUTOFF ||
      !r.meta || r.meta.lastLabel > F.DEV_CUTOFF || !Array.isArray(r.secondary) ||
      !Array.isArray(r.meta.skipped) || !r.profiles) throw Error('Unsupported or unsafe result summary');
  return {status:'DESCRIPTIVE_AUDIT_ONLY', protocol:r.protocol, cutoff:r.devCutoff,
    primary:r.primary, trainingEvidence:{available:'Skipped fold counts only; successful fold training counts are not retained in this JSON.',
      skipped:r.meta.skipped}, inferenceCells:r.secondary.map(c => ({market:c.markets,h:c.h,nRecords:c.nRecords,
      nOriginWeeks:c.nWeeks,effectiveN:c.nEff,trainingCount:null})),
    intervalCells:Object.entries(r.profiles).map(([cell,p])=>({cell,nominalCoverage:1-F.ALPHA_INTERVAL,
      R0:p.R0,C0:p.C0,pairedComparisonEstablished:false})),
    warnings:['Do not infer training size from effectiveN.',
      'Profiles may use different availability sets: paired replay records required for inference.',
      'Wilson intervals over pooled stock rows do not establish dependence-adjusted coverage uncertainty.',
      'Point summaries can weight stock rows while date inference weights dates: align estimands before new acceptance.',
      'Old nEff and p-values are reported unchanged, not independently validated.',
      'No claim of predictive improvement; no experiment was run.']};
}
module.exports = {audit};
if (require.main === module) {
  const [input,output] = process.argv.slice(2);
  if (!input || !output) throw Error('Usage: node audit-fcst0001.cjs published-summary.json new-audit.json');
  fs.writeFileSync(output,JSON.stringify(audit(JSON.parse(fs.readFileSync(input,'utf8'))),null,2),{flag:'wx'});
}
