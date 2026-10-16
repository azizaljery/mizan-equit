import vinext from "vinext";
import { EVALUATE_DUE_CRON } from "./lib/jobs/schedule";
import { ACCURACY_SAMPLE_CRON } from "./lib/jobs/accuracy-schedule";
import { SCREENER_FOLLOWUP_CRON } from "./lib/jobs/screener-followup-schedule";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const MIZAN_EQUITY_DATABASE_ID =
  "e95b74e8-81d6-4beb-8ea2-ad59c863d21d";

const { d1, r2 } = hostingConfig;
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  name: "mizan-aziz",
  main: "./worker/index.ts",
  // Cutover done: crons now run here; they were cleared on the old mizan-equity worker.
  triggers: { crons: [EVALUATE_DUE_CRON, ACCURACY_SAMPLE_CRON, SCREENER_FOLLOWUP_CRON] },
  compatibility_flags: ["nodejs_compat"],
  // Workers Paid (owner upgraded 2026-10-16): explicit CPU limit per invocation = Paid default 30 s.
  // Deploy is rejected by Cloudflare on the Free plan, so a successful deploy also confirms the plan.
  limits: { cpu_ms: 30000 },
  vars: {
    MIZAN_BACKGROUND_CRON_ENABLED: "true",
    ACCESS_TEAM_DOMAIN: "solitary-frost-7b9b.cloudflareaccess.com",
    ACCESS_AUD: "582c09009e29c93fefe8a25e12dce19ef6278dee307d433d23ccfd595cf48655",
    MIZAN_OPENAI_MODEL: "gpt-5.6-sol",
    MIZAN_ANTHROPIC_MODEL: "claude-sonnet-5",
    MIZAN_DEEPSEEK_MODEL: "deepseek-v4-pro",
  },
  d1_databases: d1
    ? [{
        binding: d1,
        database_name: "mizan-equity-db",
        database_id: MIZAN_EQUITY_DATABASE_ID,
        migrations_dir: "drizzle",
      }]
    : [],
  r2_buckets: r2
    ? [{ binding: r2, bucket_name: "site-creator-r2" }]
    : [],
};

export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return {
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      ...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}),
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});