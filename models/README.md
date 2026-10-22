# Phonon model files (not tracked)

Checkpoints are downloaded on demand and cached by the browser. To run one locally instead,
put its files here:

```
models/phonon-31m-en/
  config.json
  tokenizer.json
  model.q8.gguf
  voices/          (optional)
```

The extension prefers a local copy over the Hugging Face Hub, so a folder here means the
model works with no network at all. The gated Phonon 40m checkpoints can only be used this
way: a browser has no token to authenticate to a gated repo.

```
models/phonon-40m-multilingual/
  config.json
  tokenizer.json
  model.q8.gguf
```

The folder is ignored by git. Download the files with the `huggingface_hub` CLI or from the
model page on Hugging Face.
