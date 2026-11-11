# syntax=docker/dockerfile:1

# Three stages, each with only what its job needs: the site is compiled with
# Node, the server is cross-compiled with Go, and the image that ships carries
# the two artefacts and nothing else — no toolchain, no sources, no shell.

# ── the site ────────────────────────────────────────────────────────────────
# Runs on the build host's own architecture and never ships: `npm ci` from the
# lockfile keeps the build reproducible, and `npm run build` typechecks before
# Vite writes frontend/dist.
FROM --platform=$BUILDPLATFORM node:24-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ── the server ──────────────────────────────────────────────────────────────
# Standard library only, so there is no module download step and no C
# toolchain: CGO off and a cross-compile straight to the target platform is the
# whole build.
FROM --platform=$BUILDPLATFORM golang:1.24-alpine AS backend
ARG TARGETOS TARGETARCH
WORKDIR /app/backend
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -trimpath -ldflags="-s -w" -o /out/blinkflow ./cmd/blinkflow

# ── what ships ──────────────────────────────────────────────────────────────
# distroless static: the binary is self-contained (no libc, no certificates to
# fetch), so all it needs is a filesystem, a clock and an unprivileged user.
FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app
COPY --from=backend /out/blinkflow /app/blinkflow
COPY --from=frontend /app/frontend/dist /app/dist
COPY LICENSE /app/LICENSE
COPY skills /app/skills

# The defaults the image needs to differ from the developer ones: a container
# has to listen on its interface rather than loopback, and the site lives where
# this image put it. Every flag still overrides these; see the README.
ENV BLINKFLOW_ADDR=0.0.0.0 \
    BLINKFLOW_PORT=8080 \
    BLINKFLOW_STATIC=/app/dist \
    BLINKFLOW_SKILLS=/app/skills

EXPOSE 8080
USER nonroot:nonroot

# /healthz answers before anything else is read, which is what an orchestrator
# should poll: the image has no shell and no curl, on purpose.
ENTRYPOINT ["/app/blinkflow"]
