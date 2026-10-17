'use client';
import {useEffect,useState} from 'react';
import {cn} from '@/lib/utils';

/** Secondary links inside one section (e.g. the screener and its follow-up board). Marks the open page with aria-current. */
export function SectionSubnav({label,links,className}:{label:string;links:readonly {href:string;label:string}[];className?:string}){
 const [path,setPath]=useState('');
 useEffect(()=>{setPath(window.location.pathname.replace(/\/+$/,'')||'/');},[]);
 return <nav className={cn('section-subnav',className)} dir="rtl" aria-label={label}><ul>{links.map(l=><li key={l.href}><a href={l.href} aria-current={path===l.href?'page':undefined}>{l.label}</a></li>)}</ul></nav>;
}
