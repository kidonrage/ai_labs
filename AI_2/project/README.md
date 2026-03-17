# Simple Document Indexing Pipeline

This project is a very small учебный пример пайплайна индексации документов на Python.
It reads local files from `docs/`, extracts text, builds chunks in two ways, asks Ollama for embeddings, and saves two local JSON indexes.

## Project Structure

```text
project/
├── docs/
│   ├── example1.md
│   ├── example2.txt
│   ├── example3.py
│   ├── example4.js
│   └── example5.json
├── main.py
├── requirements.txt
└── README.md
```

## Supported File Types

The script reads these file types as plain UTF-8 text:

- `.md`
- `.txt`
- `.py`
- `.js`
- `.json`

If a file cannot be read, the script prints a clear message and skips it.

## Install Dependencies

```bash
cd project
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run Ollama with `embeddinggemma`

Make sure Ollama is installed and the model is available:

```bash
ollama pull embeddinggemma
ollama serve
```

The script sends requests to:

```text
http://localhost:11434/api/embed
```

## Run the Script

```bash
cd project
python3 main.py
```

## Output Files

After running the script, these files will be created:

- `index_fixed.json`
- `index_structured.json`

Each file contains a list of chunk objects with metadata and an `embedding` field.

## Chunking Strategies

### Fixed chunking

- Splits text into chunks of `800` characters
- Uses overlap of `100` characters
- Good when you want uniform chunk sizes

### Structured chunking

- For Markdown files, splits by headings like `#`, `##`, `###`
- For other file types, keeps the whole file as one chunk
- Good when you want chunks to follow document structure
