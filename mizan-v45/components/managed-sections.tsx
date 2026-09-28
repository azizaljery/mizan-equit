'use client';
import {Children,createContext,useContext,isValidElement,type ReactNode} from 'react';
import {HOME_SECTIONS,COMPANY_SECTIONS} from '@/lib/admin-config';
import {useMizanSettings,useMizanOwner} from './settings-context';
const Title=createContext<{id:string;title:string}|null>(null);
export function useSectionTitle(fallback:string){const ctx=useContext(Title);const aliases:Record<string,string>={'ابحث عن الشركة':'search','ملخص تنفيذي بسيط':'executive','الأخبار والإعلانات والأحداث':'news','إضافة ملف — اختياري':'files','المراجع الإضافية وأولوية المصادر':'sources'};const id=aliases[fallback]||[...HOME_SECTIONS,...COMPANY_SECTIONS].find(([,name])=>name===fallback)?.[0];return ctx&&ctx.id===id?ctx.title:fallback;}
export function SectionHeading({children,as='h3'}:{children:ReactNode;as?:'h1'|'h2'|'h3'}){const title=useSectionTitle(String(children)),Tag=as;return <Tag>{title}</Tag>}
export function ManagedSection({children}:{sectionKey:string;children:ReactNode;selfCollapsing?:boolean}){return <>{children}</>}
// Open collapsed ancestors only in response to an explicit navigation action.
export function revealElement(target:HTMLElement|null){if(!target)return;for(let el:HTMLElement|null=target;el;el=el.parentElement){if(el instanceof HTMLDetailsElement)el.open=true;}target.scrollIntoView({behavior:'smooth',block:'start'});}
export function ManagedSections({scope,children}:{scope:'home'|'company';children:ReactNode}){
 const settings=useMizanSettings(),owner=useMizanOwner(),nodes=Children.toArray(children);
 const keyed=nodes.filter(n=>isValidElement(n)&&typeof (n.props as any).sectionKey==='string');
 const ordered=settings.layout[scope].flatMap(s=>{const node=keyed.find(n=>(n as any).props.sectionKey===s.id);if(!node||!s.visible||s.deleted||s.audience==='owner'&&!owner)return [];const compact=['decision','summary','forecasts','private','conclusion'].includes(s.id);return [<Title.Provider value={{id:s.id,title:s.title}} key={s.id}><div className="managed-section" data-section={scope+'-'+s.id}>{(scope==='company'&&!compact&&!(node as any).props.selfCollapsing||scope==='home'&&s.id==='welcome')?<details className="auto-details"><summary>{s.title}</summary><div className="detail-body">{node}</div></details>:node}</div></Title.Provider>]});
 // Anchored controls, errors and sign-in remain outside this configurable list.
 return <div className="managed-sections">{ordered}</div>;
}
