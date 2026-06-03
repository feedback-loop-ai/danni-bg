# Vendored ML models

The local-default translator and embedder providers (R3, R4) load ONNX-format models from this directory. Models are operator-supplied — they are not committed to the repository because they are large binaries.

## Required artifacts

| Provider | Path | Source |
|---|---|---|
| `local-marianmt` (BG→EN) | `vendor/models/marianmt-bg-en/` (`encoder.onnx`, `decoder.onnx`, `tokenizer.json`) | [`Helsinki-NLP/opus-mt-bg-en`](https://huggingface.co/Helsinki-NLP/opus-mt-bg-en) exported via `optimum`. |
| `local-onnx` (sentence embedder, multilingual) | `vendor/models/sentence-encoder/` (`model.onnx`, `tokenizer.json`) | [`sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) exported via `optimum`. |

## Operator setup

```bash
# Example for the embedder (requires Python + optimum-cli installed locally):
optimum-cli export onnx --model sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2 vendor/models/sentence-encoder/
```

Record the upstream model id and revision hash in `versions.txt` for reproducibility.

## Tests

Tests that exercise these models are skipped (with a clear `it.skip` marker) when the model files are absent so the test suite still runs in CI without bundled binaries. The skip message points the operator back here.
