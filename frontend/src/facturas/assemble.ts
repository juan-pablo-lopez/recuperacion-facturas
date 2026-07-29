import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";

// Une, en orden: formato -> factura -> documento extra.
// El extra es opcional (suele ser el estado de cuenta que confirma los datos
// de depósito, y no siempre lo piden).
export async function unirPdfs(
  formato: Uint8Array,
  factura: ArrayBuffer,
  extra?: ArrayBuffer | null
): Promise<Uint8Array> {
  const salida = await PDFDocument.create();

  const fuentes = [formato.slice().buffer as ArrayBuffer, factura];
  if (extra) fuentes.push(extra);

  for (const fuente of fuentes) {
    const doc = await PDFDocument.load(fuente);
    const paginas = await salida.copyPages(doc, doc.getPageIndices());
    paginas.forEach((p) => salida.addPage(p));
  }

  return salida.save();
}

// Empaqueta el PDF ensamblado y el XML original en un ZIP.
// Ambos con el mismo nombre base que el XML.
export async function empaquetarZip(
  nombreBase: string,
  pdfEnsamblado: Uint8Array,
  xmlTexto: string
): Promise<Blob> {
  const zip = new JSZip();
  zip.file(`${nombreBase}.pdf`, pdfEnsamblado);
  zip.file(`${nombreBase}.xml`, xmlTexto);
  return zip.generateAsync({ type: "blob" });
}

// Dispara la descarga de un Blob con el nombre dado.
export function descargar(blob: Blob, nombreArchivo: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Libera la URL tras un breve margen para que alcance a iniciar la descarga.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
