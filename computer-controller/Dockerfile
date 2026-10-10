FROM oven/bun:1.3.14
WORKDIR /app
COPY computer-controller/src computer-controller/src
COPY templates/default/security/chromium-seccomp.json templates/default/security/chromium-seccomp.json
# Docker-socket access is root-equivalent. This narrow service has no .local
# mount, provider credentials, browser entrypoint, or product-agent tools.
USER root
EXPOSE 3101
CMD ["bun", "computer-controller/src/server.ts"]
