#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

fail() {
  echo "❌ $1" >&2
  exit 1
}

[ -f docker-compose.yml ] || fail "docker-compose.yml غير موجود"
[ -f litellm_config.yaml ] || fail "litellm_config.yaml غير موجود"
[ -f .env.example ] || fail ".env.example غير موجود"
[ ! -f .env ] || echo "ℹ️ .env موجود محليًا — تأكد أنه غير tracked"

if command -v docker >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1; then
    echo "▸ docker compose config"
    # لا نحتاج مفاتيح حقيقية لفحص تركيب compose؛ نستخدم نسخة المثال مؤقتًا.
    if [ ! -f .env ]; then
      cp .env.example .env.preflight
      cp .env.preflight .env
      trap 'rm -f .env .env.preflight' EXIT
    fi
    docker compose config >/dev/null
    echo "✅ Docker Compose syntax"
  else
    echo "⚠️ Docker موجود لكن compose plugin غير متاح؛ تم تخطي فحص compose"
  fi
else
  echo "⚠️ Docker غير موجود؛ تم تخطي فحص compose"
fi

# منع أكثر أنماط التسريب وضوحًا داخل الملفات المتتبعة في هذا المجلد.
if grep -R -nE 'sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}' . \
  --exclude='.env' --exclude='preflight.sh' 2>/dev/null; then
  fail "نمط مفتاح API محتمل داخل الملفات"
fi

echo "✅ Preflight completed"
