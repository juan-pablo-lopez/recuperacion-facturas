import { useCallback, useRef, useState } from "react";
import {
  FiDownload,
  FiEye,
  FiFileText,
  FiUploadCloud,
  FiAlertTriangle,
} from "react-icons/fi";
import type { DatosFormulario, PersonaNombre } from "./types";
import { parseCfdi } from "./parseCfdi";
import { buildFormPdf } from "./buildFormPdf";
import { descargar, empaquetarZip, unirPdfs } from "./assemble";
import { normalizar } from "./util";

// --- Memoria local de fechas de nacimiento por paciente ---
const LS_KEY = "recfact:fechasNacimiento";
function leerFechasNac(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch {
    return {};
  }
}
function guardarFechaNac(nombrePaciente: string, fecha: string): void {
  if (!nombrePaciente || !fecha) return;
  const mapa = leerFechasNac();
  mapa[normalizar(nombrePaciente)] = fecha;
  localStorage.setItem(LS_KEY, JSON.stringify(mapa));
}

function leerTexto(file: File): Promise<string> {
  return file.text();
}
function leerBuffer(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

interface ArchivoPdf {
  nombre: string;
  buffer: ArrayBuffer;
}

export default function Home() {
  const [datos, setDatos] = useState<DatosFormulario | null>(null);
  const [nombreBase, setNombreBase] = useState("");
  const [xmlTexto, setXmlTexto] = useState("");
  const [avisos, setAvisos] = useState<string[]>([]);
  const [error, setError] = useState("");

  const [facturaPdf, setFacturaPdf] = useState<ArchivoPdf | null>(null);
  const [extraPdf, setExtraPdf] = useState<ArchivoPdf | null>(null);

  const [previewUrl, setPreviewUrl] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const dropRef = useRef<HTMLDivElement>(null);

  const cargarXml = useCallback(async (file: File) => {
    setError("");
    try {
      const texto = await leerTexto(file);
      const res = parseCfdi(texto, file.name);
      // Prellena la fecha de nacimiento si ya la conocíamos.
      const mapa = leerFechasNac();
      const nombrePac = [
        res.datos.paciente.nombre,
        res.datos.paciente.apellidoPaterno,
        res.datos.paciente.apellidoMaterno,
      ]
        .filter(Boolean)
        .join(" ");
      const recordada = mapa[normalizar(nombrePac)];
      if (recordada) res.datos.fechaNacimiento = recordada;

      setDatos(res.datos);
      setNombreBase(res.nombreBase);
      setXmlTexto(texto);
      setAvisos(res.avisos);
      setPreviewUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el XML.");
    }
  }, []);

  const cargarPdf = useCallback(
    async (file: File, slot: "factura" | "extra") => {
      const buffer = await leerBuffer(file);
      const archivo = { nombre: file.name, buffer };
      if (slot === "factura") setFacturaPdf(archivo);
      else setExtraPdf(archivo);
    },
    []
  );

  // Reparte archivos soltados: XML por extensión; el PDF que comparte nombre
  // con el XML es la factura, el otro es el documento extra.
  const manejarArchivos = useCallback(
    async (files: File[]) => {
      const xml = files.find((f) => f.name.toLowerCase().endsWith(".xml"));
      const pdfs = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));

      let base = nombreBase;
      if (xml) {
        await cargarXml(xml);
        base = xml.name.replace(/\.[^.]+$/, "");
      }

      if (pdfs.length === 1) {
        // Un solo PDF: si coincide con el XML es factura, si no, extra.
        const p = pdfs[0];
        const esFactura = base && p.name.replace(/\.[^.]+$/, "") === base;
        await cargarPdf(p, esFactura ? "factura" : facturaPdf ? "extra" : "factura");
      } else if (pdfs.length >= 2) {
        const factura =
          pdfs.find((p) => base && p.name.replace(/\.[^.]+$/, "") === base) ??
          pdfs[0];
        const extra = pdfs.find((p) => p !== factura) ?? pdfs[1];
        await cargarPdf(factura, "factura");
        await cargarPdf(extra, "extra");
      }
    },
    [cargarXml, cargarPdf, nombreBase, facturaPdf]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dropRef.current?.classList.remove("drop--over");
      manejarArchivos(Array.from(e.dataTransfer.files));
    },
    [manejarArchivos]
  );

  const listo = Boolean(datos && facturaPdf && extraPdf);

  const vistaPrevia = useCallback(async () => {
    if (!datos) return;
    setOcupado(true);
    try {
      const bytes = await buildFormPdf(datos);
      const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
        type: "application/pdf",
      });
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar la vista previa.");
    } finally {
      setOcupado(false);
    }
  }, [datos]);

  const generar = useCallback(async () => {
    if (!datos || !facturaPdf || !extraPdf) return;
    setOcupado(true);
    setError("");
    try {
      const formato = await buildFormPdf(datos);
      const ensamblado = await unirPdfs(
        formato,
        facturaPdf.buffer,
        extraPdf.buffer
      );
      const zip = await empaquetarZip(nombreBase, ensamblado, xmlTexto);

      const nombrePac = [
        datos.paciente.nombre,
        datos.paciente.apellidoPaterno,
        datos.paciente.apellidoMaterno,
      ]
        .filter(Boolean)
        .join(" ");
      guardarFechaNac(nombrePac, datos.fechaNacimiento);

      descargar(zip, `${nombreBase}.zip`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar el paquete.");
    } finally {
      setOcupado(false);
    }
  }, [datos, facturaPdf, extraPdf, nombreBase, xmlTexto]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Recuperación de facturas</h1>
        <p>
          Llena el formato de reembolso de gastos médicos con los datos del CFDI
          y arma un solo PDF con el formato, la factura y el documento extra.
          Todo en tu navegador: nada se sube a ningún servidor.
        </p>
      </header>

      <div className="layout">
        <section className="panel">
          <h2 className="panel-title">1 · Archivos</h2>
          <div
            ref={dropRef}
            className="drop"
            onDragOver={(e) => {
              e.preventDefault();
              dropRef.current?.classList.add("drop--over");
            }}
            onDragLeave={() => dropRef.current?.classList.remove("drop--over")}
            onDrop={onDrop}
          >
            <FiUploadCloud size={28} />
            <p>
              Arrastra aquí el <strong>XML</strong>, la <strong>factura PDF</strong> y el{" "}
              <strong>documento extra PDF</strong>.
            </p>
            <span className="drop-hint">
              El PDF con el mismo nombre que el XML se toma como la factura.
            </span>
          </div>

          <div className="slots">
            <FileSlot
              label="Factura (XML)"
              accept=".xml"
              nombre={nombreBase ? `${nombreBase}.xml` : ""}
              onFile={(f) => cargarXml(f)}
            />
            <FileSlot
              label="Factura (PDF)"
              accept="application/pdf,.pdf"
              nombre={facturaPdf?.nombre ?? ""}
              onFile={(f) => cargarPdf(f, "factura")}
            />
            <FileSlot
              label="Documento extra (PDF)"
              accept="application/pdf,.pdf"
              nombre={extraPdf?.nombre ?? ""}
              onFile={(f) => cargarPdf(f, "extra")}
            />
          </div>

          {error && (
            <p className="msg msg--error">
              <FiAlertTriangle /> {error}
            </p>
          )}
          {avisos.length > 0 && (
            <ul className="avisos">
              {avisos.map((a, i) => (
                <li key={i}>
                  <FiAlertTriangle /> {a}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2 className="panel-title">2 · Vista previa del formato</h2>
          {previewUrl ? (
            <iframe className="preview" title="Vista previa" src={previewUrl} />
          ) : (
            <div className="preview preview--empty">
              <FiFileText size={28} />
              <span>
                Carga el XML y pulsa “Ver formato” para revisar cómo quedará.
              </span>
            </div>
          )}
          <div className="acciones">
            <button
              className="btn"
              disabled={!datos || ocupado}
              onClick={vistaPrevia}
            >
              <FiEye /> Ver formato
            </button>
            <button
              className="btn btn--primary"
              disabled={!listo || ocupado}
              onClick={generar}
            >
              <FiDownload /> {ocupado ? "Generando…" : "Generar ZIP"}
            </button>
          </div>
        </section>
      </div>

      {datos && (
        <section className="panel panel--form">
          <h2 className="panel-title">
            Datos del formato{" "}
            <span className="panel-sub">(edítalos antes de generar)</span>
          </h2>
          <Formulario datos={datos} onChange={setDatos} />
        </section>
      )}
    </div>
  );
}

// --- Slot de archivo individual ---
function FileSlot({
  label,
  accept,
  nombre,
  onFile,
}: {
  label: string;
  accept: string;
  nombre: string;
  onFile: (f: File) => void;
}) {
  return (
    <label className={`slot ${nombre ? "slot--full" : ""}`}>
      <span className="slot-label">{label}</span>
      <span className="slot-name">{nombre || "Sin archivo"}</span>
      <input
        type="file"
        accept={accept}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </label>
  );
}

// --- Formulario editable ---
function Formulario({
  datos,
  onChange,
}: {
  datos: DatosFormulario;
  onChange: (d: DatosFormulario) => void;
}) {
  const set = <K extends keyof DatosFormulario>(k: K, v: DatosFormulario[K]) =>
    onChange({ ...datos, [k]: v });
  const setPersona = (
    k: "paciente" | "medico",
    campo: keyof PersonaNombre,
    v: string
  ) => onChange({ ...datos, [k]: { ...datos[k], [campo]: v } });

  return (
    <div className="form-grid">
      <fieldset>
        <legend>Paciente</legend>
        <Campo
          label="Apellido paterno"
          value={datos.paciente.apellidoPaterno}
          onChange={(v) => setPersona("paciente", "apellidoPaterno", v)}
        />
        <Campo
          label="Apellido materno"
          value={datos.paciente.apellidoMaterno}
          onChange={(v) => setPersona("paciente", "apellidoMaterno", v)}
        />
        <Campo
          label="Nombre"
          value={datos.paciente.nombre}
          onChange={(v) => setPersona("paciente", "nombre", v)}
        />
        <SelectCampo
          label="Parentesco"
          value={datos.parentesco}
          opciones={["", "TITULAR", "CÓNYUGE", "HIJO", "HIJA"]}
          onChange={(v) => set("parentesco", v)}
        />
        <Campo
          label="Fecha de nacimiento"
          value={datos.fechaNacimiento}
          placeholder="DD de MES de AAAA"
          onChange={(v) => set("fechaNacimiento", v)}
        />
      </fieldset>

      <fieldset>
        <legend>Médico</legend>
        <Campo
          label="Apellido paterno"
          value={datos.medico.apellidoPaterno}
          onChange={(v) => setPersona("medico", "apellidoPaterno", v)}
        />
        <Campo
          label="Apellido materno"
          value={datos.medico.apellidoMaterno}
          onChange={(v) => setPersona("medico", "apellidoMaterno", v)}
        />
        <Campo
          label="Nombre"
          value={datos.medico.nombre}
          onChange={(v) => setPersona("medico", "nombre", v)}
        />
        <Campo
          label="Especialidad"
          value={datos.especialidad}
          onChange={(v) => set("especialidad", v)}
        />
      </fieldset>

      <fieldset>
        <legend>Recibo</legend>
        <div className="fecha-row">
          <Campo
            label="Consulta · Día"
            value={datos.fechaConsulta.dia}
            onChange={(v) =>
              set("fechaConsulta", { ...datos.fechaConsulta, dia: v })
            }
          />
          <Campo
            label="Mes"
            value={datos.fechaConsulta.mes}
            onChange={(v) =>
              set("fechaConsulta", { ...datos.fechaConsulta, mes: v })
            }
          />
          <Campo
            label="Año"
            value={datos.fechaConsulta.anio}
            onChange={(v) =>
              set("fechaConsulta", { ...datos.fechaConsulta, anio: v })
            }
          />
        </div>
        <Campo
          label="Importe"
          value={datos.importe}
          onChange={(v) => set("importe", v)}
        />
        <Campo
          label="Número de recibo o factura"
          value={datos.numeroFactura}
          onChange={(v) => set("numeroFactura", v)}
        />
      </fieldset>

      <fieldset>
        <legend>Entrega</legend>
        <div className="fecha-row">
          <Campo
            label="Día"
            value={datos.fechaEntrega.dia}
            onChange={(v) =>
              set("fechaEntrega", { ...datos.fechaEntrega, dia: v })
            }
          />
          <Campo
            label="Mes"
            value={datos.fechaEntrega.mes}
            onChange={(v) =>
              set("fechaEntrega", { ...datos.fechaEntrega, mes: v })
            }
          />
          <Campo
            label="Año"
            value={datos.fechaEntrega.anio}
            onChange={(v) =>
              set("fechaEntrega", { ...datos.fechaEntrega, anio: v })
            }
          />
        </div>
        <Campo
          label="Lugar y fecha"
          value={datos.lugarFecha}
          onChange={(v) => set("lugarFecha", v)}
        />
      </fieldset>
    </div>
  );
}

function Campo({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="campo">
      <span>{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function SelectCampo({
  label,
  value,
  opciones,
  onChange,
}: {
  label: string;
  value: string;
  opciones: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="campo">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {opciones.map((o) => (
          <option key={o} value={o}>
            {o || "— Selecciona —"}
          </option>
        ))}
      </select>
    </label>
  );
}
