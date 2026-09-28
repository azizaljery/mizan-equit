import {GoldMarket} from '@/components/gold-market';
import {Scale} from 'lucide-react';
export default function GoldPage(){return <><header className="topbar gold-header"><a className="brand" href="/"><span className="brand-icon"><Scale size={28}/></span><span className="brand-name">ميزان</span></a><a className="source-link" href="/">الأسهم</a><a className="source-link" href="/gold" aria-current="page">ميزان الذهب</a><a className="source-link" href="/accuracy">دقة ميزان</a></header><GoldMarket/></>}
