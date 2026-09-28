export function QualityBadge({label}:{label:string}){
 const state=label==='ممتازة'?'excellent':label==='جيدة'?'good':label==='متوسطة'||label==='ضعيفة'?'weak':label==='غير صالحة'?'invalid':'unknown';
 return <span className={`quality-badge is-${state}`}>{label}</span>;
}
