function downloadMarkdownFile(markdown, filename) {
  const blob = new Blob([String(markdown || "")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function buildBatchReportFilename(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  const pad = (item) => String(item).padStart(2, "0");
  return [
    "rag-batch-report",
    value.getFullYear(),
    pad(value.getMonth() + 1),
    pad(value.getDate()),
    pad(value.getHours()),
    pad(value.getMinutes()),
  ].join("-") + ".md";
}

export { buildBatchReportFilename, downloadMarkdownFile };
