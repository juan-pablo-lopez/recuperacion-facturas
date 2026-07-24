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
