#!/usr/bin/env bash
# Cambia el dominio de Axiomante y su certificado en un solo paso.
#
# Uso (en la VM, dentro de deploy/):
#   ./cambiar_dominio.sh axiomante.udp.cl --cert /ruta/fullchain.pem /ruta/privkey.pem   # certificado entregado por TI
#   ./cambiar_dominio.sh axiomante.udp.cl --letsencrypt correo@udp.cl                      # certificado gratis (valida por el 443)
#   ./cambiar_dominio.sh axiomante.udp.cl --autofirmado                                    # temporal, con advertencia en el navegador
#   ./cambiar_dominio.sh --renovar                                                          # renueva el de Let's Encrypt (para cron)
#
# Respalda el .env y los certificados anteriores en nginx/certs/respaldo-FECHA/.
set -euo pipefail
cd "$(dirname "$0")"

CERTS=nginx/certs
LE=nginx/letsencrypt
FECHA=$(date +%Y%m%d-%H%M%S)

ok()   { printf '\033[32m✔ %s\033[0m\n' "$*"; }
info() { printf '\033[36m→ %s\033[0m\n' "$*"; }
die()  { printf '\033[31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

[ -f .env ] || die "No existe deploy/.env"
command -v docker >/dev/null || die "Docker no está instalado"

# ── Renovación (Let's Encrypt) ───────────────────────────────────────────────
if [ "${1:-}" = "--renovar" ]; then
  DOM=$(grep -E '^DOMINIO=' .env | cut -d= -f2)
  [ -f "$LE/certificates/$DOM.crt" ] || die "No hay certificado de Let's Encrypt para $DOM"
  EMAIL=$(cat "$LE/correo" 2>/dev/null || true)
  info "Renovando certificado de $DOM (se detiene nginx unos segundos)"
  docker compose stop nginx
  docker run --rm -p 443:443 -v "$PWD/$LE:/data" goacme/lego \
    --email "$EMAIL" --domains "$DOM" --tls --path /data --accept-tos renew --days 30 || true
  cp "$LE/certificates/$DOM.crt" "$CERTS/fullchain.pem"
  cp "$LE/certificates/$DOM.key" "$CERTS/privkey.pem"
  docker compose up -d nginx
  ok "Certificado renovado (vence: $(openssl x509 -in $CERTS/fullchain.pem -noout -enddate | cut -d= -f2))"
  exit 0
fi

DOM="${1:-}"; MODO="${2:-}"
[[ "$DOM" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] \
  || die "Dominio inválido: '$DOM' (ejemplo: axiomante.udp.cl, sin https:// ni /)"

# ── Respaldo ─────────────────────────────────────────────────────────────────
mkdir -p "$CERTS/respaldo-$FECHA"
cp .env "$CERTS/respaldo-$FECHA/.env"
cp "$CERTS"/*.pem "$CERTS/respaldo-$FECHA/" 2>/dev/null || true
ok "Respaldo en $CERTS/respaldo-$FECHA/"

# ── Certificado ──────────────────────────────────────────────────────────────
case "$MODO" in
  --cert)
    FULL="${3:-}"; KEY="${4:-}"
    [ -f "$FULL" ] && [ -f "$KEY" ] || die "Indica los dos archivos: --cert fullchain.pem privkey.pem"
    # El certificado y la clave deben corresponder entre sí
    A=$(openssl x509 -in "$FULL" -noout -pubkey | openssl sha256)
    B=$(openssl pkey -in "$KEY" -pubout | openssl sha256)
    [ "$A" = "$B" ] || die "La clave privada no corresponde al certificado"
    openssl x509 -in "$FULL" -noout -checkhost "$DOM" | grep -q "does match" \
      || die "El certificado no es válido para $DOM"
    cp "$FULL" "$CERTS/fullchain.pem"; cp "$KEY" "$CERTS/privkey.pem"
    ok "Certificado de TI instalado"
    ;;
  --letsencrypt)
    EMAIL="${3:-}"; [ -n "$EMAIL" ] || die "Indica un correo: --letsencrypt correo@udp.cl"
    info "Pidiendo certificado a Let's Encrypt por el puerto 443 (el dominio debe ser accesible desde internet)"
    mkdir -p "$LE"; echo "$EMAIL" > "$LE/correo"
    docker compose stop nginx
    if ! docker run --rm -p 443:443 -v "$PWD/$LE:/data" goacme/lego \
         --email "$EMAIL" --domains "$DOM" --tls --path /data --accept-tos run; then
      docker compose up -d nginx
      die "Let's Encrypt no pudo validar $DOM. Revisa que el dominio apunte a la VM y que el 443 esté abierto desde internet"
    fi
    cp "$LE/certificates/$DOM.crt" "$CERTS/fullchain.pem"
    cp "$LE/certificates/$DOM.key" "$CERTS/privkey.pem"
    ok "Certificado de Let's Encrypt emitido (dura 90 días)"
    ;;
  --autofirmado)
    openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
      -keyout "$CERTS/privkey.pem" -out "$CERTS/fullchain.pem" \
      -subj "/CN=$DOM" -addext "subjectAltName=DNS:$DOM" 2>/dev/null
    ok "Certificado autofirmado generado (30 días)"
    ;;
  *) die "Falta el modo: --cert, --letsencrypt o --autofirmado" ;;
esac
chmod 600 "$CERTS/privkey.pem"

# ── Dominio y reinicio ───────────────────────────────────────────────────────
ANTES=$(grep -E '^DOMINIO=' .env | cut -d= -f2)
sed -i "s/^DOMINIO=.*/DOMINIO=$DOM/" .env
ok "DOMINIO: $ANTES → $DOM"
docker compose up -d --force-recreate backend nginx
sleep 5

# ── Verificación ─────────────────────────────────────────────────────────────
COD=$(curl -sk --resolve "$DOM:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$DOM/api/auth/profile" || true)
[ "$COD" = "401" ] && ok "La API responde en https://$DOM (401 = sin sesión, correcto)" \
                   || info "La API respondió '$COD' (se esperaba 401). Revisa: docker compose logs backend nginx --tail 30"
info "Certificado: $(openssl x509 -in $CERTS/fullchain.pem -noout -subject -enddate | tr '\n' ' ')"

cat <<FIN

Falta hacer a mano en Google Cloud Console → cliente OAuth:
  • Orígenes autorizados de JavaScript:  https://$DOM
  • URIs de redireccionamiento:          https://$DOM/api/auth/google/callback
  (puedes borrar las de $ANTES)

En cada PC donde agregaste una línea al archivo hosts para $ANTES, bórrala.
FIN
if [ "$MODO" = "--letsencrypt" ]; then
  cat <<FIN
Para renovar solo cada mes, agrega esta línea con 'crontab -e':
  0 4 1 * * cd $PWD && ./cambiar_dominio.sh --renovar >> $PWD/nginx/renovacion.log 2>&1
FIN
fi
