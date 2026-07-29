import { useCallback, useRef, useState } from "react";
import {
  FiCheckCircle,
  FiDownload,
  FiEye,
  FiFileText,
  FiRotateCcw,
  FiTrash2,
  FiUploadCloud,
  FiUser,
  FiX,
  FiAlertTriangle,
} from "react-icons/fi";
import type { DatosFormulario, PerfilTitular, PersonaNombre } from "./types";
import { parseCfdi } from "./parseCfdi";
import { buildFormPdf } from "./buildFormPdf";
import { descargar, empaquetarZip, unirPdfs } from "./assemble";
import { normalizar } from "./util";
import {
  archivoAFirma,
  camposFaltantes,
  guardarPerfil,
  leerPerfil,
  nombreCompletoTitular,
  perfilCompleto,
} from "./perfil";

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
  const [perfil, setPerfil] = useState<PerfilTitular>(leerPerfil);
  // Si aún no hay perfil, el panel arranca abierto para pedir la captura.
  const [perfilAbierto, setPerfilAbierto] = useState(
    () => !perfilCompleto(leerPerfil())
  );

  const [datos, setDatos] = useState<DatosFormulario | null>(null);
  const [nombreBase, setNombreBase] = useState("");
  const [xmlTexto, setXmlTexto] = useState("");
  const [avisos, setAvisos] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [exito, setExito] = useState("");

  const [facturaPdf, setFacturaPdf] = useState<ArchivoPdf | null>(null);
  const [extraPdf, setExtraPdf] = useState<ArchivoPdf | null>(null);

  const [previewUrl, setPreviewUrl] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const dropRef = useRef<HTMLDivElement>(null);

  // Cada edición del perfil se persiste: es configuración, no estado de sesión.
  const actualizarPerfil = useCallback((p: PerfilTitular) => {
    setPerfil(p);
    try {
      guardarPerfil(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el perfil.");
    }
  }, []);

  const cargarXml = useCallback(
    async (file: File) => {
      setError("");
      setExito("");
      try {
        const texto = await leerTexto(file);
        const res = parseCfdi(texto, file.name, perfil);
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
    },
    [perfil]
  );

  const cargarPdf = useCallback(
    async (file: File, slot: "factura" | "extra") => {
      setExito("");
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

  // Deja la app como recién abierta, sin tocar el perfil ni las fechas guardadas.
  const reiniciar = useCallback(() => {
    setDatos(null);
    setNombreBase("");
    setXmlTexto("");
    setAvisos([]);
    setError("");
    setExito("");
    setFacturaPdf(null);
    setExtraPdf(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return "";
    });
  }, []);

  const hayAlgo = Boolean(datos || facturaPdf || extraPdf);
  const faltanPerfil = camposFaltantes(perfil);
  // El documento extra no entra aquí: es opcional.
  const listo = Boolean(datos && facturaPdf) && faltanPerfil.length === 0;

  const vistaPrevia = useCallback(async () => {
    if (!datos) return;
    setOcupado(true);
    try {
      const bytes = await buildFormPdf(datos, perfil);
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
  }, [datos, perfil]);

  const generar = useCallback(async () => {
    if (!datos || !facturaPdf) return;
    setOcupado(true);
    setError("");
    setExito("");
    try {
      const formato = await buildFormPdf(datos, perfil);
      const ensamblado = await unirPdfs(
        formato,
        facturaPdf.buffer,
        extraPdf?.buffer
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
      setExito(`Se descargó ${nombreBase}.zip`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar el paquete.");
    } finally {
      setOcupado(false);
    }
  }, [datos, facturaPdf, extraPdf, nombreBase, xmlTexto, perfil]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Recuperación de facturas</h1>
        <p>
          Llena el formato de reembolso de gastos médicos con los datos del CFDI
          y arma un solo PDF con el formato, la factura y —si hace falta— un
          documento extra. Todo en tu navegador: nada se sube a ningún servidor.
        </p>
      </header>

      <PanelPerfil
        perfil={perfil}
        onChange={actualizarPerfil}
        abierto={perfilAbierto}
        onToggle={setPerfilAbierto}
        faltantes={faltanPerfil}
      />

      <div className="layout">
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">1 · Archivos</h2>
            {hayAlgo && (
              <button className="btn btn--sm" onClick={reiniciar} disabled={ocupado}>
                <FiTrash2 /> Limpiar
              </button>
            )}
          </div>
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
              Arrastra aquí el <strong>XML</strong> y la{" "}
              <strong>factura PDF</strong>. Si lo necesitas, agrega también un{" "}
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
              opcional
              onClear={() => setExtraPdf(null)}
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
          {exito ? (
            <div className="exito">
              <p className="msg msg--exito">
                <FiCheckCircle /> {exito}
              </p>
              <button className="btn btn--primary" onClick={reiniciar}>
                <FiRotateCcw /> Procesar otra factura
              </button>
            </div>
          ) : (
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
          )}
          {!exito && datos && faltanPerfil.length > 0 && (
            <p className="msg msg--error">
              <FiAlertTriangle /> Completa los datos del titular para generar el
              ZIP.
            </p>
          )}
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

// --- Perfil del titular: datos fijos por persona, guardados en localStorage ---
function PanelPerfil({
  perfil,
  onChange,
  abierto,
  onToggle,
  faltantes,
}: {
  perfil: PerfilTitular;
  onChange: (p: PerfilTitular) => void;
  abierto: boolean;
  onToggle: (v: boolean) => void;
  faltantes: string[];
}) {
  const [errorFirma, setErrorFirma] = useState("");

  const set = <K extends keyof PerfilTitular>(k: K, v: PerfilTitular[K]) =>
    onChange({ ...perfil, [k]: v });
  const setTitular = (campo: keyof PersonaNombre, v: string) =>
    onChange({ ...perfil, titular: { ...perfil.titular, [campo]: v } });

  const subirFirma = async (file: File) => {
    setErrorFirma("");
    try {
      set("firma", await archivoAFirma(file));
    } catch (e) {
      setErrorFirma(
        e instanceof Error ? e.message : "No se pudo procesar la firma."
      );
    }
  };

  const nombre = nombreCompletoTitular(perfil);

  return (
    <section className="panel panel--perfil">
      <div className="panel-head">
        <h2 className="panel-title">
          <FiUser /> Datos del titular y depósito{" "}
          <span className="panel-sub">
            {nombre ? `· ${nombre}` : "· sin configurar"}
          </span>
        </h2>
        <button className="btn btn--sm" onClick={() => onToggle(!abierto)}>
          {abierto ? "Ocultar" : "Editar"}
        </button>
      </div>

      {!abierto && faltantes.length > 0 && (
        <p className="msg msg--error">
          <FiAlertTriangle /> Faltan: {faltantes.join(", ")}.
        </p>
      )}

      {abierto && (
        <>
          <p className="panel-nota">
            Se guardan solo en este navegador y se reutilizan en cada factura.
          </p>
          <div className="form-grid">
            <fieldset>
              <legend>Titular</legend>
              <Campo
                label="Apellido paterno"
                value={perfil.titular.apellidoPaterno}
                onChange={(v) => setTitular("apellidoPaterno", v)}
              />
              <Campo
                label="Apellido materno"
                value={perfil.titular.apellidoMaterno}
                onChange={(v) => setTitular("apellidoMaterno", v)}
              />
              <Campo
                label="Nombre"
                value={perfil.titular.nombre}
                onChange={(v) => setTitular("nombre", v)}
              />
              <Campo
                label="Número de empleado"
                value={perfil.numeroEmpleado}
                onChange={(v) => set("numeroEmpleado", v)}
              />
            </fieldset>

            <fieldset>
              <legend>Depósito</legend>
              <Campo
                label="CLABE"
                value={perfil.clabe}
                placeholder="18 dígitos"
                onChange={(v) => set("clabe", v)}
              />
              <Campo
                label="Banco"
                value={perfil.banco}
                placeholder="BBVA"
                onChange={(v) => set("banco", v)}
              />
              <Campo
                label="Lugar (para el pie del formato)"
                value={perfil.lugar}
                placeholder="Zapopan Jalisco"
                onChange={(v) => set("lugar", v)}
              />

              <div className="campo">
                <span>Firma escaneada (opcional)</span>
                <div className="firma-row">
                  {perfil.firma ? (
                    <img className="firma-preview" src={perfil.firma} alt="Firma" />
                  ) : (
                    <span className="firma-vacia">
                      Sin firma: el PDF deja una línea para firmar a mano.
                    </span>
                  )}
                  <div className="firma-acciones">
                    <label className="btn btn--sm">
                      <FiUploadCloud /> Subir imagen
                      <input
                        type="file"
                        accept="image/png,image/jpeg"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) subirFirma(f);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    {perfil.firma && (
                      <button
                        className="btn btn--sm"
                        onClick={() => set("firma", "")}
                      >
                        <FiTrash2 /> Quitar
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {errorFirma && (
                <p className="msg msg--error">
                  <FiAlertTriangle /> {errorFirma}
                </p>
              )}
            </fieldset>
          </div>
        </>
      )}
    </section>
  );
}

// --- Slot de archivo individual ---
function FileSlot({
  label,
  accept,
  nombre,
  onFile,
  opcional,
  onClear,
}: {
  label: string;
  accept: string;
  nombre: string;
  onFile: (f: File) => void;
  opcional?: boolean;
  onClear?: () => void;
}) {
  return (
    <label className={`slot ${nombre ? "slot--full" : ""}`}>
      <span className="slot-label">
        {label}
        {opcional && <span className="slot-opcional">opcional</span>}
      </span>
      {/* La etiqueta "opcional" ya comunica que puede quedarse vacío. */}
      <span className="slot-name">{nombre || "Sin archivo"}</span>
      {nombre && onClear && (
        // Va dentro del <label>, así que hay que frenar la activación del input.
        <button
          type="button"
          className="slot-clear"
          title="Quitar este archivo"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClear();
          }}
        >
          <FiX />
        </button>
      )}
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
          placeholder="D/Mes/AAAA"
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
