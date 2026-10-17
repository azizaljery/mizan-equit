'use client';
import type {ReactNode} from 'react';
import {Menu,Scale,X} from 'lucide-react';
import {Sheet,SheetClose,SheetContent,SheetDescription,SheetHeader,SheetTitle,SheetTrigger} from '@/components/ui/sheet';
import {Tooltip,TooltipContent,TooltipTrigger} from '@/components/ui/tooltip';
import {cn} from '@/lib/utils';

/** Public sections of Mizan, in reading order. `hint` is shown as a tooltip and in the mobile menu. */
export const SITE_LINKS=[
 {href:'/',label:'تحليل شركة',hint:'ابحث عن سهم واحصل على التحليل والتوقع ومصادره'},
 {href:'/picks',label:'توصيات الشركات',hint:'الشركات الأرجح صعودًا يوميًا أو أسبوعيًا أو شهريًا من توقعات ميزان المسجلة'},
 {href:'/screener',label:'فرز التوقعات',hint:'مسح عينة من السوق للشركات المتوقع صعودها وحفظ الترشيح للقياس'},
 {href:'/accuracy',label:'دقة ميزان',hint:'نتائج التوقعات المحفوظة بعد اكتمال مددها'},
 {href:'/accuracy-sample',label:'اختبار عينة',hint:'اختبار تاريخي لعينة عشوائية من 20 شركة'},
 {href:'/gold',label:'الذهب',hint:'سعر الذهب الفوري والعيارات والشارت'},
 {href:'/aziz',label:'خوارزمية عزيز',hint:'مسار بحثي مستقل لتصحيح التوقع'},
 {href:'/tests',label:'اختباراتي',hint:'اختبارات التوقعات المحفوظة في حسابك'},
 {href:'/manual',label:'تحليل يدوي بالملفات',hint:'تحليل خطر الدخول من قوائم وأسعار ترفعها أنت؛ تُقرأ الملفات على جهازك'},
] as const;
export type SiteHref=typeof SITE_LINKS[number]['href'];

/**
 * Shared top bar. `current` marks the active section (aria-current="page"); `meta` keeps a page's own extra items
 * (e.g. market coverage) on wide screens. Below 1000px the links move into a side sheet.
 */
export function SiteHeader({current,caption='وضوح يسبق القرار',meta,className}:{current?:SiteHref;caption?:string;meta?:ReactNode;className?:string}){
 return <header className={cn('topbar site-header',className)} dir="rtl">
  <a className="brand" href="/" aria-label="ميزان الرئيسية"><span className="brand-icon"><Scale size={28} aria-hidden="true"/></span><span><span className="brand-name">ميزان</span><span className="brand-caption">{caption}</span></span></a>
  <nav className="site-nav" aria-label="أقسام ميزان"><ul>{SITE_LINKS.map(l=><li key={l.href}><Tooltip><TooltipTrigger asChild><a className={cn('site-nav-link',l.href==='/manual'&&'is-secondary')} href={l.href} aria-current={current===l.href?'page':undefined}>{l.label}</a></TooltipTrigger><TooltipContent side="bottom" sideOffset={6}>{l.hint}</TooltipContent></Tooltip></li>)}</ul></nav>
  {meta&&<span className="top-meta site-meta">{meta}</span>}
  <Sheet>
   <Tooltip><TooltipTrigger asChild><SheetTrigger asChild><button type="button" className="site-menu-button" aria-label="فتح قائمة الأقسام"><Menu size={22} aria-hidden="true"/></button></SheetTrigger></TooltipTrigger><TooltipContent side="bottom" sideOffset={6}>الأقسام</TooltipContent></Tooltip>
   <SheetContent side="right" showCloseButton={false} className="site-sheet" dir="rtl">
    <SheetHeader className="site-sheet-header"><SheetTitle>أقسام ميزان</SheetTitle><SheetDescription>اختر القسم الذي تريد فتحه.</SheetDescription><SheetClose asChild><button type="button" className="site-sheet-close" aria-label="إغلاق القائمة"><X size={20} aria-hidden="true"/></button></SheetClose></SheetHeader>
    <nav aria-label="أقسام ميزان — القائمة"><ul className="site-sheet-list">{SITE_LINKS.map(l=><li key={l.href}><a className="site-sheet-link" href={l.href} aria-current={current===l.href?'page':undefined}><strong>{l.label}</strong><small>{l.hint}</small></a></li>)}</ul></nav>
    {meta&&<p className="site-sheet-meta">{meta}</p>}
   </SheetContent>
  </Sheet>
 </header>;
}
