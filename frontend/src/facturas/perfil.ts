// Perfil del titular: los datos de quien reclama el reembolso (nombre, número
// de empleado, cuenta de depósito, firma y lugar). No vienen del CFDI ni se
// versionan en el código: se capturan en la UI y viven en localStorage, así que
// cada persona que abre la app usa los suyos.

import type { PerfilTitular } from "./types";
import { normalizar } from "./util";

const LS_PERFIL = "recfact:perfil";

// Ancho máximo al que se reescala una firma subida. Suficiente para el PDF
// (que la dibuja a 120 pt) y mantiene el data URI chico para localStorage.
const FIRMA_ANCHO_MAX = 600;

// Límite del archivo de firma antes de procesarlo, para no cargar en memoria
// un escaneo enorme por accidente.
const FIRMA_BYTES_MAX = 5 * 1024 * 1024;

export const PERFIL_VACIO: PerfilTitular = {
  titular: { apellidoPaterno: "", apellidoMaterno: "", nombre: "" },
  numeroEmpleado: "",
  clabe: "",
  banco: "",
  lugar: "",
  firma: "",
};

export function leerPerfil(): PerfilTitular {
  try {
    const raw = localStorage.getItem(LS_PERFIL);
    if (!raw) return PERFIL_VACIO;
    const guardado = JSON.parse(raw) as Partial<PerfilTitular>;
    // Mezcla con el vacío para tolerar perfiles guardados por versiones previas.
    return {
      ...PERFIL_VACIO,
      ...guardado,
      titular: { ...PERFIL_VACIO.titular, ...(guardado.titular ?? {}) },
    };
  } catch {
    return PERFIL_VACIO;
  }
}

export function guardarPerfil(perfil: PerfilTitular): void {
  try {
    localStorage.setItem(LS_PERFIL, JSON.stringify(perfil));
  } catch {
    throw new Error(
      "No se pudo guardar el perfil: el almacenamiento del navegador está lleno. Prueba con una firma más pequeña."
    );
  }
}

export function borrarPerfil(): void {
  localStorage.removeItem(LS_PERFIL);
}

// Nombre completo del titular, en el orden en que aparece en un CFDI.
export function nombreCompletoTitular(perfil: PerfilTitular): string {
  return [
    perfil.titular.nombre,
    perfil.titular.apellidoPaterno,
    perfil.titular.apellidoMaterno,
  ]
    .filter(Boolean)
    .join(" ");
}

export function nombreTitularNormalizado(perfil: PerfilTitular): string {
  return normalizar(nombreCompletoTitular(perfil));
}

// Campos mínimos para que el formato salga completo. La firma es opcional: sin
// ella el PDF deja una línea para firmar a mano.
export function camposFaltantes(perfil: PerfilTitular): string[] {
  const faltan: string[] = [];
  if (!perfil.titular.nombre.trim()) faltan.push("nombre del titular");
  if (!perfil.titular.apellidoPaterno.trim()) faltan.push("apellido paterno");
  if (!perfil.numeroEmpleado.trim()) faltan.push("número de empleado");
  if (!perfil.clabe.trim()) faltan.push("CLABE");
  if (!perfil.banco.trim()) faltan.push("banco");
  return faltan;
}

export function perfilCompleto(perfil: PerfilTitular): boolean {
  return camposFaltantes(perfil).length === 0;
}

// Convierte una imagen de firma a un data URI PNG reescalado. Se usa canvas en
// lugar de guardar el archivo tal cual para acotar el tamaño en localStorage.
export async function archivoAFirma(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("La firma debe ser una imagen (PNG o JPG).");
  }
  if (file.size > FIRMA_BYTES_MAX) {
    throw new Error("La imagen de la firma es demasiado grande (máximo 5 MB).");
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("No se pudo leer la imagen de la firma."));
      el.src = url;
    });

    const escala = Math.min(1, FIRMA_ANCHO_MAX / img.naturalWidth);
    const ancho = Math.max(1, Math.round(img.naturalWidth * escala));
    const alto = Math.max(1, Math.round(img.naturalHeight * escala));

    const canvas = document.createElement("canvas");
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo procesar la imagen de la firma.");
    ctx.drawImage(img, 0, 0, ancho, alto);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
