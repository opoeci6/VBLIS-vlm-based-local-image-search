# The VBLIS server as a Docker image. See SERVER.md ("Docker") and deploy/compose.yml.
#
# Build from the repository root:
#   docker build -f deploy/Dockerfile -t vblis:local .
# or, in this folder: docker compose build
#
# The image holds the program only. Models, the index and the settings live in /data, which you
# mount. No model is downloaded while building: download one in the browser (Settings).
#
# Build argument:
#   TORCH=cpu    PyTorch without a GPU (the default; the only choice on ARM64)
#   TORCH=cuda   PyTorch with NVIDIA CUDA 13.0. x86-64 only. UNTESTED. It also needs the NVIDIA
#                container toolkit, a GPU passed to the container (GTX 16 / RTX 20 or newer) and
#                NVIDIA driver 580 or newer on the host.

# Stage 1: build the web interface
FROM node:22-slim AS web
# The Electron binary is not needed for the web build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
WORKDIR /src/app
# The package files first, so the install layer is reused until they change
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/ ./
# Writes dist (the web interface) and dist-electron (not used here)
RUN npm run build

# Stage 2: the server
FROM python:3.13-slim
ARG TORCH=cpu

LABEL org.opencontainers.image.title="VBLIS server" \
      org.opencontainers.image.description="Local photo and video search, served to web browsers" \
      org.opencontainers.image.source="https://github.com/opoeci6/VBLIS-vlm-based-local-image-search" \
      org.opencontainers.image.licenses="see LICENSE in the repository"

# No apt packages: the wheels of torch, opencv-python-headless, av, pillow-heif and chromadb bring
# their own libraries. If an import fails with a missing shared library, add it here, for example:
#   RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*

ENV PATH=/opt/venv/bin:$PATH \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    VBLIS_DATA_DIR=/data \
    VBLIS_WEB_DIR=/opt/vblis/web \
    HOME=/tmp

# The packages first (the slow part): only the files that decide them are copied, so this layer is
# reused until requirements.txt, constraints.txt or the install script change
RUN python -m venv /opt/venv
COPY api/requirements.txt api/constraints.txt /opt/vblis/api/
COPY scripts/linux-deps.sh /opt/vblis/scripts/linux-deps.sh
RUN bash /opt/vblis/scripts/linux-deps.sh --python /opt/venv/bin/python --torch "$TORCH" --api /opt/vblis/api

# Then the program and the web interface
COPY api/ /opt/vblis/api/
COPY --from=web /src/app/dist /opt/vblis/web

# A normal user owns /data. Compose can run the container as another user (VBLIS_UID, VBLIS_GID).
# There is no VOLUME line on purpose: it would create an anonymous volume on every run.
RUN groupadd --gid 1000 vblis \
    && useradd --uid 1000 --gid 1000 --no-create-home --shell /usr/sbin/nologin vblis \
    && mkdir /data \
    && chown 1000:1000 /data
USER vblis

WORKDIR /opt/vblis/api
EXPOSE 8080
# "docker compose run --rm vblis add-account NAME --role owner" runs a command; the default is the server
ENTRYPOINT ["python", "main.py"]
CMD ["serve"]
