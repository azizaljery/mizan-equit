import type {ReactNode} from 'react';
import {LockKeyhole} from 'lucide-react';
import {EmptyState} from './empty-state';
import {cn} from '@/lib/utils';

/** Owner sign-in goes through Cloudflare Access at /api/admin/signin, which returns to `returnTo` (same-origin path only). */
export const signInHref=(returnTo:string)=>'/api/admin/signin?return_to='+encodeURIComponent(returnTo);

/** Calm replacement for a 401 error: explains that the section is private and offers the sign-in link. */
export function SignInPrompt({returnTo,title='هذا القسم خاص بحساب مالك ميزان',children,compact=false,className}:{returnTo:string;title?:ReactNode;children?:ReactNode;compact?:boolean;className?:string}){
 const link=<a className="secondary-btn" href={signInHref(returnTo)} target="_top">تسجيل الدخول بحساب مالك ميزان</a>;
 if(compact)return <div className={cn('sign-in-inline',className)} role="status"><LockKeyhole size={16} aria-hidden="true"/><span>{children??title}</span>{link}</div>;
 return <EmptyState className={className} title={title} icon={<LockKeyhole aria-hidden="true"/>} action={link}>{children??'سجّل الدخول لعرض بياناتك المحفوظة في ميزان.'}</EmptyState>;
}
