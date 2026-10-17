/** Static, trusted stylesheet for the owner-only admin tools page (no user input). */
export const ADMIN_TOOLS_CSS = `/* Owner-only admin tools page. Uses the existing Mizan tokens (mizan-luxury.css) with fallbacks. */
.admin-tools{max-width:1180px;margin:0 auto;padding:24px 16px 64px;color:var(--text-primary,#162d2a);font-family:var(--font-body,inherit)}
.admin-tools h1{display:flex;align-items:center;gap:10px;font-family:var(--font-display,inherit);font-size:1.6rem;font-weight:700;margin:0 0 6px}
.admin-tools-header{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:16px;margin-bottom:16px;border-bottom:1px solid var(--border-gold,var(--mizan-gold-border,#d9c9a1))}
.admin-tools-nav{display:flex;flex-wrap:wrap;gap:12px}
.admin-tools-nav a{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:8px 14px;border:1px solid var(--border-strong,#789083);border-radius:9px;color:inherit;text-decoration:none;font-weight:600}
.admin-tools-nav a:hover{border-color:var(--mizan-gold-base,#b99244)}
.admin-tools-nav a:focus-visible,.admin-tools a:focus-visible{outline:2px solid var(--mizan-gold-base,#b99244);outline-offset:2px}
.admin-tools-icon{display:inline-block;vertical-align:-3px;margin-inline-end:6px;width:1.1em;height:1.1em;color:var(--mizan-gold-base,#b99244)}
.admin-tools-muted{color:var(--text-secondary,#5d6f66);font-size:.9rem;line-height:1.7}
.admin-tools-invalid{color:var(--chart-down,#ba625a);font-size:.9rem}
.admin-tools-signin{margin-bottom:16px;padding:10px 14px;border:1px dashed var(--border-strong,#bdcbc3);border-radius:10px;background:var(--surface,#fff)}
.admin-tools-signin summary{cursor:pointer;font-weight:600}
.admin-tools-signin ol{margin:8px 0 0;padding-inline-start:20px;list-style:decimal;line-height:1.9}
.admin-tools a{color:var(--mizan-emerald-base,#124b3f);text-underline-offset:3px}
.admin-tools-tablist{flex-wrap:wrap;height:auto;justify-content:flex-start;gap:4px;max-width:100%}
.admin-tools-tablist [data-slot=tabs-trigger]{min-height:40px;flex:0 0 auto}
.admin-tools-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,520px),1fr));gap:18px;margin-top:12px;align-items:start}
.admin-tools-stack{display:flex;flex-direction:column;gap:12px;min-width:0}
.admin-tools-subtitle{font-weight:700;margin:4px 0 0}
.admin-tools-facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:0}
.admin-tools-facts>div{padding:8px 10px;border:1px solid var(--border,#e2e8e4);border-radius:8px;background:var(--surface-elevated,var(--surface,#fff));min-width:0}
.admin-tools-facts dt{font-size:.78rem;color:var(--text-secondary,#5d6f66)}
.admin-tools-facts dd{margin:2px 0 0;font-weight:600;overflow-wrap:anywhere}
.admin-tools-scroll{overflow-x:auto;max-width:100%}
.admin-tools [data-slot=table] th,.admin-tools [data-slot=table] td{text-align:start}
.admin-tools-wrap{white-space:normal!important;min-width:180px;overflow-wrap:anywhere}
.admin-tools-pre{max-height:420px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--font-mono,ui-monospace,monospace);font-size:.8rem;line-height:1.6;padding:12px;border-radius:8px;background:var(--surface-elevated,#f5f7f6);border:1px solid var(--border,#e2e8e4)}
.admin-tools-ltr{font-family:var(--font-mono,ui-monospace,monospace);font-size:.85em;overflow-wrap:anywhere}
.admin-tools-form-row{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}
.admin-tools-field{display:flex;flex-direction:column;gap:6px;flex:1 1 160px;min-width:0}
.admin-tools-field [data-slot=native-select-wrapper]{width:100%}
.admin-tools-fieldset{border:1px solid var(--border,#e2e8e4);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:10px}
.admin-tools-fieldset legend{padding-inline:6px;font-weight:600;font-size:.92rem}
.admin-tools-checks{display:flex;flex-wrap:wrap;gap:14px}
.admin-tools-check{display:inline-flex;align-items:center;gap:8px;min-height:32px;cursor:pointer}
.admin-tools-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.admin-tools-details summary{cursor:pointer;font-weight:600}
.admin-tools-details ul,.admin-tools-notes{padding-inline-start:20px;list-style:disc;line-height:1.8;font-size:.9rem}
.admin-tools-auth-links{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.admin-tools-auth-links a{font-weight:700;color:inherit;text-decoration:underline}
.admin-tools-skeleton{display:flex;flex-direction:column;gap:8px}
.admin-tools-dialog-text{display:flex;flex-direction:column;gap:8px;text-align:start}
.admin-tools-badge-ok{background:#e3f3ec;color:#14634c;border-color:#9fd2bd}
.admin-tools-badge-warn{background:#fbf1dc;color:#7a5410;border-color:#e6c98c}
.admin-tools-badge-bad{background:#fbe6e3;color:#93362c;border-color:#e6aaa2}
@media(prefers-color-scheme:dark){
 :root:not([data-theme=light]) .admin-tools-badge-ok{background:#123b30;color:#9fe0c4}
 :root:not([data-theme=light]) .admin-tools-badge-warn{background:#3d2f12;color:#f0cf8a}
 :root:not([data-theme=light]) .admin-tools-badge-bad{background:#43201c;color:#f3b0a7}
}
@media(max-width:560px){.admin-tools h1{font-size:1.3rem}.admin-tools-facts{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(prefers-reduced-motion:reduce){.admin-tools *{animation:none!important;transition:none!important}}
`;
