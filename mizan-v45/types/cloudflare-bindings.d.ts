// Only runtime-specific types enter the mixed browser/server TypeScript project.
// Keep DOM Request/Response definitions for the existing frontend.
declare module 'cloudflare:workers' {}
type D1Database = import('../worker-runtime').D1Database;
type Fetcher = import('../worker-runtime').Fetcher;
