import postcss from 'postcss';
import tw from '@tailwindcss/postcss';
import fs from 'node:fs';
const from='app/globals.css',css=fs.readFileSync(from,'utf8');
const r=await postcss([tw()]).process(css,{from});
fs.writeFileSync(process.argv[2],r.css);console.log('css bytes',r.css.length);
