// Isolated browser QA only. The generated public harness is removed before packaging.
import {createRoot} from 'react-dom/client';
import {useMemo,useState} from 'react';
import aapl from './fixtures/aapl-2026-09-05.json';
import jarir from './fixtures/jarir-2026-09-05.json';
import {makeDemo,technical} from '../lib/analysis';
import {forecasts} from '../lib/research-model';
import {Forecasts} from '../components/forecasts';
import {ReportDownload} from '../components/report-download';
import {AttachmentPanel} from '../components/attachment-panel';
import {Explain,HelpLayer} from '../components/explain';
import {SettingsProvider} from '../components/settings-context';
import {AnalysisHelpProvider} from '../components/analysis-help';
import {SourceLink} from '../components/source-link';
import {ResearchWorkspace} from '../components/research-workspace';
import {ScoreDetails} from '../components/score-details';
import {automaticAnalysis} from '../lib/automatic-analysis';
import {PriceChart} from '../components/market-charts';
import type {MarketReport} from '../lib/market-data';
import type {Attachment} from '../lib/attachments';
function fixture(symbol:string):MarketReport{return {...structuredClone(symbol==='AAPL'?aapl:jarir),mode:'historical'} as MarketReport;}
// GET-only transport fixture for visual portfolio QA. No authentication or production route is changed.
const originalFetch=window.fetch.bind(window);
const testPortfolio={id:'qa-portfolio',name:'محفظة اختبار العرض فقط',currency:'SAR',createdAt:'2026-09-01T10:20:00Z'};
window.fetch=async(input,init)=>{const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
 if(url.startsWith('/api/research')&&(!init?.method||init.method==='GET'))return Response.json({portfolios:[testPortfolio],activePortfolio:testPortfolio,unlocked:true,watch:[],history:[],backtests:[],cashEntries:[{id:'cash',portfolioId:testPortfolio.id,amount:1000,cashType:'deposit',currency:'SAR',createdAt:'2026-09-01T10:20:00Z'}],trades:[{id:'trade',portfolioId:testPortfolio.id,symbol:'4190.SR',companyName:'جرير — صفقة اختبار مصطنعة',side:'buy',quantity:10,price:16,currency:'SAR',createdAt:'2026-09-01T10:21:00Z',purchaseComparisons:[]}],pendingSymbols:[]});
 if(url.startsWith('/api/company/quote'))return Response.json({symbol:'4190.SR',price:16.3,currency:'SAR',quoteTime:'2026-09-03T12:00:00Z',retrievedAt:'2026-09-05T10:00:00Z',isOpen:false,delayed:true});
 return originalFetch(input,init);
};
function Harness(){const [symbol,setSymbol]=useState('4190.SR'),[attachment,setAttachment]=useState<Attachment|null>(null);const r=useMemo(()=>{const r=fixture(symbol);r.forecast=forecasts(r,null,Date.parse(r.asOf+'T20:00:00Z'));return r},[symbol]);return <SettingsProvider><h1>اختبار معزول — بيانات سوق محفوظة بتاريخ 5 سبتمبر 2026، وليست أسعارًا لحظية</h1><button onClick={()=>setSymbol('4190.SR')}>تجربة الربط السعودي</button><button onClick={()=>setSymbol('AAPL')}>تجربة الربط الأمريكي</button><p>{symbol}</p><AnalysisHelpProvider report={r}><section aria-label="اختبار عشرين شرحًا">{['RSI','P/E','P/B','ROE','ROA','ROIC','التدفق','جودة الأرباح','الدين','الهامش','السيولة','ATR','الدعم','المقاومة','الثقة','نطاق التوقع','EPS','PEG','P/S','القيمة السوقية'].map(term=><p key={term}><Explain term={term} value={term+' = 64.09'}/></p>)}</section><section aria-label="اختبار روابط المصادر">{r.news.slice(0,10).map((n,i)=><p key={i}><SourceLink href={n.url} publishedAt={n.date} retrievedAt={r.retrievedAt}>{n.title}</SourceLink></p>)}</section><ScoreDetails analysis={automaticAnalysis(r)}/></AnalysisHelpProvider><PriceChart prices={r.prices} tech={technical(r.prices)} count={90}/><Forecasts report={r}/><AttachmentPanel report={r} onUse={setAttachment}/><ReportDownload report={r} attachment={attachment}/><h2>اختبار عرض المحفظة بصفقة مصطنعة — لا تمثل حساب المستخدم</h2><ResearchWorkspace company={r.company} onAnalyze={()=>{}}/><HelpLayer/></SettingsProvider>}
createRoot(document.getElementById('root')!).render(<Harness/>);
