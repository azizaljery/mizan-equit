'use client';
import {createContext,useContext,useEffect,useState} from 'react';
import {DEFAULT_SETTINGS,validateSettings,type SiteSettings} from '@/lib/site-settings';
const ViewerContext=createContext(false);
export const useMizanOwner=()=>useContext(ViewerContext);
const Context=createContext<SiteSettings>(DEFAULT_SETTINGS);
export const useMizanSettings=()=>useContext(Context);
export function SettingsProvider({children}:{children:React.ReactNode}){const [settings,setSettings]=useState(DEFAULT_SETTINGS),[error,setError]=useState(''),[owner,setOwner]=useState(false);useEffect(()=>{let alive=true;const update=async()=>{try{const r=await fetch('/api/site-settings',{cache:'no-store'});if(!r.ok)throw Error();const payload=await r.json(),next=validateSettings(payload);if(alive){setOwner(payload.viewerIsOwner===true);setSettings(next);setError('')}}catch{if(alive)setError('تعذر تحميل إعدادات ميزان. قد لا تظهر آخر تغييرات الإدارة حتى تنجح إعادة المحاولة.')}};void update();window.addEventListener('mizan-settings-updated',update);return()=>{alive=false;window.removeEventListener('mizan-settings-updated',update)}},[]);return <ViewerContext.Provider value={owner}><Context.Provider value={settings}>{error&&<div className="notice error" role="alert">{error} <button className="link-btn" onClick={()=>window.dispatchEvent(new Event('mizan-settings-updated'))}>إعادة المحاولة</button></div>}{children}</Context.Provider></ViewerContext.Provider>}
