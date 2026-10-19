# RefineIR

An interactive CEGAR model checker built with SVF and Z3. Explore the program, predicates, abstract models, and SMT queries behind each refinement.

**[Live preview → refineir.qiuyif.org](https://refineir.qiuyif.org/)** — explore the examples in your browser, with no installation.

## Install and run with Docker

Install [Docker Engine](https://docs.docker.com/engine/install/) or [Podman](https://podman.io/docs/installation), then:

```bash
git clone https://github.com/ExcitedSpider/RefineIR.git
cd RefineIR
docker build -t refineir .
docker run --rm --name refineir-demo -p 8000:8000 refineir
```

Open **http://localhost:8000**. The container listens on both IPv4 and IPv6, so `http://127.0.0.1:8000` and `http://[::1]:8000` also work. From another device on your LAN, open `http://<your-machine-ip>:8000`.

The Dockerfile installs Node.js 22, CMake, Ninja, a C++ compiler, Python, and the UI test dependency. It builds a pinned SVF revision with LLVM 21.1.0 and Z3 4.15.4, compiles RefineIR, runs all examples plus the SMT, model, and DOM checks, and generates the presentation. You do not need to install these tools on the host.

The first build downloads and compiles the toolchain, so allow several minutes and several GB of disk space. Dependency layers are cached for subsequent builds. Compilation defaults to two jobs; use `--build-arg BUILD_JOBS=1` if the SVF build exhausts memory.

**Podman:** use `podman build -t localhost/refineir .` and `podman run --rm --name refineir-demo -p 8000:8000 localhost/refineir` instead. The image serves on port 8000 and retains the build tools for experiments.

To rerun the checker and its core verification inside the image:

```bash
docker run --rm --name refineir-check refineir sh -c \
  'node scripts/run.mjs && node scripts/package.mjs && node scripts/refinement-check.mjs && node scripts/model-check.mjs && node scripts/tla-check.mjs'
```

Changes produced by this disposable container stay inside it. To keep generated files, use a named container without `--rm`, then copy its `/app/site/dist` directory with `docker cp`.

## View the demo without building

Open **[refinement-lab.html](refinement-lab.html)** directly in a browser. It includes the recorded examples and needs no server or dependencies.

Alternatively, with Python installed:

```bash
python3 -m http.server 8000 --bind 0.0.0.0 --directory site/dist
```

This host-server command listens on IPv4: open `http://127.0.0.1:8000`. Use `--bind ::` for IPv4/IPv6 on a dual-stack host. The presentation replays recorded checker runs; it does not compile programs in the browser. Rebuild when you want fresh analyses.

## Build locally

For public hosting without a container, see [Cloudflare Pages deployment](#deploy-to-cloudflare-pages).

The runner currently targets Linux and expects the toolchain layout below. The dependency versions used by this project are **SVF 3.4, LLVM 21.1.0, and Z3 4.15.4**.

Install Node.js 22 or 24 from [nodejs.org](https://nodejs.org/en/download). The scripts require at least Node.js 20.11. On Ubuntu 24.04, install the remaining build tools:

```bash
sudo apt-get update
sudo apt-get install -y build-essential cmake ninja-build git curl \
  ca-certificates unzip xz-utils zlib1g-dev libzstd-dev libxml2-dev \
  libncurses-dev python3
node --version
cmake --version  # Must be 3.23 or newer.
```

On Fedora, the corresponding packages are:

```bash
sudo dnf install gcc-c++ cmake ninja-build git curl ca-certificates \
  unzip xz zlib-ng-compat-devel libzstd-devel libxml2-devel ncurses-devel python3
```

Package installation requires administrator access. If you cannot use `sudo`, use the container path or an existing toolchain. The Fedora native build has not yet been verified; the container build is verified independently of host development packages.

From the RefineIR repository root, build SVF in a sibling directory:

```bash
export REFINEIR_ROOT="$PWD"
git clone https://github.com/SVF-tools/SVF.git ../SVF
git -C ../SVF checkout ea287cf0040bb82f46b33572b121df39ac104094
cd ../SVF
env -u LLVM_DIR -u Z3_DIR SVF_BUILD_JOBS=2 bash ./build.sh
cd "$REFINEIR_ROOT"
```

SVF's [build script](https://github.com/SVF-tools/SVF/blob/ea287cf0040bb82f46b33572b121df39ac104094/build.sh) downloads the matching LLVM and Z3 dependencies. Use a fresh sibling directory, or reuse an existing compatible SVF build by setting the paths below.

In the same shell:

```bash
export SVF_ROOT="$(cd ../SVF && pwd)"
export LLVM_ROOT="$SVF_ROOT/llvm-21.1.0.obj"
export Z3_ROOT="$SVF_ROOT/z3.obj"
export LD_LIBRARY_PATH="$SVF_ROOT/Release-build/lib:$LLVM_ROOT/lib:$Z3_ROOT/bin${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

node scripts/run.mjs
node scripts/package.mjs
python3 -m http.server 8000 --bind 0.0.0.0 --directory site/dist
```

The scripts default to `../SVF` relative to the repository, with LLVM and Z3 inside that directory. Set these environment variables in new shells when using a different layout. The expected Z3 layout includes `include/z3++.h` and `bin/libz3.so`. Missing dependencies produce an error identifying the path and environment variable to set.

`run.mjs` builds `build/svf-cegar` and `build/smt-replay`, compiles the examples, records their analyses, and executes the real-bug witness. `package.mjs` generates the offline pages and TLA+ exports.

| Example | Expected result | Rounds | Refinements |
| --- | --- | --- | --- |
| `contradiction` | SAFE | 2 | 1 |
| `real-bug` | UNSAFE | 1 | 0 |
| `arithmetic` | SAFE | 2 | 1 |
| `two-refinements` | SAFE | 3 | 2 |
| `unsupported-loop` | UNKNOWN | 0 | 0 |

A round checks one model, including the initial M0. A refinement changes the precision before the next round. The loop example is rejected before any round starts. The runner prints both counts.

### Generated files and Git changes

Generated demo files are committed so a fresh clone works without the toolchain. `run.mjs` rewrites `site/dist/data/` (including timestamps and toolchain provenance). `package.mjs` rewrites `site/dist/index.html`, `site/dist/cfg.html`, the three `refinement-lab*.html` pages, and `site/dist/models/`. Rebuilding can therefore leave Git changes; inspect them with `git status` and `git diff` before committing. Edit the scripts, CSS/JavaScript, and `site/dist/state-columns.html` template rather than generated HTML.

The verification scripts write temporary artifacts under ignored `build/` or check existing data; they do not themselves repackage the tracked demo. Container runs without a host bind mount leave the host checkout unchanged.

## Use the presentation

- Choose an example on the left and an iteration (**M0 / M1 / M2**) above the workspace.
- Use **← / →** to step through model checking, path validation, and refinement.
- Click a program block or CFG node to highlight its counterpart. Fact chips filter the CFG by predicate valuation.
- Switch to **TLA+ model** to see the abstract transition relation and changes between iterations.
- At the UNSAT/refinement step, click **Z3 input → output** in the right panel for the query and returned core. In example 01, press **→ twice** from the start.

The LAN page reloads automatically when its local HTML, CSS, JavaScript, or data changes. Polling is enabled on localhost, private IPv4 addresses, and `.local` hostnames. For another development hostname, append `?live-reload=1`. Public deployments do not poll by default.

## Deploy to Cloudflare Pages

In [Cloudflare's dashboard](https://dash.cloudflare.com/), open **Workers & Pages → Create application → Pages → Import an existing Git repository**. Connect GitHub and select `ExcitedSpider/RefineIR`.

| Setting | Value |
| --- | --- |
| Project name | `refineir` (or another available name) |
| Production branch | `main` |
| Framework preset | None |
| Build command | `exit 0` |
| Build output directory | `site/dist` |
| Root directory | Repository root (leave blank) |

Select **Save and Deploy**. The committed presentation already includes the recorded analyses; Cloudflare does not need to build SVF or run Docker. Pushes to `main` redeploy it automatically.

After the `*.pages.dev` URL works, open the project's **Custom domains → Set up a custom domain**, enter **`svfcegar.qiuyif.org`**, and confirm Cloudflare's proposed DNS record. Add the domain through Pages before creating a CNAME manually. Wait for domain activation and HTTPS provisioning, then visit `https://svfcegar.qiuyif.org`.

This deployment uses static Pages hosting with no Functions, Workers, database, or container charges. See Cloudflare's [static HTML guide](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/) and [custom domain guide](https://developers.cloudflare.com/pages/configuration/custom-domains/).

## Analyze your own program

With the local build environment set, compile a supported C program and run the checker:

```bash
"$LLVM_ROOT/bin/clang" -O0 -g -fwrapv -fno-discard-value-names \
  -Xclang -disable-O0-optnone -emit-llvm -c examples/contradiction.c \
  -o build/custom.raw.bc
"$LLVM_ROOT/bin/opt" -passes=mem2reg build/custom.raw.bc -o build/custom.bc
build/svf-cegar build/custom.bc examples/contradiction.c build/custom.json
```

Replace both occurrences of `examples/contradiction.c` with your source. The output is JSON. To use the container toolchain interactively, run `docker run --rm -it --name refineir-shell refineir bash`; the repository and binaries are under `/app`.

Adding a new example to the presentation also requires registering it in `scripts/run.mjs` and updating the UI's example labels. The compilation flags preserve branches and select wrapping signed arithmetic; use the matching LLVM toolchain throughout.

## Run checks

After building and running the examples:

```bash
node scripts/refinement-check.mjs
node scripts/model-check.mjs
node scripts/tla-check.mjs
```

These replay SMT obligations and returned cores in fresh Z3 processes, verify reachable abstract models, and compare exported TLA+ transitions with the recorded models. A regression checks that an unrelated first branch is excluded from refinement.

The optional local UI tests need jsdom (already installed in the Docker image):

```bash
npm install --prefix build/ui-tests --no-save jsdom@26.1.0
export JSDOM_PATH="$PWD/build/ui-tests/node_modules/jsdom"
node scripts/cfg-check.mjs
node scripts/dom-check.mjs
```

Rendered screenshots at 1920×1080 use a separate browser image:

```bash
mkdir -p build/screenshots/review
podman run --rm --name refineir-browser-review --security-opt label=disable \
  -v "$PWD:/work:ro" -v "$PWD/build/screenshots/review:/captures:rw" \
  -e CEGAR_SCREENSHOTS=/captures \
  mcr.microsoft.com/playwright/python:v1.57.0-jammy \
  python3 /work/scripts/browser-review.py
```

TLC is optional. With Java and a [TLA+ tools JAR](https://github.com/tlaplus/tlaplus/releases):

```bash
cd site/dist/models
java -jar /path/to/tla2tools.jar -config contradiction_M1.cfg contradiction_M1.tla
```

TLC/SANY have not been run on the bundled exports. `tla-check.mjs` checks their transition semantics, not the full TLA+ language.

## How it works and current limits

The checker builds real SVFIR and extracts the ICFG for `main`. Supported expressions become Z3 bit-vectors over immutable nondeterministic inputs. Abstract states pair program locations with Boolean predicate values.

When the abstract model reaches `ERROR`, Z3 checks the complete path. SAT produces a witness. UNSAT produces a contradictory core: the refiner minimizes it, merges SMT-proven equivalent or complementary conditions, adds the remaining predicates, and verifies that the rejected path is eliminated. This is **UNSAT-core-guided refinement**, not interpolation. A subset-minimal core need not be unique or smallest.

The prototype supports acyclic integer programs with zero-argument `main`, `nondet_int()`, `nondet_uint()`, and `ERROR()`. Loops, executable phi nodes, memory operations, general function calls, select, division, shifts, and floating point are unsupported. Unsupported features, solver unknowns, and exceeding the eight-predicate budget produce **UNKNOWN**.

The displayed SVF program and CFG use the same normalized blocks. TLA+ modules export the recorded reachable abstract transitions at those block boundaries; the SVF/Z3 checker performs refinement.

## Project layout

| Path | Contents |
| --- | --- |
| `Dockerfile` | Toolchain installation, checker build, verification, and demo server |
| `src/` | C++ checker and SMT replay tool |
| `examples/` | C examples and regression |
| `scripts/` | Build runner, packaging, exports, and checks |
| `site/dist/` | Editable static presentation |
| `site/dist/data/` | Recorded analyses and SMT evidence |
| `site/dist/models/` | Generated TLA+ modules and TLC configurations |
| `refinement-lab.html` | Standalone offline demo |
| `build/` | Local binaries, bitcode, and screenshots; ignored by Git |

The earlier state-column view is retained in `site/dist/state-columns.html` and `refinement-lab-state-columns.html` for comparison.
