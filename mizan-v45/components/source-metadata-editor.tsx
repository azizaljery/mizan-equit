'use client';
import type {SourceConfig} from '@/lib/admin-config';
import type {SourceMetadata} from '@/lib/source-catalog';
export function SourceMetadataEditor({source,onChange}:{source:SourceConfig;onChange:(metadata:SourceMetadata)=>void}){
 const m=source.metadata||{market:'global',dataTypes:[source.kind],docsUrl:'',access:source.adapter==='reference'?'reference':'public-api',setup:'يلزم تحديد القارئ والحقول المطلوبة.',licenseRequired:false,keyRequired:false,coverage:'غير متحققة',delayMinutes:null,symbolMapping:'غير مهيأ',fieldMapping:'غير مهيأ',lineage:source.id};
 const change=(v:Partial<SourceMetadata>)=>onChange({...m,...v});
 return <details><summary>إعداد الربط والتغطية والمتطلبات</summary><div className="metric-grid">
 <label>السوق<select value={m.market} onChange={e=>change({market:e.target.value as SourceMetadata['market']})}><option value="sa">السعودي</option><option value="us">الأمريكي</option><option value="global">متعدد الأسواق</option></select></label>
 <label>طريقة الوصول<select value={m.access} onChange={e=>change({access:e.target.value as SourceMetadata['access']})}><option value="public-api">واجهة عامة</option><option value="licensed-api">واجهة تتطلب ترخيصًا</option><option value="document">تقارير ومستندات</option><option value="reference">مراجعة مرجعية</option></select></label>
 <label>وثائق الربط<input dir="ltr" value={m.docsUrl} onChange={e=>change({docsUrl:e.target.value})}/></label>
 <label>نوع البيانات<input value={m.dataTypes.join('، ')} onChange={e=>change({dataTypes:e.target.value.split(/[,،]/).map(s=>s.trim()).filter(Boolean)})}/></label>
 <label>التغطية<input value={m.coverage} onChange={e=>change({coverage:e.target.value})}/></label>
 <label>التأخير المعلن بالدقائق<input type="number" min={0} max={1440} value={m.delayMinutes??''} placeholder="غير متحقق" onChange={e=>change({delayMinutes:e.target.value===''?null:Number(e.target.value)})}/></label>
 <label>متطلبات التفعيل<textarea value={m.setup} onChange={e=>change({setup:e.target.value})}/></label>
 <label>ربط الرموز<textarea value={m.symbolMapping} onChange={e=>change({symbolMapping:e.target.value})}/></label>
 <label>ربط الحقول والوحدات<textarea value={m.fieldMapping} onChange={e=>change({fieldMapping:e.target.value})}/></label>
 <label>عائلة المصدر الأصلية<input value={m.lineage} onChange={e=>change({lineage:e.target.value})}/></label>
 <label><input type="checkbox" checked={m.licenseRequired} onChange={e=>change({licenseRequired:e.target.checked})}/> يتطلب التحقق من ترخيص العرض</label>
 <label><input type="checkbox" checked={m.keyRequired} onChange={e=>change({keyRequired:e.target.checked})}/> يحتاج مفتاحًا على الخادم</label>
 </div><p>هذه أوصاف إعداد، وليست تعليمات برمجية تُنفذ من الصفحة. لا تضع مفاتيح أو أسرار هنا. إعداد مصدر تجاري يتطلب قارئًا متوافقًا وصلاحيات على الخادم؛ التفعيل لا يشتري اشتراكًا.</p></details>;
}
