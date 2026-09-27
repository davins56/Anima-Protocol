/** Minimal text PDF (Helvetica) for extractor tests. Offsets are computed. */
export function buildTextPdf(pages: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const pageObjs: { id: number; contentId: number }[] = [];
  const contentObjs: { id: number; body: string }[] = [];
  let id = 4;
  for (const text of pages) {
    const safe = text.replace(/\\/g, "\\\\").replace(/[()]/g, "");
    const stream = `BT /F1 18 Tf 72 720 Td (${safe}) Tj ET\n`;
    const contentId = id++;
    const pageId = id++;
    contentObjs.push({
      id: contentId,
      body: `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    });
    pageObjs.push({ id: pageId, contentId });
  }
  const kids = pageObjs.map((page) => `${page.id} 0 R`).join(" ");
  const objects: { id: number; body: string }[] = [
    { id: 1, body: `<< /Type /Catalog /Pages 2 0 R >>` },
    {
      id: 2,
      body: `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
    },
    { id: 3, body: `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>` },
  ];
  for (const page of pageObjs) {
    objects.push({
      id: page.id,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${page.contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    });
  }
  objects.push(...contentObjs);
  objects.sort((a, b) => a.id - b.id);

  let out = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets[obj.id] = encoder.encode(out).length;
    out += `${obj.id} 0 obj\n${obj.body}\nendobj\n`;
  }
  const xrefPos = encoder.encode(out).length;
  const size = objects.length + 1;
  out += `xref\n0 ${size}\n`;
  out += "0000000000 65535 f \n";
  for (let i = 1; i < size; i += 1) {
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return encoder.encode(out);
}

export function pdfBase64(pages: string[]): string {
  const bytes = buildTextPdf(pages);
  return Buffer.from(bytes).toString("base64");
}
