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

The script uses only the Python standard library.
You can run it directly, or create a virtual environment if you want isolation:

```bash
cd project
python3 -m venv .venv
source .venv/bin/activate
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
If `../static/` exists, the script also writes fresh copies there so the main app can use the new index immediately.

## Chunking Strategies

### Fixed chunking

- Splits text into chunks of `800` characters
- Uses overlap of `100` characters
- Good when you want uniform chunk sizes

### Structured chunking

- For Markdown files, splits by headings like `#`, `##`, `###`
- Large sections are split again into smaller chunks with overlap
- Table of contents and very small low-signal sections are skipped
- List items, paragraphs, and code fences are kept as separate semantic blocks when possible
- For other file types, text is also split into bounded chunks instead of one giant block
- Good when you want chunks to follow document structure without creating huge mixed-topic embeddings
