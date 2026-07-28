import type { DatosFormulario, PerfilTitular, ResultadoParseo } from "./types";
import {
  hoyDMA,
  isoAFechaDMA,
  lugarFechaHoy,
  normalizar,
  parseDescripcion,
  parsearFechaCita,
  separarNombre,
} from "./util";
import { nombreTitularNormalizado, perfilCompleto } from "./perfil";

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

export function parseCfdi(
  xmlTexto: string,
  nombreArchivoXml: string,
  perfil: PerfilTitular
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

  // --- Descripción: paciente, especialidad y fecha de consulta ---
  const desc = parseDescripcion(descripcion);

  const nombrePaciente = desc.nombrePaciente || nombreReceptor;
  const paciente = separarNombre(nombrePaciente);
  if (!desc.nombrePaciente) {
    avisos.push(
      "No se pudo leer el paciente de la descripción; se usó el receptor del CFDI."
    );
  }

  const especialidad = desc.especialidad;
  if (!especialidad) {
    avisos.push(
      "No se pudo deducir la especialidad de la descripción: captúrala."
    );
  }

  // --- Parentesco: conjunto cerrado (TITULAR / CÓNYUGE / HIJO / HIJA) ---
  // Se basa en el PACIENTE: el receptor del CFDI siempre es la titular (quien
  // recibe la factura), así que no sirve para deducir el parentesco.
  // Sin perfil capturado no hay con qué comparar: el parentesco se selecciona.
  const nombreTitular = nombreTitularNormalizado(perfil);
  const esTitular =
    Boolean(nombreTitular) && normalizar(nombrePaciente) === nombreTitular;

  // ¿El paciente comparte algún apellido con el titular? (indicio de hijo/a)
  const apellidosTitular = new Set(
    [perfil.titular.apellidoPaterno, perfil.titular.apellidoMaterno]
      .map(normalizar)
      .filter(Boolean)
  );
  const comparteApellido = [paciente.apellidoPaterno, paciente.apellidoMaterno]
    .map(normalizar)
    .filter(Boolean)
    .some((a) => apellidosTitular.has(a));

  let parentesco = "";
  if (esTitular) {
    parentesco = "TITULAR";
  } else if (comparteApellido) {
    parentesco = "HIJA"; // inferido; el apellido no distingue género
    avisos.push(
      'Parentesco inferido como "HIJA" por apellido compartido con el titular: verifica si es Hijo o Cónyuge.'
    );
  } else {
    avisos.push("El parentesco no viene en el CFDI: selecciónalo.");
  }

  if (!perfilCompleto(perfil)) {
    avisos.push(
      "Faltan datos del titular: complétalos en “Datos del titular y depósito”."
    );
  }

  // --- Fecha de consulta: de la descripción, con año de la factura ---
  const anioFactura = isoAFechaDMA(fechaIso).anio;
  let fechaConsulta = desc.fechaTexto
    ? parsearFechaCita(desc.fechaTexto, anioFactura)
    : null;
  if (!fechaConsulta) {
    // Sin fecha legible en la descripción, se usa la de emisión del CFDI.
    fechaConsulta = isoAFechaDMA(fechaIso);
    if (desc.fechaTexto) {
      avisos.push(
        `No se pudo interpretar la fecha ("${desc.fechaTexto}"); se usó la de emisión.`
      );
    } else {
      avisos.push(
        "No se encontró fecha de consulta en la descripción: se usó la de emisión, verifícala."
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
    lugarFecha: lugarFechaHoy(perfil.lugar),
  };

  const nombreBase = nombreArchivoXml.replace(/\.[^.]+$/, "");

  return { datos, nombreBase, avisos };
}
