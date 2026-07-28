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
// Sin lugar configurado, devuelve solo la fecha.
export function lugarFechaHoy(lugar: string): string {
  const d = new Date();
  const fecha = `${d.getDate()} de ${MESES_CAP[d.getMonth()]} ${d.getFullYear()}`;
  return lugar.trim() ? `${lugar.trim()}, ${fecha}` : fecha;
}

// Intenta interpretar una fecha en texto ("11 DE JUNIO 6:30",
// "16 de mayo del 2026", "11/06", "16/05/2026", etc.) usando el año de la
// factura como referencia cuando el texto no trae año. Devuelve null si no puede.
export function parsearFechaCita(
  cita: string,
  anioFactura: string
): FechaDMA | null {
  const texto = normalizar(cita);

  // Formato "DD DE MES [DE|DEL AAAA]"
  let m = texto.match(/(\d{1,2})\s+DE\s+([A-ZÁÉÍÓÚÑ]+)(?:\s+DEL?\s+(\d{2,4}))?/);
  if (m) {
    const idx = MESES.indexOf(normalizar(m[2]));
    if (idx >= 0) {
      const dia = m[1].padStart(2, "0");
      let anio = anioFactura;
      if (m[3]) anio = m[3].length === 2 ? "20" + m[3] : m[3];
      return { dia, mes: String(idx + 1).padStart(2, "0"), anio };
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

// Patrón de fecha dentro de un texto libre (para ubicar dónde empieza).
const FECHA_EN_TEXTO =
  /\d{1,2}\s+de\s+[a-záéíóúñ]+(?:\s+del?\s+\d{2,4})?|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?/i;

// Palabras que marcan el inicio del tratamiento/especialidad en descripciones
// sin etiquetas (donde el nombre del paciente va pegado al resto del texto).
const TRATAMIENTO =
  /\b(terapia|consulta|sesi[oó]n|psicolog\w*|nutri\w*|valoraci[oó]n|tratamiento|rehabilitaci[oó]n|fisioterapia|evaluaci[oó]n|revisi[oó]n|dental|m[eé]dic\w*)\b/i;

function limpiarNombre(s: string): string {
  return s
    .trim()
    .replace(/[.,;:]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function limpiarEspecialidad(s: string): string {
  return s
    .trim()
    .replace(/^[\s.,;:-]+/, "")
    .replace(/[\s.,;:-]+$/, "")
    .replace(/\s+(del|de|el|la|los|las|en|por|con)\s*$/i, "")
    .replace(/[\s.,;:-]+$/, "")
    .trim();
}

export interface DescripcionParseada {
  nombrePaciente: string;
  especialidad: string;
  fechaTexto: string;
}

// Extrae paciente, especialidad y fecha de la descripción del concepto.
// Soporta dos patrones:
//   Etiquetado: "PACIENTE: ... CONSULTA: ... CITA: ..."
//   Libre:      "Paciente: <nombre> <tratamiento> del <fecha>."
export function parseDescripcion(desc: string): DescripcionParseada {
  const out: DescripcionParseada = {
    nombrePaciente: "",
    especialidad: "",
    fechaTexto: "",
  };
  if (!desc || !desc.trim()) return out;

  // Texto tras "Paciente:" (si existe la etiqueta); si no, toda la descripción.
  const mp = desc.match(/paciente\s*:?\s*(.*)$/is);
  const resto = (mp ? mp[1] : desc).trim();

  // --- Patrón etiquetado: respeta CONSULTA:/CITA: ---
  if (/\bconsulta\s*:/i.test(resto) || /\bcita\s*:/i.test(resto)) {
    out.nombrePaciente = limpiarNombre(
      resto.split(/\s*(?:consulta|cita)\s*:/i)[0]
    );
    const mc = resto.match(/consulta\s*:\s*([^.]*)/i);
    if (mc) out.especialidad = limpiarEspecialidad(mc[1]);
    const mci = resto.match(/cita\s*:\s*(.*)$/i);
    if (mci) out.fechaTexto = mci[1].trim();
    return out;
  }

  // --- Patrón libre: nombre + tratamiento + fecha, todo pegado ---
  const fechaMatch = resto.match(FECHA_EN_TEXTO);
  const tratMatch = resto.match(TRATAMIENTO);

  // El nombre termina donde antes empiece el tratamiento o la fecha.
  let corte = resto.length;
  if (tratMatch?.index !== undefined && tratMatch.index < corte)
    corte = tratMatch.index;
  if (fechaMatch?.index !== undefined && fechaMatch.index < corte)
    corte = fechaMatch.index;

  out.nombrePaciente = limpiarNombre(resto.slice(0, corte));
  if (fechaMatch) out.fechaTexto = fechaMatch[0];

  const finEsp =
    fechaMatch?.index !== undefined ? fechaMatch.index : resto.length;
  out.especialidad = limpiarEspecialidad(resto.slice(corte, finEsp));

  return out;
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
