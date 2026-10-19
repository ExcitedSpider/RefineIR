FROM docker.io/library/node:22-bookworm-slim

ARG SVF_REVISION=ea287cf0040bb82f46b33572b121df39ac104094
ARG BUILD_JOBS=2

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake ninja-build git curl ca-certificates unzip xz-utils \
    zlib1g-dev libzstd-dev libxml2-dev libncurses-dev python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/SVF
RUN git init && git remote add origin https://github.com/SVF-tools/SVF.git \
    && git fetch --depth=1 origin "${SVF_REVISION}" && git checkout --detach FETCH_HEAD \
    && SVF_BUILD_JOBS="${BUILD_JOBS}" bash ./build.sh

ENV SVF_ROOT=/opt/SVF \
    LLVM_ROOT=/opt/SVF/llvm-21.1.0.obj \
    Z3_ROOT=/opt/SVF/z3.obj \
    LD_LIBRARY_PATH=/opt/SVF/Release-build/lib:/opt/SVF/llvm-21.1.0.obj/lib:/opt/SVF/z3.obj/bin \
    CMAKE_BUILD_PARALLEL_LEVEL=2 \
    JSDOM_PATH=/opt/refineir-ui/node_modules/jsdom

RUN npm install --prefix /opt/refineir-ui --no-save jsdom@26.1.0

WORKDIR /app
COPY . .
RUN node scripts/run.mjs && node scripts/package.mjs \
    && node scripts/refinement-check.mjs && node scripts/model-check.mjs \
    && node scripts/tla-check.mjs && node scripts/cfg-check.mjs \
    && node scripts/dom-check.mjs

EXPOSE 8000
CMD ["python3", "-m", "http.server", "8000", "--bind", "::", "--directory", "site/dist"]
