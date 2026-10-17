import {ASSET_RECOVERY_SCRIPT} from "@/lib/asset-recovery";
import type { Metadata } from "next";
import "./globals.css";
import {HelpLayer} from "@/components/explain";
import {SettingsProvider} from "@/components/settings-context";
import {Toaster} from "@/components/ui/sonner";
import {TooltipProvider} from "@/components/ui/tooltip";
export const metadata: Metadata = { title: "ميزان | من رمز الشركة إلى خلاصة القرار", description: "ابحث عن سهم سعودي أو أمريكي أو عالمي. أسعار وقوائم ومؤشرات تلقائية، وخلاصة للمخاطر والمستويات مع مصادرها ونواقصها.", icons:{icon:"/favicon.svg"} };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="ar" dir="rtl"><head><script dangerouslySetInnerHTML={{__html:ASSET_RECOVERY_SCRIPT}}/></head><body><SettingsProvider><TooltipProvider delayDuration={200}>{children}<HelpLayer/></TooltipProvider></SettingsProvider><Toaster dir="rtl" position="top-center" richColors closeButton/></body></html>; }
