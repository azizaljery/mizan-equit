import {readFile,writeFile} from 'node:fs/promises';
import {runAzizHybridReplay} from '../src/aziz-algorithm.mjs';
const [inputPath,outputPath,evaluationAsOf]=process.argv.slice(2);
if(!inputPath||!outputPath||!evaluationAsOf)throw Error('Usage: node scripts/run-hybrid-replay.mjs input.json NEW-output.json evaluationAsOf');
const input=JSON.parse(await readFile(inputPath,'utf8'));
const datasets=Array.isArray(input.datasets)?input.datasets:[input];
const results=datasets.flatMap(data=>[5,21].map(horizon=>runAzizHybridReplay(data,{horizon,evaluationAsOf})));
// Exclusive create: an old forecast or report must never be overwritten by replay.
await writeFile(outputPath,JSON.stringify({kind:'research_replay_not_live_accuracy',results},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({saved:outputPath,runs:results.length,canActivate:false}));
