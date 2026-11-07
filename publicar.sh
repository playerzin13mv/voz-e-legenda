#!/data/data/com.termux/files/usr/bin/bash
# Publica o projeto no seu GitHub. O GitHub gera o APK sozinho.
# Uso:  bash publicar.sh [nome-do-repositorio]
set -e

NOME="${1:-voz-e-legenda}"

command -v git >/dev/null || pkg install -y git
command -v gh  >/dev/null || pkg install -y gh

if ! gh auth status >/dev/null 2>&1; then
  echo "O gh não está logado. Rode:  gh auth login"
  exit 1
fi

git config user.name  >/dev/null || git config user.name  "$(gh api user -q .login)"
git config user.email >/dev/null || git config user.email "$(gh api user -q .login)@users.noreply.github.com"

[ -d .git ] || git init -b main
git checkout -B main
git add -A
git commit -m "App Voz e Legenda" || true

# troque --public por --private se quiser o código privado
gh repo create "$NOME" --public --source=. --remote=origin --push

echo
echo "Pronto! Agora o GitHub está compilando o APK (uns 5 a 10 minutos)."
echo "Acompanhe:  gh run watch"
echo "Quando terminar, baixe o APK em:  Releases > 'APK mais recente'"
gh repo view --web 2>/dev/null || true
