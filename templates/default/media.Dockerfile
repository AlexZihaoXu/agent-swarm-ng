# Per-computer encrypted WebSocket relay. No Docker socket, workspace volume,
# host port, privilege, device or app credentials enter this namespace.
FROM alpine:3.24
RUN apk add --no-cache socat iproute2
COPY runtime/start-media-relay.sh /opt/swarm/start-media-relay.sh
RUN chmod 0755 /opt/swarm/start-media-relay.sh
USER 65532:65532
CMD ["/opt/swarm/start-media-relay.sh"]
