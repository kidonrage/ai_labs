function pad(value) {
  return String(value).padStart(2, "0");
}

function buildLlmConfigTestReportFilename(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  return [
    "llm-config-test-report",
    value.getFullYear(),
    pad(value.getMonth() + 1),
    pad(value.getDate()),
    pad(value.getHours()),
    pad(value.getMinutes()),
  ].join("-") + ".md";
}

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

export { buildLlmConfigTestReportFilename, downloadMarkdownFile };
