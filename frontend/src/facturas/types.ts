// Modelo de datos del formato de reembolso. Todos los campos son editables
// en la UI; el parser del CFDI solo los prellena cuando puede deducirlos.

export interface PersonaNombre {
  apellidoPaterno: string;
  apellidoMaterno: string;
  nombre: string;
}

export interface FechaDMA {
  dia: string; // DD
  mes: string; // MM
  anio: string; // AAAA
}

// Datos de quien reclama el reembolso: no vienen del CFDI y no cambian entre
// facturas, así que se capturan una vez y se guardan en localStorage.
export interface PerfilTitular {
  titular: PersonaNombre;
  numeroEmpleado: string;
  clabe: string;
  banco: string;
  lugar: string; // "Zapopan Jalisco" — se une con la fecha en el pie
  firma: string; // data URI de la firma escaneada; "" = se deja línea en blanco
}

export interface DatosFormulario {
  // Datos del paciente (de la descripción del CFDI + captura manual).
  paciente: PersonaNombre;
  parentesco: string;
  fechaNacimiento: string; // texto libre: "DD de MES de AAAA"

  // Datos del médico (emisor del CFDI).
  medico: PersonaNombre;
  especialidad: string;

  // Datos del recibo (Total, folio y fecha del CFDI).
  fechaConsulta: FechaDMA;
  importe: string;
  numeroFactura: string;

  // Fecha de entrega = día de ejecución (hoy).
  fechaEntrega: FechaDMA;

  // Lugar y fecha del pie del formato.
  lugarFecha: string;
}

// Resultado de parsear el CFDI, con banderas de qué se pudo deducir.
export interface ResultadoParseo {
  datos: DatosFormulario;
  // Nombre base (sin extensión) del XML; define el nombre de PDF y ZIP.
  nombreBase: string;
  // Advertencias no bloqueantes para mostrar al usuario.
  avisos: string[];
}
