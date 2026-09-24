# A per-computer egress gateway, outside the sudo-capable computer namespace.
# No application/host data, published ports, or Docker socket are mounted here.
FROM alpine:3.24
RUN apk add --no-cache iptables iproute2
COPY runtime/start-egress.sh /opt/swarm/start-egress.sh
RUN chmod 0755 /opt/swarm/start-egress.sh
CMD ["/opt/swarm/start-egress.sh"]
