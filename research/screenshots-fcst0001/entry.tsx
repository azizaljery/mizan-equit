import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Forecasts} from '@/components/forecasts';
import data from './data.json';
import fs from 'node:fs';
fs.writeFileSync('/tmp/claude-0/shot/out.html', '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui,Tahoma,sans-serif;max-width:430px;margin:0 auto;padding:12px;line-height:1.7}.forecast-card{border:1px solid #bbb;border-radius:8px;padding:10px;margin:10px 0}dl div{display:flex;justify-content:space-between;gap:8px;border-bottom:1px dotted #ddd}dt{color:#555}.reference{color:#444;font-size:13px}.notice{background:#fff7e0;padding:6px}</style></head><body>'+renderToStaticMarkup(<Forecasts data={data as any}/>)+'</body></html>');
