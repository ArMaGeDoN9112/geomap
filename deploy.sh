#!/usr/bin/env bash
set -euo pipefail

domain=${1:-}
hostname_pattern='^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$'
octet='(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])'
ipv4_pattern="^($octet\.){3}$octet\$"
if [[ $# != 1 || ${#domain} -gt 253 || ( ! $domain =~ $hostname_pattern && ! $domain =~ $ipv4_pattern ) ]]; then
    echo 'Usage: bash deploy.sh <public hostname or IPv4 address>' >&2
    exit 2
fi

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
for tool in docker curl openssl; do
    if ! command -v "$tool" >/dev/null; then
        echo "Install $tool on the VPS before running this script." >&2
        exit 1
    fi
done
docker compose version >/dev/null
docker info --format '{{.ServerVersion}}' >/dev/null

project=geomap-production
env_file=.env.production
if [[ ! -f $env_file ]]; then
    existing_volume=$(docker volume ls --quiet --filter "name=^${project}_pgdata$")
    if [[ -n $existing_volume ]]; then
        echo "Restore $env_file with the existing PostgreSQL password before deploying." >&2
        exit 1
    fi
    password=$(openssl rand -hex 32)
    (umask 077; set -o noclobber; printf 'POSTGRES_PASSWORD=%s\n' "$password" > "$env_file")
fi

unset POSTGRES_PASSWORD
export GEOMAP_DOMAIN="$domain"
export GEOMAP_CADDY_SNIPPET=proxy
if [[ $domain =~ $ipv4_pattern ]]; then
    export GEOMAP_CADDY_SNIPPET=proxy_with_ip_certificate
fi
compose=(docker compose --project-name "$project" --env-file "$env_file" -f compose.yaml -f compose.production.yaml)
"${compose[@]}" config --quiet
if ! "${compose[@]}" up --build --detach --wait --wait-timeout 180; then
    "${compose[@]}" ps --all
    "${compose[@]}" logs --tail=30
    exit 1
fi

url="https://$domain"
if ! health=$(curl --fail --silent --show-error --retry 10 --retry-all-errors --retry-delay 5 --max-time 10 "$url/api/health") || [[ $health != '{"status":"ok"}' ]]; then
    echo "HTTPS check failed for $url/api/health. Check DNS and inbound TCP ports 80 and 443." >&2
    "${compose[@]}" logs --tail=30 caddy
    exit 1
fi

printf 'GeoMap is ready:\n  %s/russia\n  %s/world\n' "$url" "$url"
