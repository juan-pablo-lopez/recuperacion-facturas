import { TITULAR } from "./constants";
import type { DatosFormulario, ResultadoParseo } from "./types";
import {
  hoyDMA,
  isoAFechaDMA,
  lugarFechaHoy,
  normalizar,
  parsearFechaCita,
  separarNombre,
} from "./util";
import { LUGAR_BASE } from "./constants";

// Lee un atributo de un elemento sin depender del prefijo de namespace.
function attr(el: Element | null, name: string): string {
  return el?.getAttribute(name)?.trim() ?? "";
}

// Busca el primer elemento cuyo nombre local coincida (ignora el prefijo cfdi:).
function first(root: Document | Element, local: string): Element | null {
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === local) return all[i];
  }
  return null;
}

// Extrae "PACIENTE: ...", "CONSULTA: ...", "CITA: ..." de la descripción.
// Devuelve el texto de cada etiqueta (sin la etiqueta), o "" si no está.
function campoDescripcion(desc: string, etiqueta: string): string {
  // Captura hasta la siguiente etiqueta conocida o el fin del texto.
  const re = new RegExp(
    `${etiqueta}\\s*:?\\s*(.*?)(?=\\s*(?:PACIENTE|CONSULTA|CITA)\\s*:|$)`,
    "is"
  );
  const m = desc.match(re);
  return m ? m[1].trim().replace(/[.\s]+$/, "").trim() : "";
}

export function parseCfdi(
  xmlTexto: string,
  nombreArchivoXml: string
): ResultadoParseo {
  const avisos: string[] = [];
  const doc = new DOMParser().parseFromString(xmlTexto, "application/xml");

  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("El XML no es un CFDI válido (error de lectura).");
  }

  const comprobante = first(doc, "Comprobante");
  if (!comprobante) {
    throw new Error("El XML no parece un CFDI (no se encontró Comprobante).");
  }

  const emisor = first(doc, "Emisor");
  const receptor = first(doc, "Receptor");
  const concepto = first(doc, "Concepto");
  const timbre = first(doc, "TimbreFiscalDigital");

  const fechaIso = attr(comprobante, "Fecha");
  const total = attr(comprobante, "Total");
  const serie = attr(comprobante, "Serie");
  const folio = attr(comprobante, "Folio");
  const uuid = attr(timbre, "UUID");

  const nombreEmisor = attr(emisor, "Nombre");
  const nombreReceptor = attr(receptor, "Nombre");
  const descripcion = attr(concepto, "Descripcion");

  // --- Médico = emisor del CFDI ---
  const medico = separarNombre(nombreEmisor);
  if (!nombreEmisor) avisos.push("El CFDI no trae nombre del emisor (médico).");

  // --- Descripción: paciente, especialidad (consulta), fecha de cita ---
  const pacienteDesc = campoDescripcion(descripcion, "PACIENTE");
  const consulta = campoDescripcion(descripcion, "CONSULTA");
  const cita = campoDescripcion(descripcion, "CITA");

  const nombrePaciente = pacienteDesc || nombreReceptor;
  const paciente = separarNombre(nombrePaciente);
  if (!pacienteDesc) {
    avisos.push(
      "No se encontró 'PACIENTE:' en la descripción; se usó el receptor del CFDI."
    );
  }

  // Parentesco: si el paciente es el titular, es "TITULAR"; si no, en blanco.
  const esTitular =
    normalizar(nombrePaciente) === TITULAR.nombreCompletoNormalizado ||
    normalizar(nombreReceptor) === TITULAR.nombreCompletoNormalizado;
  const parentesco = esTitular ? "TITULAR" : "";
  if (!esTitular) {
    avisos.push(
      "El parentesco no viene en el CFDI: complétalo manualmente."
    );
  }

  const especialidad = consulta;
  if (!consulta) {
    avisos.push(
      "No se encontró 'CONSULTA:' en la descripción: captura la especialidad."
    );
  }

  // --- Fecha de consulta: de la CITA, con año de la factura ---
  const anioFactura = isoAFechaDMA(fechaIso).anio;
  let fechaConsulta = cita ? parsearFechaCita(cita, anioFactura) : null;
  if (!fechaConsulta) {
    // Sin cita legible, se usa la fecha de emisión del CFDI.
    fechaConsulta = isoAFechaDMA(fechaIso);
    if (cita) {
      avisos.push(
        `No se pudo interpretar la CITA ("${cita}"); se usó la fecha de emisión.`
      );
    }
  }

  // --- Número de factura: Serie+Folio si existen, si no el UUID ---
  let numeroFactura: string;
  if (folio) numeroFactura = serie ? `${serie}-${folio}` : folio;
  else numeroFactura = uuid;

  // La fecha de nacimiento no existe en el CFDI: siempre manual.
  avisos.push("La fecha de nacimiento no viene en el CFDI: captúrala.");

  const datos: DatosFormulario = {
    paciente,
    parentesco,
    fechaNacimiento: "",
    medico,
    especialidad,
    fechaConsulta,
    importe: total,
    numeroFactura,
    fechaEntrega: hoyDMA(),
    lugarFecha: lugarFechaHoy(LUGAR_BASE),
  };

  const nombreBase = nombreArchivoXml.replace(/\.[^.]+$/, "");

  return { datos, nombreBase, avisos };
}
