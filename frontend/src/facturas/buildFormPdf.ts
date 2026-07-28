import pdfMake from "pdfmake/build/pdfmake";
import * as pdfFontsModule from "pdfmake/build/vfs_fonts";
import type {
  Content,
  TableCell,
  TDocumentDefinitions,
} from "pdfmake/interfaces";
import type { DatosFormulario, PerfilTitular } from "./types";
import {
  CONFIDENCIAL,
  EMPRESA,
  TITULO_FORMATO,
  AVISO_PRIVACIDAD_PRE,
  AVISO_PRIVACIDAD_ASEGURADORA,
  AVISO_PRIVACIDAD_POST,
} from "./constants";
import { formatoImporte } from "./util";

// vfs_fonts expone las fuentes de distinta forma según el empaquetado.
const vfs =
  (pdfFontsModule as unknown as { vfs?: Record<string, string> }).vfs ??
  (pdfFontsModule as unknown as { default?: { vfs?: Record<string, string> } })
    .default?.vfs ??
  (pdfFontsModule as unknown as { pdfMake?: { vfs?: Record<string, string> } })
    .pdfMake?.vfs;
if (vfs) {
  (pdfMake as unknown as { vfs: Record<string, string> }).vfs = vfs;
}

const GRIS = "#d9d9d9";
const GRIS_SUAVE = "#f2f2f2";

// Layout con todos los bordes finos negros.
const bordeFino = {
  hLineWidth: () => 0.7,
  vLineWidth: () => 0.7,
  hLineColor: () => "#000000",
  vLineColor: () => "#000000",
  paddingTop: () => 2,
  paddingBottom: () => 2,
  paddingLeft: () => 3,
  paddingRight: () => 3,
};

// Barra de sección: una celda gris a lo ancho.
function barra(texto: string, fill = GRIS): Content {
  return {
    table: { widths: ["*"], body: [[{ text: texto, style: "seccion", fillColor: fill }]] },
    layout: bordeFino,
    margin: [0, 0, 0, 0],
  };
}

// Ancho de la columna de etiquetas (NOMBRE:, PARENTESCO:, etc.).
// Fijo para que todos los divisores de una sección queden alineados.
// Ajustado para dejar más espacio a apellidos, nombre y fecha de nacimiento.
const ANCHO_LABEL = 54;

// Encabezado de columna (celda gris suave, pequeña).
function th(texto: string): TableCell {
  return { text: texto, style: "th", fillColor: GRIS_SUAVE };
}
function td(texto: string) {
  return { text: texto || " ", style: "td" };
}
function lbl(texto: string) {
  return { text: texto, style: "label" };
}

// Fila de encabezados de una sección de persona.
function filaEncabezados(): TableCell[] {
  return [{ text: "" }, th("APELLIDO PATERNO"), th("APELLIDO MATERNO"), th("NOMBRE")];
}

// Sección de persona como UNA tabla: encabezados + nombre + fila extra.
// Todas las filas comparten la misma rejilla, así los bordes se alinean.
function tablaPersona(
  paterno: string,
  materno: string,
  nombre: string,
  filaExtra: TableCell[]
): Content {
  return {
    table: {
      widths: [ANCHO_LABEL, "*", "*", "*"],
      body: [
        filaEncabezados(),
        [lbl("NOMBRE:"), td(paterno), td(materno), td(nombre)],
        filaExtra,
      ],
    },
    layout: bordeFino,
    margin: [0, 0, 0, 4],
  };
}

export async function buildFormPdf(
  datos: DatosFormulario,
  perfil: PerfilTitular
): Promise<Uint8Array> {
  const { fechaEntrega: fe, fechaConsulta: fc } = datos;

  // --- Columna izquierda: titular, paciente, médico ---
  const columnaIzq: Content[] = [
    barra("DATOS GENERALES"),
    { text: "", margin: [0, 2, 0, 0] },
    barra("DATOS TITULAR"),
    tablaPersona(
      perfil.titular.apellidoPaterno,
      perfil.titular.apellidoMaterno,
      perfil.titular.nombre,
      [lbl("NUMERO EMP:"), { ...td(perfil.numeroEmpleado), colSpan: 3 }, {}, {}]
    ),
    barra("DATOS PACIENTE"),
    tablaPersona(
      datos.paciente.apellidoPaterno,
      datos.paciente.apellidoMaterno,
      datos.paciente.nombre,
      [
        lbl("PARENTESCO:"),
        td(datos.parentesco),
        lbl("FECHA DE NACIMIENTO:"),
        { ...td(datos.fechaNacimiento), noWrap: true, fontSize: 7.5 },
      ]
    ),
    barra("DATOS MEDICO"),
    tablaPersona(
      datos.medico.apellidoPaterno,
      datos.medico.apellidoMaterno,
      datos.medico.nombre,
      [lbl("ESPECIALIDAD:"), { ...td(datos.especialidad), colSpan: 3 }, {}, {}]
    ),
  ];

  // --- Columna derecha: fecha de entrega, recibo, depósito ---
  const columnaDer: Content[] = [
    {
      table: {
        widths: ["*", "*", "*"],
        body: [
          [{ text: "Fecha de Entrega", style: "seccion", fillColor: GRIS, colSpan: 3 }, {}, {}],
          [th("DIA"), th("MES"), th("AÑO")],
          [td(fe.dia), td(fe.mes), td(fe.anio)],
        ],
      },
      layout: bordeFino,
      margin: [0, 0, 0, 6],
    },
    barra("DATOS DEL RECIBO"),
    {
      table: {
        widths: ["*", "*", "*", "*"],
        body: [
          [
            { text: "FECHA CONSULTA", style: "th", fillColor: GRIS_SUAVE, colSpan: 3 },
            {},
            {},
            th("IMPORTE"),
          ],
          [th("DIA"), th("MES"), th("AÑO"), { text: "", fillColor: GRIS_SUAVE }],
          [td(fc.dia), td(fc.mes), td(fc.anio), td(formatoImporte(datos.importe))],
        ],
      },
      layout: bordeFino,
    },
    {
      table: {
        widths: ["*"],
        body: [
          [{ text: "NUMERO  DE  RECIBO  O FACTURA", style: "th", fillColor: GRIS_SUAVE }],
          [td(datos.numeroFactura)],
        ],
      },
      layout: bordeFino,
      margin: [0, 0, 0, 6],
    },
    barra("INFORMACION PARA DEPOSITO"),
    { text: "   DATOS BANCARIOS:", style: "label", margin: [0, 2, 0, 2] },
    {
      table: {
        widths: [46, "*"],
        body: [
          [{ text: "Clabe:", style: "label" }, td(perfil.clabe)],
          [{ text: "Banco:", style: "label" }, td(perfil.banco)],
        ],
      },
      layout: bordeFino,
    },
  ];

  // Con firma escaneada se estampa la imagen; sin ella se deja una línea para
  // firmar a mano, ocupando un espacio equivalente.
  const bloqueFirma: Content[] = perfil.firma
    ? [{ image: perfil.firma, width: 120, alignment: "center" }]
    : [
        {
          canvas: [
            {
              type: "line",
              x1: 20,
              y1: 0,
              x2: 180,
              y2: 0,
              lineWidth: 0.7,
              lineColor: "#000000",
            },
          ],
          margin: [0, 34, 0, 2],
        },
      ];

  const docDefinition: TDocumentDefinitions = {
    pageSize: "LETTER",
    pageMargins: [36, 28, 36, 28],
    defaultStyle: { font: "Roboto", fontSize: 8, color: "#000000" },
    styles: {
      seccion: { bold: true, fontSize: 9, alignment: "center", margin: [0, 1, 0, 1] },
      th: { bold: true, fontSize: 6.5, alignment: "center", color: "#333333" },
      td: { fontSize: 8, bold: true, alignment: "center" },
      label: { fontSize: 6.5, bold: true },
    },
    content: [
      { text: CONFIDENCIAL, italics: true, fontSize: 7, alignment: "right" },
      { text: EMPRESA, bold: true, fontSize: 9, alignment: "center", margin: [0, 4, 0, 2] },
      barra(TITULO_FORMATO, GRIS),
      { text: "", margin: [0, 4, 0, 0] },
      {
        columns: [
          { width: "60%", stack: columnaIzq },
          { width: "40%", stack: columnaDer, margin: [8, 0, 0, 0] },
        ],
        columnGap: 0,
      },
      {
        text: [
          AVISO_PRIVACIDAD_PRE,
          { text: AVISO_PRIVACIDAD_ASEGURADORA, bold: true },
          AVISO_PRIVACIDAD_POST,
        ],
        fontSize: 6.5,
        alignment: "justify",
        margin: [0, 12, 0, 10],
      },
      {
        columns: [
          {
            width: "50%",
            stack: [
              { text: `LUGAR FECHA: ${datos.lugarFecha}`, fontSize: 8, margin: [0, 18, 0, 0] },
            ],
          },
          {
            width: "50%",
            stack: [
              ...bloqueFirma,
              {
                text: "FIRMA ASEGURADO TITULAR:",
                fontSize: 8,
                alignment: "center",
                margin: [0, 0, 0, 0],
              },
            ],
          },
        ],
      },
    ],
  };

  const pdf = pdfMake.createPdf(docDefinition);
  const buffer: Uint8Array = await new Promise((resolve) => {
    pdf.getBuffer((buf) => resolve(new Uint8Array(buf)));
  });
  return buffer;
}
