# Plan: gp-visualize-llm-continuation-density — LLM token-tree treemap

## Refined feature description

A new `gpdu-*`-family CLI that builds a treemap whose cell areas equal the joint probability that an LLM assigns to token continuations of a starter prompt. Sibling areas at any subtree sum to that subtree's joint probability (top-level total = 1.0), so the picture is a literal density plot over continuations.

* **CLI shape:** `gp-visualize-llm-continuation-density --prompt "..." --model <id> --continuation-max-depth=20 --prune-probability=0.00001 [--top-k=N] [--top-p=X] [--temperature=T] [--max-nodes=N] [--color=<mode>] [--no-open] [output.html]`. Lives in `tools/gpdu-llm-density.js`, registered in `package.json#bin`. Also accepts the prompt on **stdin** when `--prompt` is `-` or omitted while stdin is a pipe (e.g. `echo "..." | gp-visualize-llm-continuation-density --model ...`).
* **Model backend:** `node-llama-cpp` (GGUF). `--model` accepts a local `.gguf` path or an HF repo id; HF repo ids are downloaded into the package's cache directory (`~/.cache/gpdu-llm-density/models/`). Added as `optionalDependency` + `devDependency`, matching how `better-sqlite3` ships in `gpdu-sqlite`.
* **Tree semantics:** one node per BPE / SentencePiece token. Labels are the **decoded** string of that token, with leading-space markers (`▁` / `Ġ`) rendered as visible spaces. Node area = joint probability of the root→node prefix.
* **Expansion rules:** at each node, compute `softmax(logits / temperature)`, take top-k, intersect with nucleus top-p, multiply each candidate's conditional by the parent joint, drop children whose joint < `--prune-probability`. Stop recursing when depth ≥ `--continuation-max-depth`, joint < `--prune-probability`, child is EOS, or global `--max-nodes` is hit.
* **Residual bucket:** every expanded node emits exactly one synthetic `(other)` leaf with conditional = `1 − Σ(expanded children conditionals)` (joint computed from the parent). It absorbs both the long tail and anything killed by top-k/top-p/prune. Never expanded. Carries `leaf-reason='other-bucket'`.
* **EOS handling:** EOS is treated like any other token — becomes a non-expandable leaf with `leaf-reason='eos'` and label `(end)`.
* **Root rendering:** root label = `(prompt)`; the prompt string itself appears in the title row and tooltip, **truncated to first 50 + ' … ' + last 50 chars** if longer than ~120 chars. Root joint = 1.0.
* **Traversal + KV-cache reuse:** depth-first descent. At each step we run a single forward pass on *one* new token, advancing a `LlamaContext` sequence's state. Before descending into a child we **save** the sequence state (`getState()` / sequence fork); after returning we **restore** it for the next sibling. This makes the natural causal completion down a branch a single token-by-token forward pass, with O(depth) saved states on a stack rather than O(nodes) re-evaluations of the prefix.
* **Progress:** stderr live `\r`-progress line in the same style as `gpdu-scan` / `gpdu-s3`. Shows `nodes <N>  depth <D>  explored <P%>` where "explored %" = `1 − (sum of pending-frontier joints)`, i.e. the fraction of probability mass that has been fully resolved (every descendant either expanded, EOS, or pruned). Final summary printed to stdout on completion.
* **Tooltip per node:** decoded token + conditional p (given parent) + joint p. (Per Q&A: no full root→here continuation string in v1.)
* **Color modes (`--color=`, default `probability`):**
  - `probability` — conditional p|parent (quantitative)
  - `depth` — depth from root (quantitative)
  - `token-rank` — sibling rank, 1 = most likely (quantitative)
  - `surprisal` — −log₂ p (quantitative)
  - `leaf-reason` — categorical: `max-depth` / `pruned` / `eos` / `other-bucket` / `(internal)`
* **Output:** self-contained HTML, bundle + dataset inlined via `partitionBlocks` + `encodeBlock` + `LOADER_JS` from `scan-core.js`. Default output path `os.tmpdir() + '/gpdu-llm-density-<modelslug>-<ts>.html'`. Opens in default browser unless `--no-open`.

### Phasing — local trial only, nothing publishes

1. Skeleton CLI + stub backend that fakes a tiny distribution from a hash, so the tree-building + HTML pipeline can be verified end-to-end without downloading a model.
2. Replace the stub with `node-llama-cpp` + KV-cache stack; verify against a tiny GGUF (e.g. SmolLM-135M, Qwen2.5-0.5B).
3. Color modes, tooltip, progress bar polish.
4. Tests + AGENTS.md + README section.

---

## Components

### `tools/gpdu-llm-density.js` (new)

Single-file Node CLI, following `gpdu-json.js`'s structure (header comment with usage; `main()` → argv parse → input load → build scan → emit HTML → optionally open).

Sections (in source order, mirroring `gpdu-json.js`):

1. **Header comment** — usage block, semantics of the tree (area = joint probability), how the `(other)` bucket reconciles each internal node.
2. **CLI parser** — long-form `--flag=value` and `--flag value`; same shape as the other `gpdu-*` tools. Required: `--model`. `--prompt` optional (defaults to stdin when piped). Optional knobs: `--continuation-max-depth=20`, `--prune-probability=1e-5`, `--top-k=Infinity`, `--top-p=1.0`, `--temperature=1.0`, `--max-nodes=200000`, `--color=probability`, `--no-open`, `--block-size=500000`. `-h`/`--help` prints usage; bad `--color` exits 2 with the valid-modes list.
3. **Prompt resolution** — if `--prompt -`, or `--prompt` is omitted and `!process.stdin.isTTY`, read all of stdin (sync via `fs.readFileSync(0, 'utf8')`) and use as the prompt. If both omitted and stdin is a TTY, error and exit 2 with usage.
4. **Backend dispatch** — `import('node-llama-cpp')` inside `main()` so a missing optional dependency produces a friendly "install node-llama-cpp" error rather than a node module-not-found stack trace. Resolve `--model`: if it looks like a path (`/`, `./`, `.gguf` suffix, or exists on disk), load locally; otherwise treat as HF repo id and use `node-llama-cpp`'s built-in downloader (or fall back to manual fetch of the recommended quant from the HF API). Cache to `~/.cache/gpdu-llm-density/models/`.
5. **Tree build** — `buildScan(modelHandle, prompt, opts)` returns a normalized `scan` shape (see below). Drives the DFS expansion with the KV-cache stack.
6. **HTML emit** — `buildHtml(out, prompt, modelLabel, scan, colorBy, blockSize)`; one shared helper that mirrors `gpdu-json.js`'s `buildHtml` — wraps `partitionBlocks` + `encodeBlock`, inlines `BUNDLE`, `LOADER_JS`, the prompt-aware title row, the color/theme/palette dropdowns, and the stats bar.
7. **Final summary + open** — stdout summary of nodes built, total mass explored, elapsed time, and output file size; then `open` / `xdg-open` unless `--no-open`. Matches `gpdu-json.js:113-131`.

### `scan` object produced

Conforms to the contract in `tools/scan-core.js` (`labels`, `parentIndices`, `values`, `attributes`, `stubFields`). For this tool:

- `labels: string[]` — decoded token string per node; root = `(prompt)`; `(other)` and `(end)` for synthetic leaves.
- `parentIndices: number[]` — `-1` for root.
- `values: number[]` — **joint probability** of the root→node prefix. `partitionBlocks` will sum children back up; the `(other)` siblings make every internal node reconcile to its own joint exactly (analogous to how `(leftover)` reconciles JSON byte spans in `gpdu-json`).
- `attributes`:
  - `probability` — numeric, conditional p|parent (root = 1).
  - `depth` — numeric.
  - `tokenRank` — numeric, 1-based; `(other)` and `(prompt)` get NaN (rendered as muted in the categorical legend).
  - `surprisal` — numeric, `-Math.log2(probability)`; root = 0; `(other)` computed from its conditional.
  - `leafReason` — categorical: `(internal)` for expanded nodes, plus `max-depth` / `pruned` / `eos` / `other-bucket` for terminals.
  - `tokenId` — numeric (vocabulary id; for tooltip only; not a color mode).

### KV-cache stack — depth-first traversal

Conceptual loop, sitting on top of `node-llama-cpp`'s `LlamaContext` sequence API:

```
seq = ctx.createSequence();
seq.evaluate(promptTokens);                 // one batched forward pass
expand(rootNode);

function expand(node) {
  if (node.depth >= maxDepth) { mark('max-depth'); return; }
  if (node.joint < pruneProb)  { mark('pruned'); return; }
  if (nodeCount  >= maxNodes)  { mark('pruned'); return; }
  const logits = seq.getLastLogits();        // depends on whatever token we last fed
  const dist   = softmax(logits / T);
  const kept   = filterTopK_TopP_Prune(dist, node.joint);
  emit children for `kept` + the `(other)` residual.
  for (child of kept ordered by descending joint) {
    const savedTokenCount = seq.tokenCount;   // checkpoint
    seq.evaluate([child.tokenId]);            // one-token forward pass; KV-cache grows
    expand(child);
    seq.rewindTo(savedTokenCount);            // O(1) — pop the KV-cache slot
  }
}
```

Two correctness invariants worth calling out:

- The first time we visit a node, the only forward pass needed is the *one* token that just got appended — never the full prefix. This is why DFS + rewind makes `--continuation-max-depth=20` tractable on a real model.
- `rewindTo` (or whatever the `node-llama-cpp` API exposes for sequence-state rollback — Phase 2 task #1 is to confirm the exact method name and replace this placeholder) must restore both the KV-cache and the "last logits" pointer. If the available API only supports `save()` / `load()` snapshots of full state, fall back to that — semantically identical, slightly more memory.

### `tools/scan-core.js` (no changes)

Reused as-is. The new tool plugs into the same envelope:

- `partitionBlocks(scan, blockSize)` sums `values` bottom-up — works unchanged because joint probabilities sum like bytes do (children sum to ≤ parent; `(other)` siblings close any gap).
- `encodeBlock(scan, block, ctx)` ships the `attributes` arrays alongside the blocks; the browser-side loader exposes them via the existing `getColor` accessor wired from each tool's page script.
- `LOADER_JS` is generic over color modes — the page script wires the dropdown to the appropriate attribute array, identical to how `gpdu-json` wires `type` / `depth` / `key`.

### `tools/cli-command.js` (no changes)

Used as-is for the "copy-this-command" affordance under the title row.

### `tools/build.js` (no changes)

No new bundle output needed; the tool reuses `dist/gp-treemap.bundle.embed.js` + `dist/scan-loader.embed.js`.

### `package.json` (modified)

- Add `"gp-visualize-llm-continuation-density": "tools/gpdu-llm-density.js"` to `bin`.
- Add `"gpdu-llm-density": "tools/gpdu-llm-density.js"` as a shorter alias to `bin` (consistent with the `gpdu-*` family).
- Add `node-llama-cpp` to `optionalDependencies` AND `devDependencies` (matching `better-sqlite3`'s pattern).
- Add `tools/gpdu-llm-density.js` to the `files` array.
- No new top-level dependency on a tokenizer — `node-llama-cpp` exposes the tokenizer through the loaded model.

### `tests/llm-density.spec.js` (new)

Playwright spec, mirroring `tests/sqlite.spec.js` / `tests/json.spec.js`. Uses a **stub backend** to avoid downloading models in CI:

- Phase 1 ships the CLI with `--backend=stub` (hidden flag, undocumented in `--help`) producing a deterministic synthetic distribution from a hash of the prefix. The test exercises the full pipeline: parse args, build tree, write HTML, open in the browser, click around, screenshot.
- Phase 2 adds a smoke test gated on `process.env.LLM_DENSITY_E2E` that downloads `Qwen2.5-0.5B-Instruct-GGUF` (Q4_K_M, ~350 MB) and asserts a known-stable continuation has the expected top tokens. Not run by default.

### `AGENTS.md` (modified)

Append a `gpdu-llm-density` subsection — three sentences: data shape (one node = one token; values are joint probabilities, `(other)` reconciles), color modes (probability / depth / token-rank / surprisal / leaf-reason), the tricky bit (KV-cache stack: DFS + per-child save/rewind so we never re-evaluate the prefix).

### `README.md` (modified)

Add a CLI tools section between `gpdu-sqlite` and `gpdu-s3` (alphabetical doesn't matter — these are grouped by data source). Three-paragraph entry following the existing template: one-line summary, usage example, model-acquisition note (free local GGUF via `node-llama-cpp`).

---

## Task list

### Phase 1 — Skeleton CLI + stub backend, end-to-end HTML pipeline

1. Add `tools/gpdu-llm-density.js` with the header comment, `usage()`, full argv parser, and `--backend=stub` synthetic distribution generator (hash-of-prefix → deterministic 32-token distribution). No `node-llama-cpp` import yet.
2. Implement `buildScan(stubBackend, prompt, opts)`: DFS expansion, `(other)` reconciliation, EOS/max-depth/prune leaf-reasons, populates the five attribute arrays.
3. Implement `buildHtml(out, prompt, modelLabel, scan, colorBy, blockSize)` by porting `gpdu-json.js`'s `buildHtml` and swapping the title-row/stats-bar content (prompt-with-truncation in the title, `nodes / depth / explored-mass` in the stats bar).
4. Wire `--prompt -` and stdin auto-detect (`!process.stdin.isTTY`). Error path: both omitted on a TTY → exit 2 with usage.
5. Wire `--no-open` + the `open` / `xdg-open` post-write step (copy-paste from `gpdu-json.js:127-131`).
6. Register the two `bin` entries in `package.json`; add `tools/gpdu-llm-density.js` to the `files` array.
7. Add `tests/llm-density.spec.js` exercising the stub backend: build a tree from a fixed prompt, open the HTML headlessly, screenshot the treemap, click a non-trivial cell, screenshot the navigation, switch color modes and screenshot once per mode.
8. `npm test` — green.

### Phase 2 — Real `node-llama-cpp` backend with KV-cache stack

1. Add `node-llama-cpp` to `optionalDependencies` and `devDependencies`. `npm install`.
2. Read the `node-llama-cpp` v3 README to confirm the exact API names for: sequence creation, single-token `evaluate`, `getLastLogits` (or equivalent), and KV-cache rewind/save. Update the conceptual loop in `buildScan` to call the real methods. (Do **not** keep the placeholder names — replace them with real ones, with the doc URL in a one-line comment.)
3. Implement `loadModel(modelArg)`: path-vs-HF-repo-id heuristic; HF download via `node-llama-cpp`'s `getLlama({ ... })` / `resolveModelFile` helpers; cache directory under `~/.cache/gpdu-llm-density/models/`. Emit a `\r downloading <repo>  N MB / M MB` progress line while pulling.
4. Implement `realBackend.tokenizePrompt(text)` and `realBackend.expand(sequence, parentJoint, opts) → { children, otherConditional }`. Children sorted by descending conditional; filtered by top-k, top-p, prune-probability. Honor `--temperature`. Detect EOS via `model.tokens.eos`.
5. Wire the KV-cache stack: DFS visit order, `seq.tokenCount` checkpoint before each descent, `seq.rewindTo(checkpoint)` after each return. Verify against a hand-traced 3-token tree on SmolLM-135M.
6. Swap the default backend from `stub` to `real`; `--backend=stub` stays as a hidden flag for tests and demos.
7. Add a smoke test guarded by `LLM_DENSITY_E2E`: downloads Qwen2.5-0.5B-Instruct GGUF (~350 MB), runs the tool against a fixed prompt, asserts that the highest-joint depth-1 tokens are stable across runs (deterministic since temperature=1 + same model = same softmax).

### Phase 3 — Color modes, tooltip, progress polish

1. Populate the five attribute arrays in `buildScan` (`probability`, `depth`, `tokenRank`, `surprisal`, `leafReason`). Validate each one's `kind` (`numeric` vs `categorical`) matches what the loader expects.
2. In `buildHtml`, wire the `--color=` dropdown to switch between the five modes; reuse the existing palette/theme dropdowns from `gpdu-json.js` verbatim.
3. Implement the tooltip override (decoded-token / conditional p / joint p) in the page script — the loader provides node access; the page script formats the tooltip HTML.
4. Implement the `\r`-progress line: update every 200 ms (not every node — too chatty on real models). The "explored mass" tracker is a single float maintained incrementally: when a node is terminated as a leaf, add its joint to `mass_done`; when an internal node finishes expanding and all its children are resolved, the bookkeeping is automatic since `mass_done` already absorbed each terminal child.
5. Title-row prompt truncation: if `prompt.length > 110`, render `prompt.slice(0,50) + ' … ' + prompt.slice(-50)`; full prompt in the tooltip / help modal.
6. Update screenshots in `tests/llm-density.spec.js` baselines for all five color modes.

### Phase 4 — Docs

1. README: add the `gpdu-llm-density` / `gp-visualize-llm-continuation-density` subsection in CLI tools (template = the existing `gpdu-sqlite` subsection).
2. AGENTS.md: add the three-sentence subsection.
3. Add a sample to `samples/` (e.g. `samples/llm-density-fruit-flies.html`) generated from the canonical example prompt with SmolLM-135M, so the gallery has something to point at.
4. Optional: add a gallery entry under `gallery/` once we're ready to publish; defer the publish step (this plan ships local-trial only, matching the gpdu-s3-sqlite-json plan's "nothing publishes" stance).
