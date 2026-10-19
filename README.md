# RefineIR

An interactive exploration of counterexample-guided abstraction refinement using SVF IR and Z3. Follow the program, predicates, CFG and TLA+ model through each iteration, and inspect the solver queries and UNSAT cores that drive refinement.

Open **[refinement-lab.html](refinement-lab.html)** in a browser. It is a complete offline presentation: no server, installation, or network connection is needed. The editable site is in `site/dist/`.

The **CFG with SVF operations (formerly Version B)** is the chosen default at `site/dist/index.html` and in `refinement-lab.html`. Existing `cfg.html` and `refinement-lab-cfg.html` bookmarks still work. The old state-column view is archived at `site/dist/state-columns.html` (offline: `refinement-lab-state-columns.html`). The archive link preserves the selected example and walkthrough step. Both use the same analysis evidence.

The primary program source is now a readable **SVF program**, generated from exactly the same blocks and operations as the CFG. Semantic labels (such as `test x > 0`) identify blocks on both sides; selecting either side highlights the other. The listing includes branch destinations and compact typed operations (`cmp.s32`, `cmp.u32`, `add.i32`). C and LLVM are reference tabs. This is a normalized presentation of recorded SVF statements and control events, not verbatim LLVM or a newly compiled IR: debug metadata, pass-through control steps and single-input return merges are omitted or folded. Original evidence is preserved in the downloadable results.

The **TLA+ model** tab shows a generated module for each iteration, including `VARIABLES`, `Init`, `Next`, `TypeOK`, `NoError`, and `Spec`. Added or changed lines are highlighted against the previous iteration. Download links work on the LAN and offline. All eight `.tla` modules and `.cfg` files are also written to `site/dist/models/` by `node scripts/package.mjs` or `node scripts/export-tla.mjs`.

These modules export the recorded reachable abstract transition relation at the displayed block boundaries. They are not a new translation of full SVF semantics: internal straight-line steps are collapsed, and edges not observed for a valuation are disabled. The exported model preserves the recorded block-state reachability and ERROR verdict. Predicate variables remain unchanged because this prototype tracks immutable inputs. Refinement is performed by the existing SVF/Z3 checker; TLC does not generate refinements.

`node scripts/tla-check.mjs` independently explores the guards parsed from exported `Next`, checks the reachable states and safety verdict against the recorded projection, and checks refinement projection. **TLC/SANY have not been run**: no local TLA+ tools were found, and no dependency was installed. With an existing `tla2tools.jar`, run from `site/dist/models/`:

```sh
java -jar /path/to/tla2tools.jar -config contradiction_M1.cfg contradiction_M1.tla
```

M0 false alarms should violate `NoError`; final SAFE models should satisfy it; the real-bug model should violate it. Deadlock checking is disabled because terminal states are allowed. See the [official command-line tools](https://github.com/tlaplus/tlaplus/blob/master/README.md) and [TLC configuration reference](https://github.com/tlaplus/vscode-tlaplus/blob/master/resources/knowledgebase/tlc-config-files.md).

Version B groups straight-line steps into blocks and formats recorded SVF statement classes with readable operands. LLVM annotations supply operand names, constants, integer widths and operation names; source declarations supply variable names where available. Entry, calls and return are explicitly control-flow events, not invented SVF statement classes. Each chip represents a recorded reachable valuation at the block's end. Choosing facts filters arrows to that single valuation; an edge union is not presented as an abstract path. Block positions stay fixed across refinements. `node scripts/package.mjs` regenerates both offline pages and the alternate LAN page; `node scripts/cfg-check.mjs` validates its data mapping and interactions.

When served over HTTP on the LAN, the site automatically reloads after its HTML, CSS, JavaScript or recorded results change. It polls every two seconds and waits for two matching reads of a changed version. The selected example, walkthrough step, source tab and page scroll position survive the reload. This works with the existing `python3 -m http.server` command; no server restart or dependency installation is required. Refresh once after adding this feature to load the watcher. The standalone offline HTML does not poll.

The presentation replays actual executions of a small C++ checker using SVF 3.4, LLVM 21, and Z3 4.15.4. It does not compile edited C in the browser.

The main **iteration workspace** places program source on the left, the abstract model in the center, and predicates/reasoning on the right. Choose M0/M1/M2 above the three panels; all follow the same round. Selecting a model state highlights its source line and shows the predicate truth values. The desktop layout targets a single 1920×1080 viewport. Longer background material and the original control-flow graph are below the workspace.

The archived state-column explorer shows a complete reachable abstract model for every iteration. Rows keep program locations fixed; columns separate predicate valuations. “Before / after” aligns successive models; “All program steps” reveals every recorded state with internal scrolling. Its compact view collapses straight-line locations, including nondeterministic input calls. Gray placeholders are explicitly unreachable and are not part of the reachable model. Abstract ERROR states can be spurious until validated by the path solver.

| Experiment | Actual result | Refinements |
| --- | --- | --- |
| Contradictory branches | SAFE | 1 |
| Feasible error path | UNSAFE; `x = 1` | 0 |
| Unsigned arithmetic | SAFE | 1 |
| Two independent contradictions | SAFE | 2 |
| Loop / phi instruction | UNKNOWN | — |

The UNSAFE witness was replayed against a native executable of the C program. It printed `ERROR reached` and exited with status 42.

## What is implemented

`src/checker.cpp` builds SVFIR, extracts the `main` ICFG, and translates SVF comparisons, arithmetic, and supported integer copies/casts into bit-vector expressions. LLVM supplies constants, widths, and debug locations. The graph and exported SVF statements are real, not hand-authored illustrations.

For this first acyclic SSA subset, each expression is expanded into immutable nondeterministic inputs. An abstract state is `(ICFG node, Boolean predicate valuation)`. For each edge the engine checks whether its guard is consistent with the current valuation. With no predicates, checking guards independently admits spurious paths. A complete path check conjoins every guard. On UNSAT, refinement minimizes Z3's core by deletion checks, then adds every core predicate modulo SMT-proven equivalence or complementation. It may add several predicates in one iteration. Every refined valuation is checked to prove it is infeasible or blocks a core branch, eliminating the rejected path. Predicate enumeration is capped at eight predicates; lack of progress, unsupported features, and solver unknowns produce UNKNOWN.

This is a small form of global predicate abstraction over immutable inputs. It is not a general mutable-state predicate-transfer engine, a loop verifier, or a memory verifier. Refinement is UNSAT-core-guided, not interpolation: predicates are extracted from the contradictory core. The core is subset-minimal, not necessarily smallest or unique. The synthetic SVF function-exit return phi is irrelevant to ERROR reachability; executable LLVM phi instructions are rejected.

`node scripts/refinement-check.mjs` replays each recorded SMT obligation in a fresh Z3 process using `build/smt-replay`. It checks core inconsistency, satisfiability after removing each core member, equivalence/complement reductions, and coverage of all refined valuations. A regression with an unrelated first branch verifies that this branch is excluded from refinement. The UI exposes the core and downloadable evidence under “Why these predicates?”.

## Reproduce

Reuse an existing SVF/LLVM/Z3 environment. No dependency installation is performed by these commands. Podman is preferred when available; this session's Podman runtime was read-only, so the successful run used the existing host build without modifying it.

```sh
SVF_ROOT=/home/qfeng/Workspace/SVF \
LLVM_ROOT=/home/qfeng/Workspace/SVF/llvm-21.1.0.obj \
Z3_ROOT=/home/qfeng/Workspace/SVF/z3.obj \
node scripts/run.mjs
node scripts/package.mjs
```

The runner builds the checker, compiles the examples at `-O0 -g -fwrapv`, applies only `mem2reg`, analyzes each example, checks its expected verdict and round count, and executes the bug witness. This deliberately preserves contradictory branches rather than optimizing them away. Arithmetic is fixed-width; signed overflow wrap semantics are selected explicitly. Branch conditions preserve signed/unsigned distinctions.

To analyze another already-prepared bitcode file:

```sh
build/svf-cegar input.bc input.c result.json
```

Supported input is zero-argument `main` with acyclic control flow, integer computations, and zero-argument declarations `nondet_int()`, `nondet_uint()`, and `ERROR()`. Memory operations, general calls, LLVM phi instructions, select, division, shifts, floating point, and poison-producing overflow flags are unsupported. No claim is made about arbitrary C semantics or all LLVM poison flags. Use the provided compilation pipeline and examples as the exploration baseline.

`site/dist/data/results.json` contains source, LLVM IR, SVF nodes, graph edges, abstract exploration states, initial valuations, permitted transitions, blocked valuations, candidate paths and their valuations, constraints, cores, learned predicates, Z3 witnesses, and toolchain provenance. Every round finishes reachable-model exploration even after finding its first candidate; ERROR states are terminal. Per-example JSON is also available. SMT-LIB exports contain the actual path constraints without implicit core-tracking assumptions, so standalone `check-sat` reproduces the query.

## Verification and presentation

`node scripts/dom-check.mjs` checks all five examples, playback, core highlighting, learned predicates, blocked branches, node inspection, source tabs, and reset. It reuses an existing jsdom installation; set `JSDOM_PATH` to another existing installation if needed.

`node scripts/model-check.mjs` checks all eight model snapshots: exact reachable closure, all transition decisions, membership of the recorded counterexample, and projection of refined states/transitions onto the previous model. The DOM checks additionally verify all state/transition counts in the full-detail model view, round selection, comparison, state inspection, and hiding rejected edges.

`scripts/browser-review.py` runs in the existing Playwright Podman image and checks the rendered **1920×1080** workspace, CFG labels, source selection, and TLA+ panels. Screenshots in `build/screenshots/unsat-core/` include the new refinement explanation and arithmetic's two learned predicates; these were visually inspected. Mobile rendering has not been verified by this check.

A private Sites project was registered and its identity retained in `site/.openai/hosting.json`, but publication could not proceed: this environment cannot resolve `git.chatgpt-team.site`. No hosted deployment is claimed. The offline HTML is the completed presentation.

## Next experiments

1. Introduce predecessor-sensitive phi handling and mutable-state transition relations.
2. Add loops with abstract-state coverage and fixed-point exploration.
3. Add stack objects and symbolic loads/stores, using SVF points-to sets to restrict candidate targets.
4. Refine pointer-target predicates and display the resulting precision change.

References: [SVF](https://github.com/SVF-tools/SVF), [SVF library example](https://github.com/SVF-tools/SVF-example), [predicate-analysis background](https://cpachecker.sosy-lab.org/doc.php), [Programming Z3](https://z3prover.github.io/papers/programmingz3.html).
