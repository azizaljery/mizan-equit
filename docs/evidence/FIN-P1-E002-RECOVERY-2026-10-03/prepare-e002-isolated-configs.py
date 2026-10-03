#!/usr/bin/env python3
"""Prepare source-exact test-only Wrangler configs and migration source inventory."""
from pathlib import Path
import hashlib
import json
import subprocess

CHECKOUT = Path("/workspace/scratch/621fd6e6940e/mizan-site-open-v52")
WORKTREES = Path("/workspace/scratch/621fd6e6940e/e002-worktrees")
RUNROOT = Path("/workspace/scratch/621fd6e6940e/e002-isolated-2026-10-03")
EVIDENCE = Path("/workspace/shared/engineering-qa/mizan-e002-2026-10-03")
SOURCES = {
    "v51": "65b623639588f40eb73c5d76616308737ab33f33",
    "v52": "93808ca6b93188581adda966a3caf019d741898c",
}
LOCAL_DB_ID = "00000000-0000-4000-8000-202610032032"
LOCAL_DB_NAME = "mizan-e002-isolated-20261003"

def git(*args):
    return subprocess.check_output(["git", "-C", str(CHECKOUT), *args])

def sha256(data):
    return hashlib.sha256(data).hexdigest()

if RUNROOT.exists():
    raise SystemExit(f"Refusing to reuse existing isolated state path: {RUNROOT}")
RUNROOT.mkdir(parents=True)
state_root = RUNROOT / ".wrangler" / "state"
state_root.mkdir(parents=True)
config_manifest = {
    "campaign": "E002-EVIDENCE-RECOVERY-2026-10-03",
    "createdAt": "2026-10-03T20:34:00Z",
    "environment": "isolated local Wrangler with synthetic D1 only",
    "localPersistenceRoot": str(state_root),
    "syntheticDatabase": {"name": LOCAL_DB_NAME, "id": LOCAL_DB_ID, "binding": "DB"},
    "productionCloudflareCredentialsPresentInProcessEnvironment": False,
    "productionCronEvents": "disabled in test-only configuration; no schedules invoked",
    "configs": {},
}
for label, commit in SOURCES.items():
    worktree = WORKTREES / label
    if subprocess.check_output(["git", "-C", str(worktree), "rev-parse", "HEAD"], text=True).strip() != commit:
        raise SystemExit(f"Unexpected {label} worktree HEAD")
    built = worktree / "dist/server/wrangler.json"
    identity = json.loads((worktree / "lib/deployment-identity.json").read_text(encoding="utf-8"))
    if identity.get("commit") != commit:
        raise SystemExit(f"Build identity mismatch for {label}")
    cfg = json.loads(built.read_text(encoding="utf-8"))
    cfg["name"] = "mizan-equity"
    cfg["d1_databases"] = [{
        "binding": "DB",
        "database_name": LOCAL_DB_NAME,
        "database_id": LOCAL_DB_ID,
        "migrations_dir": str(worktree / "drizzle"),
    }]
    cfg["triggers"] = {"crons": []}
    config_text = json.dumps(cfg, ensure_ascii=False, indent=2) + "\n"
    work_config = worktree / "dist/server/wrangler-e002.json"
    evidence_config = EVIDENCE / f"wrangler-e002-{label}.json"
    work_config.write_text(config_text, encoding="utf-8")
    evidence_config.write_text(config_text, encoding="utf-8")
    wrangler_state_link = worktree / ".wrangler/state"
    if wrangler_state_link.exists() or wrangler_state_link.is_symlink():
        raise SystemExit(f"Refusing to replace existing persistence path: {wrangler_state_link}")
    wrangler_state_link.symlink_to(state_root, target_is_directory=True)
    config_manifest["configs"][label] = {
        "sourceSha": commit,
        "buildIdentityCommit": identity["commit"],
        "testConfigWorktreePath": str(work_config),
        "testConfigEvidencePath": str(evidence_config),
        "testConfigSha256": sha256(config_text.encode("utf-8")),
        "worktreePersistenceSymlink": str(wrangler_state_link),
        "migrationDirectory": str(worktree / "drizzle"),
    }

sql_inventory = {}
for label, commit in SOURCES.items():
    files = subprocess.check_output(["git", "-C", str(CHECKOUT), "ls-tree", "-r", "--name-only", commit, "--", "drizzle"], text=True).splitlines()
    sql_files = [name for name in files if name.startswith("drizzle/") and name.endswith(".sql")]
    items = []
    for name in sql_files:
        blob = git("show", f"{commit}:{name}")
        items.append({"path": name, "sha256": sha256(blob), "bytes": len(blob)})
    journal = git("show", f"{commit}:drizzle/meta/_journal.json")
    sql_inventory[label] = {"sourceSha": commit, "count": len(items), "files": items, "journalSha256": sha256(journal)}
if sql_inventory["v51"]["files"] != sql_inventory["v52"]["files"] or sql_inventory["v51"]["journalSha256"] != sql_inventory["v52"]["journalSha256"]:
    raise SystemExit("Migration source parity failed")
source_manifest = {
    "evidenceId": "EVD-RB-003",
    "campaign": "E002-EVIDENCE-RECOVERY-2026-10-03",
    "generatedAt": "2026-10-03T20:34:00Z",
    "kind": "migration_source_identity_before_local_apply",
    "status": "SOURCE_PARITY_VERIFIED_PENDING_LOCAL_APPLY",
    "sources": sql_inventory,
    "sourceParity": True,
    "sqlMigrationCount": sql_inventory["v51"]["count"],
    "commands": [
        "git ls-tree -r --name-only <source-sha> -- drizzle",
        "git show <source-sha>:<migration-path> | sha256sum",
        "git show <source-sha>:drizzle/meta/_journal.json | sha256sum"
    ],
    "scopeLimit": "Source identity only; local migrations have not yet been applied and no schema/data check is claimed here."
}
(EVIDENCE / "EVD-RB-003-migration-source-manifest.json").write_text(json.dumps(source_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(EVIDENCE / "wrangler-e002-config-manifest.json").write_text(json.dumps(config_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({
    "localPersistenceRoot": str(state_root),
    "configs": config_manifest["configs"],
    "migrationCount": source_manifest["sqlMigrationCount"],
    "migrationSourceParity": source_manifest["sourceParity"],
    "migrationManifestPath": str(EVIDENCE / "EVD-RB-003-migration-source-manifest.json"),
    "configManifestPath": str(EVIDENCE / "wrangler-e002-config-manifest.json")
}, ensure_ascii=False, indent=2))
