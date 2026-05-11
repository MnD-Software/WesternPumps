export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function saveBlobBatch(files: Array<{ blob: Blob; filename: string }>): Promise<void> {
  for (const file of files) {
    saveBlob(file.blob, file.filename);
    await new Promise((resolve) => window.setTimeout(resolve, 180));
  }
}
