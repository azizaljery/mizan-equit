// usage: bun neutrality-cli.ts <out.json>
import {deriveNeutrality} from './neutrality';
const fs = await import('node:fs'); const r = deriveNeutrality(); fs.writeFileSync(process.argv[2], JSON.stringify(r, null, 1)); console.log(JSON.stringify(r.perHorizon.map((p: any) => ({h: p.h, thr: p.neutralThresholdPct, bPrice: +p.maxAbsBias_priceOnly.toFixed(3), up1: +p.rows[0].upBias_x1.toFixed(3), up06: +p.rows[0].upBias_x06.toFixed(3), down: +p.rows[0].downBias_abs.toFixed(3)}))));
