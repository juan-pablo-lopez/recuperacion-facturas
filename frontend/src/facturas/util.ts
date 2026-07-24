import type { FechaDMA, PersonaNombre } from "./types";

export const MESES = [
  "ENERO",
  "FEBRERO",
  "MARZO",
  "ABRIL",
  "MAYO",
  "JUNIO",
  "JULIO",
  "AGOSTO",
  "SEPTIEMBRE",
  "OCTUBRE",
  "NOVIEMBRE",
  "DICIEMBRE",
];

const MESES_CAP = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

// Quita acentos y pasa a mayúsculas, para comparaciones robustas.
export function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

// Divide un nombre completo mexicano en nombre + dos apellidos.
// Heurística: los dos últimos tokens son los apellidos, el resto el nombre.
// Es editable en la UI para los casos ambiguos (apellidos compuestos).
export function separarNombre(completo: string): PersonaNombre {
  const tokens = completo.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { apellidoPaterno: "", apellidoMaterno: "", nombre: "" };
  }
  if (tokens.length === 1) {
    return { apellidoPaterno: "", apellidoMaterno: "", nombre: tokens[0] };
  }
  if (tokens.length === 2) {
    return {
      apellidoPaterno: tokens[0],
      apellidoMaterno: "",
      nombre: tokens[1],
    };
  }
  const apellidoMaterno = tokens[tokens.length - 1];
  const apellidoPaterno = tokens[tokens.length - 2];
  const nombre = tokens.slice(0, tokens.length - 2).join(" ");
  return { apellidoPaterno, apellidoMaterno, nombre };
}

// Convierte una fecha ISO (YYYY-MM-DDThh:mm:ss) a {dia,mes,anio}.
export function isoAFechaDMA(iso: string): FechaDMA {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return { dia: "", mes: "", anio: "" };
  return { anio: m[1], mes: m[2], dia: m[3] };
}

// Fecha de hoy como {dia,mes,anio} (dos dígitos en día y mes).
export function hoyDMA(): FechaDMA {
  const d = new Date();
  return {
    dia: String(d.getDate()).padStart(2, "0"),
    mes: String(d.getMonth() + 1).padStart(2, "0"),
    anio: String(d.getFullYear()),
  };
}

// "Zapopan Jalisco, 24 de Julio 2026" a partir de la fecha de hoy.
export function lugarFechaHoy(lugar: string): string {
  const d = new Date();
  return `${lugar}, ${d.getDate()} de ${MESES_CAP[d.getMonth()]} ${d.getFullYear()}`;
}

// Intenta interpretar la fecha de la cita ("11 DE JUNIO 6:30", "11/06", etc.)
// usando el año de la factura como referencia. Devuelve null si no puede.
export function parsearFechaCita(
  cita: string,
  anioFactura: string
): FechaDMA | null {
  const texto = normalizar(cita);

  // Formato "DD DE MES ..."
  let m = texto.match(/(\d{1,2})\s+DE\s+([A-ZÁÉÍÓÚÑ]+)/);
  if (m) {
    const dia = m[1].padStart(2, "0");
    const idx = MESES.indexOf(normalizar(m[2]));
    if (idx >= 0) {
      return { dia, mes: String(idx + 1).padStart(2, "0"), anio: anioFactura };
    }
  }

  // Formato "DD/MM" o "DD/MM/AAAA"
  m = texto.match(/(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/);
  if (m) {
    const dia = m[1].padStart(2, "0");
    const mes = m[2].padStart(2, "0");
    let anio = anioFactura;
    if (m[3]) anio = m[3].length === 2 ? "20" + m[3] : m[3];
    return { dia, mes, anio };
  }

  return null;
}

// Formatea un importe numérico como "$ 1,000.00".
export function formatoImporte(valor: string): string {
  const n = Number(valor);
  if (!Number.isFinite(n)) return valor;
  return n.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
