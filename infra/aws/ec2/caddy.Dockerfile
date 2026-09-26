# Caddy with the Route53 DNS provider, needed for the wildcard certificate (DNS-01 challenge).
FROM caddy:2.10-builder AS build
RUN xcaddy build --with github.com/caddy-dns/route53@v1.6.0

FROM caddy:2.10
COPY --from=build /usr/bin/caddy /usr/bin/caddy
