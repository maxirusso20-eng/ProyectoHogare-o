// ════════════════════════════════════════════════════════════════
//  LOGÍSTICA HOGAREÑO — app.js (Sintaxis y Separación de Hojas Corregida)
// ════════════════════════════════════════════════════════════════

// ─── STATE ───────────────────────────────────────────────────────
const S = {
  config: null,
  pagina: 'recorridos',
  seccionActual: 'recorridos', // Forzado por requerimiento de Entrada Directa
  hojaDespacho: 'DESPACHO_WHATSAPP',
  hojaClientes: 'DESPACHO_WHATSAPP',
  hojaRecorridos: 'HOJA DE RECORRIDO',

  choferes: [],
  enviados: new Set(),
  telMap: {},

  clientes: [],
  clientesFiltrados: [],

  colectas: [],
  colectasFiltradas: [],

  choferesBD: [],
  choferesBDFull: [],
  dbChoferes: [],
  dbChoferesFiltrados: [],

  editando: null,
  editandoCol: null,
  editandoDB: null,
  recorridos: null,

  dbAutenticado: false,
  filtroDB: 'titulares',
  despachoDirty: false,
  initialLoadFinished: false,
};

// Bloqueo inmediato de scroll al cargar el script
document.body.style.overflow = 'hidden';

// ─── SPLASH CONTROL ──────────────────────────────────────────────
async function hideSplashScreen() {
  const splash = document.getElementById('splash-screen');
  if (!splash) return;

  document.body.style.overflow = 'hidden';

  // Iniciar sincronización AUTOMÁTICA en paralelo sin bloquear
  Store.syncEverything();

  setTimeout(() => {
    // CRÍTICO: Redirigir a la sección actual (soporte hash)
    window.irA(S.pagina, false);

    // Iniciar desvanecimiento
    splash.classList.add('fade-out');

    // Limpieza final tras la transición
    setTimeout(() => {
      splash.remove();
      document.body.style.overflow = '';
    }, 800);
  }, 2000); // 2 segundos exactos
}

// ─── PASSWORD HELPERS ────────────────────────────────────────────
async function hashPass(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function checkAdminPass(pass) {
  const stored = Storage.get('col_admin_hash');
  if (!stored) return false;
  return (await hashPass(pass)) === stored;
}
async function initAdminHash() {
  Storage.set('col_admin_hash', await hashPass('Logistica2026'));
}

// ─── HELPERS ─────────────────────────────────────────────────────
function escHTML(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const x = escHTML;
const enc = encodeURIComponent;

function fmtTel(t) {
  return String(t).replace(/(\d{2})(\d{4})(\d{4})/, '$1 $2-$3');
}

function buildWA(chofer) {
  if (!chofer.telefono) return null;
  const lineas = chofer.clientes.map(k => {
    const horario = k.horario && k.horario !== '—' ? ` ${k.horario}` : '';
    const dir = k.dir && k.dir !== '—' ? `\n${k.dir}` : '';
    return `*${k.nombre}*${horario}${dir}`;
  }).join('\n\n');

  const isSabado = S.hojaDespacho.toUpperCase().includes('SABADO');
  const greeting = isSabado ? 'Buenas tardes, cómo andás? Espero que muy bien!' : 'Buenos días, cómo andás? Espero que muy bien!';
  const body = isSabado
    ? 'Te dejo la colecta del día de mañana! Por favor recordá ser puntual para salir temprano en recorrido. Te lo agradezco mucho!\n'
    : 'Te dejo la colecta del día! Por favor recordá ser puntual para salir temprano en recorrido. Te lo agradezco mucho!\n';

  const msg = [greeting, body, lineas].join('\n');
  return `https://wa.me/549${chofer.telefono.replace(/\D/g, '')}?text=${enc(msg)}`;
}

function clasificarZona(nombre, override) {
  if (override) return override;
  if (!nombre) return null;
  const n = nombre.toUpperCase();
  const zonas = {
    'ZONA OESTE': ['SAN MIGUEL', '3 DE FEBRERO', 'MORON', 'TESEI', 'RAMOS', 'LUZURIAGA', 'SAN JUSTO', 'HAEDO', 'MATANZA', 'FERRERE', 'MERLO', 'MARCOS PAZ', 'PADUA', 'MORENO', 'LUJAN', 'ITUZAINGO', 'FEBRERO', 'OESTE'],
    'ZONA SUR': ['GLEW', 'LONGCHAMPS', 'GUERNICA', 'SAN VICENTE', 'LA PLATA', 'BERAZATEGUI', 'QUILMES', 'LOMAS', 'AVELLANEDA', 'LANUS', 'VARELA', 'BROWN', 'EZEIZA', 'CAÑUELAS', 'ESTEBAN ECHEVERRIA', '9 DE ABRIL', 'SUR'],
    'ZONA NORTE': ['CARDALES', 'ZARATE', 'CAMPANA', 'ESCOBAR', 'LOMA VERDE', 'MASCHWITZ', 'DIQUE', 'NORDELTA', 'TIGRE', 'SAN ISIDRO', 'VTE LOPEZ', 'SAN FERNANDO', 'MUNRO', 'BOULOGNE', 'TORCUATO', 'DEL VISO', 'VILLA ROSA', 'PILAR', 'JOSE C PAZ', 'DERQUI', 'MALVINAS', 'SAN MARTIN', 'NORTE'],
    'CABA': ['AV SAN MARTIN', '25 DE MAYO', 'ABAJO', 'ARRIBA', 'JUAN B JUSTO', 'LUGANO', 'BOYACA', 'LA BOCA', 'BARRACAS', 'PUERTO MADERO', 'RETIRO', 'VERSALLES', 'SAAVEDRA', 'TURNO 2', 'COMODIN', 'CABA'],
  };
  for (const [zona, palabras] of Object.entries(zonas)) {
    if (palabras.some(p => n.includes(p))) return zona;
  }
  return null;
}

// ─── STORAGE ─────────────────────────────────────────────────────
const Storage = {
  get: (key, fallback = null) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
  set: (key, value) => { try { localStorage.setItem(key, value); } catch { } },
  getJSON: (key, fallback = null) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  setJSON: (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { } },
  remove: (key) => { try { localStorage.removeItem(key); } catch { } },

  loadConfig() {
    const env = window.APP_CONFIG || {};
    return {
      sheetId: Storage.get('col_sid') || env.sheetId || '',
      apiKey: Storage.get('col_key') || env.apiKey || '',
      appsUrl: Storage.get('col_url') || env.appsUrl || '',
      sheetIdRec: Storage.get('col_sid_rec') || env.sheetIdRec || Storage.get('col_sid') || '',
    };
  },
  saveConfig(c) { Storage.set('col_sid', c.sheetId); Storage.set('col_key', c.apiKey); Storage.set('col_url', c.appsUrl); Storage.set('col_sid_rec', c.sheetIdRec); },

  loadEnviados(hoja) { return new Set(Storage.getJSON(`col_enviados_${hoja}`, [])); },
  saveEnviados(hoja, set) { Storage.setJSON(`col_enviados_${hoja}`, [...set]); },

  loadRecOverrides(hoja) { return Storage.getJSON(`col_rec_ovr_${hoja}`, {}); },
  saveRecOverride(hoja, rowId, field, value) {
    const ovr = Storage.loadRecOverrides(hoja);
    if (!ovr[rowId]) ovr[rowId] = {};
    ovr[rowId][field] = value;
    Storage.setJSON(`col_rec_ovr_${hoja}`, ovr);
  },

  loadOverridesClientes(hoja) { return Storage.getJSON(`col_cli_ovr_${hoja}`, {}); },
  saveOverrideCliente(hoja, rowIndex, data) {
    const overrides = Storage.loadOverridesClientes(hoja);
    overrides[rowIndex] = data;
    Storage.setJSON(`col_cli_ovr_${hoja}`, overrides);
  },

  loadOverridesColectas() { return Storage.getJSON('col_col_overrides', {}); },
  saveOverrideColecta(rowIndex, data) {
    const overrides = Storage.loadOverridesColectas();
    overrides[rowIndex] = data;
    Storage.setJSON('col_col_overrides', overrides);
  },
  clearColectas() { Storage.remove('col_col_overrides'); },

  loadLocalNuevosChoferes() { return Storage.getJSON('col_local_db_choferes', []); },
  saveLocalNuevoChofer(chofer) {
    const lista = Storage.loadLocalNuevosChoferes();
    lista.push(chofer);
    Storage.setJSON('col_local_db_choferes', lista);
  },
  loadLocalNuevosClientes(hoja) { return Storage.getJSON(`col_local_clientes_${hoja}`, []); },
  saveLocalNuevoCliente(hoja, cliente) {
    const lista = Storage.loadLocalNuevosClientes(hoja);
    lista.push(cliente);
    Storage.setJSON(`col_local_clientes_${hoja}`, lista);
  },

  loadHistorial() { return Storage.getJSON('col_historial_colectas', []); },
  saveToHistorial(records) {
    const hist = Storage.loadHistorial();
    const updated = [...records, ...hist].slice(0, 500);
    Storage.setJSON('col_historial_colectas', updated);
  },
  clearHistorial() { Storage.remove('col_historial_colectas'); },

  loadHistorialRec() { return Storage.getJSON('col_historial_recorridos', []); },
  saveToHistorialRec(records) {
    const hist = Storage.loadHistorialRec();
    const updated = [...records, ...hist].slice(0, 5000);
    Storage.setJSON('col_historial_recorridos', updated);
  },
  clearHistorialRec() { Storage.remove('col_historial_recorridos'); },

  resetAll() {
    ['col_sid', 'col_key', 'col_url', 'col_sid_rec', 'col_hoja', 'col_hoja_rec', 'col_theme', 'col_col_overrides', 'col_historial_colectas', 'col_local_db_choferes', 'col_local_clientes', 'col_page']
      .forEach(k => Storage.remove(k));
    Object.keys(localStorage).filter(k => k.startsWith('col_enviados_') || k.startsWith('col_cli_ovr_')).forEach(k => Storage.remove(k));
  },

  loadTheme() { return Storage.get('col_theme', 'dark'); },
  saveTheme(t) { Storage.set('col_theme', t); },
  loadHojaDespacho() { return Storage.get('col_hoja', 'DESPACHO_WHATSAPP'); },
  saveHojaDespacho(h) { Storage.set('col_hoja', h); },
  loadHojaRec() { return Storage.get('col_hoja_rec', 'HOJA DE RECORRIDO'); },
  saveHojaRec(h) { Storage.set('col_hoja_rec', h); },
  loadPage() { return Storage.get('col_page', 'despacho'); },
  savePage(p) { Storage.set('col_page', p); },
  loadHojaCli() { return Storage.get('col_hoja_cli', 'DESPACHO_WHATSAPP'); },
  saveHojaCli(h) { Storage.set('col_hoja_cli', h); },

  // ── Persistencia del tab activo en Base de Datos ──
  loadFiltroDB() { return Storage.get('col_filtro_db', 'titulares'); },
  saveFiltroDB(f) { Storage.set('col_filtro_db', f); },

  // ── Modo Offline (desconectado de Google Sheets) ──
  isOfflineMode() { return Storage.get('col_offline_mode') === 'true'; },
  setOfflineMode(v) { Storage.set('col_offline_mode', v ? 'true' : 'false'); },
};

// ─── API ─────────────────────────────────────────────────────────
const LocalDB = {
  init() {
    if (!localStorage.getItem('dbLogistica')) {
      localStorage.setItem('dbLogistica', JSON.stringify({ conductores: [], clientes_SEMANA: [], clientes_SABADO: [] }));
    }
    const localDocs = localStorage.getItem('dbChoferes');
    if (localDocs) S.dbChoferes = JSON.parse(localDocs);
  },
  getDB() { return JSON.parse(localStorage.getItem('dbLogistica')); },
  saveDB(data) { localStorage.setItem('dbLogistica', JSON.stringify(data)); },

  saveChoferes(lista) {
    localStorage.setItem('dbChoferes', JSON.stringify(lista));
    const db = this.getDB();
    db.conductores = lista;
    this.saveDB(db);
  },

  exportar() {
    const d = localStorage.getItem('dbLogistica');
    if (!d) return Render.toast('No hay datos para exportar', 'err');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([d], { type: 'application/json' }));
    a.download = `Backup_Logistica_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    Render.toast('💾 Backup descargado', 'ok');
  }
};
LocalDB.init();
window.dbLogistica = LocalDB;

// ─── MIGRATOR (Descarga Única) ───────────────────────────────────
const Migrator = {
  async run() {
    const apiKey = S.config?.apiKey;
    const sheetId = S.config?.sheetId;
    const sheetIdRec = S.config?.sheetIdRec || sheetId;

    if (!apiKey || !sheetId) return Render.toast('Configurá primero la conexión a Google Sheets (panel Admin).', 'err');
    Render.cargando(true);
    try {
      Render.toast('📥 Iniciando migración final...', 'ok');

      const [rowsCho, rowsSem, rowsSab, rowsCli, rowsRec, rowsRecSab] = await Promise.all([
        API.fetchSheet(sheetIdRec, 'BASE DE DATOS CHOFERES', apiKey),
        API.fetchSheet(sheetIdRec, 'DESPACHO_WHATSAPP!A1:Z', apiKey).catch(() => []),
        API.fetchSheet(sheetIdRec, 'DESPACHO_WHATSAPP_SABADOS!A1:Z', apiKey).catch(() => []),
        API.fetchSheet(sheetIdRec, 'CLIENTES!A1:G', apiKey).catch(() => []),
        API.fetchSheet(sheetId, 'HOJA DE RECORRIDO', apiKey).catch(() => []),
        API.fetchSheet(sheetId, 'HOJA DE RECORRIDOS SABADOS', apiKey).catch(() => [])
      ]);

      const db = {
        conductores: API.parseDBChoferes(rowsCho),
        clientes_SEMANA: API.parseClientes(rowsSem, {}),
        clientes_SABADO: API.parseClientes(rowsSab, {}),
        base_clientes: rowsCli,
        recorridos_SEMANA: rowsRec,
        recorridos_SABADO: rowsRecSab
      };

      LocalDB.saveDB(db);
      LocalDB.saveChoferes(db.conductores);

      Storage.set('migration_done', 'true');
      Render.toast('✅ Migración completa. Reiniciando...', 'ok');
      setTimeout(() => location.reload(), 2000);
    } catch (err) {
      Render.toast('Error en migración: ' + err.message, 'err');
    } finally { Render.cargando(false); }
  }
};
window.Migrator = Migrator;

const API = {
  ping(url) {
    return new Promise(resolve => {
      const img = new Image();
      const done = () => resolve({ ok: true });
      img.onload = img.onerror = done;
      img.src = `${url}&_=${Date.now()}`;
      setTimeout(() => resolve({ ok: false, reason: 'timeout' }), 4000);
    });
  },

  async fetchSheet(sheetId, sheetName, apiKey) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${enc(sheetName)}?key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Sheets API ${res.status}`);
    return (await res.json()).values || [];
  },

  async saveChofer(c, cfg) {
    if (!cfg?.appsUrl) throw new Error("Apps Script URL no configurada");
    const body = {
      action: 'addChofer',
      docid: cfg.sheetIdRec || cfg.sheetId,
      nombre: c.nombre,
      id: c.id,
      tel: c.tel,
      dni: c.dni,
      zona: c.zona,
      direccion: c.direccion,
      condicion: c.condicion
    };
    const res = await fetch(cfg.appsUrl, {
      method: 'POST',
      mode: 'no-cors',
      cache: 'no-cache',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { ok: true };
  },

  parseDBChoferes(rows) {
    if (!rows || rows.length < 2) return [];

    const memoria = JSON.parse(localStorage.getItem('hogareno_memoria_db')) || {};

    return rows.slice(1).map((r, i) => {
      const rowId = i + 1;
      const idStr = r[0]?.toString().trim() || '';
      const numId = parseInt(idStr.replace(/\D/g, ''), 10) || 0;
      const nombre = r[1]?.toString().trim() || '';

      let chofer = {
        id: rowId,
        choferIdAt: idStr,
        nombre: nombre,
        tel: r[2]?.toString().trim() || '',
        dni: r[3]?.toString().trim() || '',
        zona: r[4]?.toString().trim() || '',
        direccion: r[5]?.toString().trim() || '',
        ingreso: r[6]?.toString().trim() || '—',
        condicion: r[7]?.toString().trim().toUpperCase() || '',
        vehiculo: r[8]?.toString().trim().toUpperCase() || 'AUTO',
        activo: true
      };

      // OVERRIDE ABSOLUTO CON LA BÓVEDA LOCAL
      const nombreKey = nombre.toLowerCase();
      const guardado = memoria[idStr] || memoria[nombreKey];

      if (guardado) {
        chofer.condicion = guardado.condicion;
        chofer.vehiculo = guardado.vehiculo || chofer.vehiculo;
        if (guardado.choferIdAt) chofer.choferIdAt = guardado.choferIdAt;
      } else {
        // Regla automática solo si no hay memoria previa
        if (!chofer.condicion || chofer.condicion === 'TITULAR') {
          if (numId >= 1000) chofer.condicion = 'COLECTADOR';
          else if (numId >= 200) chofer.condicion = 'SUPLENTE';
          else chofer.condicion = 'TITULAR';
        }
      }

      return chofer;
    }).filter(c => c.nombre);
  },

  getIndices(rows) {
    if (!rows || !rows.length) return { cli: 0, cho: 1, hor: 3, dir: 4 };
    const h = rows[0].map(v => v?.toString().trim().toUpperCase());
    const idx = { cli: 0, cho: 1, hor: 3, dir: 4 };
    const ci = h.indexOf('CLIENTE');
    if (ci !== -1) idx.cli = ci; else { const cii = h.indexOf('CLIENTES'); if (cii !== -1) idx.cli = cii; }
    const ch = h.findIndex(v => v.includes('CHOFER') || v.includes('CONDUCTOR'));
    if (ch !== -1) idx.cho = ch;
    const hr = h.findIndex(v => v.includes('HORA'));
    if (hr !== -1) idx.hor = hr;
    const di = h.findIndex(v => v.includes('DIRECCION') || v.includes('DIRECCIÓN'));
    if (di !== -1) idx.dir = di;
    return idx;
  },

  reagrupar(clientes, telMap, enviadosSet) {
    const mapa = {};
    clientes.forEach(c => {
      const cho = c.chofer;
      if (!cho || cho === '-' || cho === 'Lo traen') return;
      if (!mapa[cho]) {
        mapa[cho] = { nombre: cho, telefono: telMap[cho] || null, clientes: [], rowIndex: c.rowIndex, enviado: enviadosSet.has(cho) };
      }
      mapa[cho].clientes.push({ nombre: c.nombre, horario: c.horario || '—', dir: c.direccion || '' });
    });
    return Object.values(mapa).sort((a, b) => a.nombre.localeCompare(b.nombre));
  },

  parseChoferesBD(rows) {
    const full = [];
    for (let i = 1; i < rows.length; i++) {
      const id = rows[i][0]?.toString().trim() || '';
      const nombre = rows[i][1]?.toString().trim();
      if (nombre) full.push({ choferIdAt: id, nombre: nombre });
    }
    return {
      full,
      nombres: [...new Set(full.map(c => c.nombre))].sort((a, b) => a.localeCompare(b)),
      telMap: Object.fromEntries(rows.slice(1).map(r => [r[1]?.toString().trim(), r[2]?.toString().trim()]).filter(([n]) => n)),
    };
  },

  parseClientes(rows, telMap) {
    if (!rows.length) return [];
    const idx = this.getIndices(rows);
    const clientes = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const nombre = r[idx.cli]?.toString().trim();
      if (!nombre || nombre === 'CLIENTE') continue;
      const chofer = r[idx.cho]?.toString().trim() || '';
      clientes.push({
        rowIndex: i + 1, nombre, chofer, tel: telMap[chofer] || '',
        horario: r[idx.hor]?.toString().trim() || '', direccion: r[idx.dir]?.toString().trim() || '',
      });
    }
    return clientes;
  },

  parseColectas(rows, telMap) {
    if (!rows.length) return [];
    const idx = this.getIndices(rows);
    const colectas = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const nombre = r[idx.cli]?.toString().trim();
      if (!nombre || nombre === 'CLIENTE') continue;
      const chofer = r[idx.cho]?.toString().trim() || '';
      const horarioProg = r[idx.hor]?.toString().trim() || '';
      colectas.push({ rowIndex: i + 1, nombre, chofer, tel: telMap[chofer] || '', colecta: false, horario: '', horarioProg });
    }
    return colectas;
  },

  parseRecorridos(rows, overrides = {}) {
    const zonasMap = {};
    let currentZona = 'GENERAL';
    for (let i = 1; i < rows.length; i++) {
      const r = [...rows[i]];
      const ovr = overrides[i + 1];
      if (ovr) {
        if (ovr.localidad !== undefined) r[1] = ovr.localidad;
        if (ovr.idChofer !== undefined) r[2] = ovr.idChofer;
        if (ovr.nombreChofer !== undefined) r[3] = ovr.nombreChofer;
        if (ovr.zona_manual !== undefined) r[6] = ovr.zona_manual;
        if (ovr.paquetes !== undefined) r.paquetes = ovr.paquetes;
        if (ovr.paquetesFuera !== undefined) r.paquetesFuera = ovr.paquetesFuera;
        if (ovr.entregados !== undefined) r.entregados = ovr.entregados;
      }
      const colB = r[1]?.toString().trim() || '';
      const colC = r[2]?.toString().trim() || '';
      const colD = r[3]?.toString().trim() || '';
      const colE = r[4]?.toString().toUpperCase() === 'TRUE';
      const colF = r[5]?.toString().toUpperCase() === 'TRUE';
      const colG = r[6]?.toString().trim() || '';

      if (!colB && !colC && !colD) continue;
      const bUpper = colB.toUpperCase();
      if ((bUpper.includes('ZONA') || bUpper.includes('CABA')) && !colD) { currentZona = colB; continue; }

      const zonaAuto = clasificarZona(colB, colG);
      const zonaFinal = colG || ((zonaAuto && (currentZona === 'GENERAL' || currentZona === 'OTRA ZONA')) ? zonaAuto : currentZona);

      if (!zonasMap[zonaFinal]) zonasMap[zonaFinal] = { id: i, nombre: zonaFinal, filas: [] };
      zonasMap[zonaFinal].filas.push({
        id: i + 1, localidad: colB, idChofer: colC, nombreChofer: colD,
        colecta: colE, colectan: colF,
        paquetes: r.paquetes || '', paquetesFuera: r.paquetesFuera || '', entregados: r.entregados || ''
      });
    }
    return Object.values(zonasMap);
  },

  // (fin de API)
};

// ─── STORE ───────────────────────────────────────────────────────
const Store = {
  isLocal() { return Storage.get('migration_done') === 'true' || Storage.isOfflineMode(); },

  async cargarDespacho() {
    await this.cargarClientes();
    S.choferes = API.reagrupar(S.clientes, S.telMap, S.enviados);
    return S.choferes;
  },

  async cargarChoferesBDSiNecesario() {
    if (S.choferesBDFull.length > 0) return;
    const db = LocalDB.getDB();
    if (db && db.conductores) {
      const full = db.conductores.map(c => ({ choferIdAt: c.choferIdAt, nombre: c.nombre }));
      S.choferesBDFull = full;
      S.choferesBD = full.map(c => c.nombre);
      S.telMap = Object.fromEntries(db.conductores.map(c => [c.nombre, c.tel]));
    }
  },

  async cargarClientes() {
    if (this.isLocal()) {
      const db = LocalDB.getDB();
      const hoja = S.hojaClientes.includes('SABADO') ? 'clientes_SABADO' : 'clientes_SEMANA';
      S.clientes = db[hoja] || [];
      await this.cargarChoferesBDSiNecesario();
    } else {
      const id = S.config?.sheetIdRec || S.config?.sheetId;
      if (!id || !S.config?.apiKey) {
        console.warn("Configuración incompleta de Google Sheets.");
        return [];
      }
      const [rowsCli, rowsBD] = await Promise.all([
        API.fetchSheet(id, `${S.hojaClientes}!A1:Z`, S.config.apiKey),
        API.fetchSheet(id, 'BASE DE DATOS CHOFERES', S.config.apiKey).catch(() => []),
      ]);
      const bd = API.parseChoferesBD(rowsBD);
      S.telMap = bd.telMap;
      S.clientes = API.parseClientes(rowsCli, S.telMap);
    }

    S.clientes = [...S.clientes, ...Storage.loadLocalNuevosClientes(S.hojaClientes)];
    const overrides = Storage.loadOverridesClientes(S.hojaClientes);
    S.clientes.forEach(c => { if (overrides[c.rowIndex]) Object.assign(c, overrides[c.rowIndex]); });
    S.clientesFiltrados = [...S.clientes];
    return S.clientes;
  },

  async cargarColectas() {
    if (this.isLocal()) {
      const db = LocalDB.getDB();
      S.colectas = API.parseColectas(db.base_clientes || [], S.telMap);
    } else {
      const id = S.config?.sheetIdRec || S.config?.sheetId;
      if (!id || !S.config?.apiKey) return [];
      const rows = await API.fetchSheet(id, 'CLIENTES', S.config.apiKey);
      S.colectas = API.parseColectas(rows, S.telMap);
    }
    const overrides = Storage.loadOverridesColectas();
    S.colectas.forEach(c => { if (overrides[c.rowIndex]) Object.assign(c, overrides[c.rowIndex]); });
    S.colectasFiltradas = [...S.colectas];
    return S.colectas;
  },

  async cargarRecorridos() {
    let rows = [];
    if (this.isLocal()) {
      const db = LocalDB.getDB();
      rows = S.hojaRecorridos.includes('SABADO') ? db.recorridos_SABADO : db.recorridos_SEMANA;
    } else {
      if (!S.config?.sheetId || !S.config?.apiKey) return [];
      rows = await API.fetchSheet(S.config.sheetId, S.hojaRecorridos, S.config.apiKey);
    }
    const overrides = Storage.loadRecOverrides(S.hojaRecorridos);
    return API.parseRecorridos(rows || [], overrides);
  },

  async cargarDB() {
    let locales = [];
    if (typeof LocalDB !== 'undefined' && LocalDB.getDB) {
      locales = LocalDB.getDB().conductores || [];
    } else {
      const crudo = localStorage.getItem('dbChoferes');
      if (crudo) locales = JSON.parse(crudo);
    }
    S.dbChoferes = locales;

    const memoria = JSON.parse(localStorage.getItem('hogareno_memoria_db')) || {};
    S.dbChoferes.forEach(c => {
      const nombreKey = (c.nombre || '').toLowerCase();
      const guardado = memoria[c.choferIdAt] || memoria[nombreKey];

      // Restaurar choferIdAt desde la bóveda si fue editado manualmente
      if (guardado && guardado.choferIdAt) {
        c.choferIdAt = guardado.choferIdAt;
      }

      // ── REGLA ÚNICA DE IDs (Fuente de Verdad) ──
      // La condición se determina SIEMPRE por el rango del ID y se persiste en memoria.
      // Esto garantiza que F5, sync y migraciones nunca reviertan la clasificación.
      const numId = parseInt(String(c.choferIdAt).replace(/\D/g, ''), 10) || 0;
      if (numId >= 1000) c.condicion = 'COLECTADOR';
      else if (numId >= 200) c.condicion = 'SUPLENTE';
      else c.condicion = 'TITULAR';

      // Actualizar bóveda con la condición correcta para que sobreviva migraciones
      const keyId = c.choferIdAt;
      const keyNom = c.nombre.toLowerCase();
      const backupData = { condicion: c.condicion, vehiculo: c.vehiculo || 'AUTO', choferIdAt: c.choferIdAt };
      memoria[keyId] = backupData;
      memoria[keyNom] = backupData;
    });
    localStorage.setItem('hogareno_memoria_db', JSON.stringify(memoria));

    S.dbChoferesBDFull = [...S.dbChoferes];
    S.dbChoferesFiltrados = [...S.dbChoferes];
    return S.dbChoferes;
  },

  async syncEverything() {
    Render.syncIndicator(true);
    const syncText = document.getElementById('sync-text');
    if (syncText) syncText.textContent = "Actualizando base de datos...";

    const isFresh = S.choferesBDFull.length === 0;

    if (isFresh) {
      if (S.pagina === 'despacho') Render.skeletonDespacho();
      if (S.pagina === 'clientes') Render.skeletonTabla('tbody-clientes');
      if (S.pagina === 'recorridos') Render.skeletonRecorridos();
    }

    try {
      await Promise.all([
        this.cargarDB(),
        this.cargarDespacho()
      ]);

      if (S.pagina === 'despacho') { Render.despacho(S.choferes); Render.stats(); }
      if (S.pagina === 'clientes') Render.clientes(S.clientes);
      if (S.pagina === 'db-choferes') {
        // FIX CRÍTICO: Forzar filtrado al cargar para respetar el tab activo (F5 Bug)
        Handlers.filtrarDB();
      }
      if (S.pagina === 'recorridos') {
        const zonas = await this.cargarRecorridos();
        Render.recorridos(zonas);
      }

      Render.setStatus('ok');
    } catch (e) {
      console.warn("Auto-sync falló:", e);
      Render.setStatus('error');
      Render.toast("Sincronización fallida. Usando datos locales.", "info");
    } finally {
      Render.syncIndicator(false);
      S.initialLoadFinished = true;
    }
  }
};

// ─── RENDER ──────────────────────────────────────────────────────
const Render = {
  historialRecorridos(lista) {
    const tb = document.getElementById('tbody-historial-recorridos');
    if (!tb) return;
    if (!lista || lista.length === 0) { tb.innerHTML = '<tr><td colspan="7" class="empty-state">No hay registros guardados.</td></tr>'; return; }
    tb.innerHTML = lista.map(c => `<tr><td>${x(c.fecha)}</td><td>${x(c.zona)}</td><td>${x(c.localidad)}</td><td>${x(c.chofer)}</td><td style="text-align:center">${x(c.paquetes)}</td><td style="text-align:center">${x(c.paquetesFuera)}</td><td style="text-align:center; font-weight:700; color:var(--accent);">${x(c.entregados)}</td><td style="text-align:center; font-weight:700;">${x(c.porcentaje)}</td></tr>`).join('');
  },

  rankings(lista) {
    const tb = document.getElementById('tbody-rankings');
    if (!tb) return;
    if (!lista || lista.length === 0) {
      tb.innerHTML = '<tr><td colspan="5" class="empty-state">No hay datos suficientes este mes.</td></tr>';
      return;
    }
    tb.innerHTML = lista.map((c, i) => {
      let medalla = i + 1;
      if (i === 0) medalla = '🥇';
      if (i === 1) medalla = '🥈';
      if (i === 2) medalla = '🥉';
      const color = c.pct >= 90 ? '#10b981' : c.pct >= 70 ? '#f59e0b' : '#ef4444';
      return `<tr>
        <td style="text-align:center; font-size:1.2rem;">${medalla}</td>
        <td style="font-weight:700; font-family:'Plus Jakarta Sans',sans-serif;">${x(c.chofer)}</td>
        <td style="text-align:center; color:var(--text-muted);">${c.asignados}</td>
        <td style="text-align:center; font-weight:600;">${c.entregados}</td>
        <td style="text-align:center; font-weight:800; color:${color}; font-size:1.1rem;">${c.pct}%</td>
      </tr>`;
    }).join('');
  },

  skeletonDespacho() {
    const grid = document.getElementById('choferes-grid');
    if (!grid) return;
    grid.innerHTML = Array(6).fill(0).map(() => `<div class="chofer-card skeleton skeleton-card"></div>`).join('');
    const empty = document.getElementById('empty-despacho'); if (empty) empty.style.display = 'none';
  },

  skeletonTabla(tbodyId, rows = 5, cols = 5) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = Array(rows).fill(0).map(() => `<tr>${Array(cols).fill(0).map(() => `<td><div class="skeleton skeleton-text"></div></td>`).join('')}</tr>`).join('');
  },

  skeletonRecorridos() {
    const cont = document.getElementById('recorridos-container');
    if (!cont) return;
    cont.innerHTML = Array(3).fill(0).map(() => `
      <div class="zona-block">
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton skeleton-card" style="height:150px"></div>
      </div>`).join('');
  },

  despacho(lista) {
    const grid = document.getElementById('choferes-grid');
    const empty = document.getElementById('empty-despacho');
    if (!grid) return;

    if (!lista.length) {
      grid.innerHTML = '';
      if (empty) empty.style.display = 'block';
      return;
    }
    if (empty) empty.style.display = 'none';

    const fragment = document.createDocumentFragment();

    lista.forEach((c, index) => {
      const card = document.createElement('div');
      card.className = `chofer-card${c.enviado ? ' enviado' : ''}`;
      card.style.animationDelay = `${(index % 15) * 0.05}s`;
      card.dataset.nombre = c.nombre;

      const waHref = buildWA(c);
      const totalClientes = c.clientes.length;

      card.innerHTML = `
        <div class="card-header">
          <div class="card-header-info">
            <div class="chofer-name" style="font-family:'Plus Jakarta Sans', sans-serif; font-weight:700; font-size:1.1rem; letter-spacing:-0.01em;">${x(c.nombre)}</div>
            <div class="chofer-meta">
              <span class="meta-chip">📦 ${totalClientes} Clientes</span>
            </div>
          </div>
          <span class="badge-enviado">ENVIADO</span>
        </div>
        <div class="clientes-list">
          ${c.clientes.map((k, i) => `
            <div class="cliente-row">
              <span class="cliente-num">${i + 1}</span>
              <div class="cliente-body">
                <div class="cliente-top">
                  <span class="cliente-nombre">${x(k.nombre)}</span>
                  ${k.horario ? `<span class="cliente-horario">${x(k.horario)}</span>` : ''}
                </div>
                ${k.dir && k.dir !== '—' ? `<div class="cliente-dir">${x(k.dir)}</div>` : ''}
              </div>
            </div>`).join('')}
        </div>
        <div class="card-footer">
          ${waHref ? `<a class="btn-wa" href="${waHref}" target="_blank" data-action="marcar-enviado" data-nombre="${x(c.nombre)}">🚀 ENVIAR POR WHATSAPP</a>` : `<button class="btn-wa btn-wa-disabled" disabled>⚠ Sin teléfono</button>`}
          <button class="btn-toggle${c.enviado ? ' btn-toggle-sent' : ''}" data-action="toggle-enviado" data-nombre="${x(c.nombre)}">${c.enviado ? '✓ Enviado' : 'Marcar'}</button>
        </div>`;
      fragment.appendChild(card);
    });

    grid.innerHTML = '';
    grid.appendChild(fragment);
  },

  despachoSabado(lista) {
    this.despacho(lista);
  },

  errorModal(titulo, mensaje) {
    const modal = document.getElementById('modal-error-integrity');
    if (!modal) {
      console.error("Critical: modal-error-integrity not found in DOM");
      Render.toast(mensaje, 'err');
      return;
    }
    const tEl = document.getElementById('error-int-title');
    const mEl = document.getElementById('error-int-msg');
    if (tEl) tEl.textContent = titulo;
    if (mEl) mEl.innerHTML = mensaje;

    modal.style.setProperty('display', 'flex', 'important');

    // FIX ANTI-GLITCH: Animamos solo la tarjeta, no el fondo oscuro completo
    const card = modal.querySelector('.modal-card');
    if (card) {
      card.animate([{ opacity: 0, transform: 'scale(0.95)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 200, easing: 'ease-out' });
    }
  },

  stats() {
    const total = document.getElementById('stat-total');
    const enviados = document.getElementById('stat-enviados');
    const clientes = document.getElementById('stat-clientes');
    const pendientes = document.getElementById('stat-pendientes');
    if (!total || !enviados || !clientes || !pendientes) return;

    const env = S.choferes.filter(c => c.enviado).length;
    total.textContent = S.choferes.length;
    enviados.textContent = env;
    clientes.textContent = S.choferes.reduce((s, c) => s + c.clientes.length, 0);
    pendientes.textContent = S.choferes.length - env;
  },

  clientes(lista) {
    const tbody = document.getElementById('tbody-clientes');
    tbody.innerHTML = '';
    if (!lista.length) { tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No hay clientes.</td></tr>`; return; }
    lista.forEach(c => {
      const tr = document.createElement('tr'); tr.id = `row-${c.rowIndex}`;
      tr.innerHTML = Render._clienteRow(c); tbody.appendChild(tr);
    });
  },
  _clienteRow(c) {
    return `<td class="td-cliente">${x(c.nombre)}</td><td class="td-chofer">${x(c.chofer) || '—'}</td><td class="td-horario" id="tel-row-${c.rowIndex}">${c.tel ? fmtTel(c.tel) : '—'}</td><td class="td-horario">${x(c.horario) || '—'}</td><td class="td-dir">${x(c.direccion) || '—'}</td><td class="td-acciones"><button class="btn-edit" data-action="editar-cliente" data-row="${c.rowIndex}">✏ Editar</button></td>`;
  },
  _clienteEditRow(c) {
    // Usar la lista completa de conductores (titulares + suplentes), ordenados por nombre
    const conductores = [...S.dbChoferesBDFull]
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    const opts = conductores.map(ch => `<option value="${x(ch.nombre)}"${ch.nombre === c.chofer ? ' selected' : ''}>${x(ch.nombre)}</option>`).join('');
    return `<td class="td-cliente" style="font-weight:500">${x(c.nombre)}</td><td><select class="select-inline" id="ec-${c.rowIndex}" data-action="actualizar-tel-inline" data-row="${c.rowIndex}"><option value="">— sin asignar —</option>${opts}</select></td><td id="tel-edit-${c.rowIndex}">${c.tel ? fmtTel(c.tel) : '—'}</td><td><input class="inp-inline" id="eh-${c.rowIndex}" value="${x(c.horario)}" placeholder="HH:MM"></td><td><input class="inp-inline" id="ed-${c.rowIndex}" value="${x(c.direccion)}" placeholder="Calle 123"></td><td class="td-acciones"><button class="btn-save" data-action="guardar-cliente" data-row="${c.rowIndex}">✓ Guardar</button><button class="btn-cancel" data-action="cancelar-cliente" data-row="${c.rowIndex}">✕</button><button class="btn-icon" data-action="eliminar-cliente" data-row="${c.rowIndex}" style="margin-left:8px;opacity:0.6" title="Borrar fila">🗑️</button></td>`;
  },

  colectas(lista) {
    const tbody = document.getElementById('tbody-colectas');
    tbody.innerHTML = '';
    if (!lista.length) { tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No hay registros en Colectas.</td></tr>`; return; }
    lista.forEach(c => {
      const tr = document.createElement('tr'); tr.id = `col-row-${c.rowIndex}`;
      tr.innerHTML = Render._colectaRow(c); tbody.appendChild(tr);
    });
  },
  _colectaRow(c) {
    let waLink = '';
    if (c.tel && c.chofer) {
      const msg = `Buenas *${c.chofer}*! Quería consultarte en cuanto llegas? Disculpame las molestias!`;
      const url = `https://wa.me/549${c.tel.replace(/\D/g, '')}?text=${enc(msg)}`;
      waLink = ` <a href="${url}" target="_blank" style="text-decoration:none; margin-left:10px; vertical-align:middle; transition: transform 0.2s; display:inline-block;" onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'" title="Avisar a ${x(c.chofer)}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="#25D366"><path d="M12.031 0C5.385 0 0 5.384 0 12.031c0 2.126.55 4.195 1.597 6.01L.031 24l6.094-1.598a12.022 12.022 0 005.906 1.545h.005c6.643 0 12.027-5.385 12.027-12.031S18.675 0 12.031 0zm0 21.968h-.004a10.01 10.01 0 01-5.1-1.38l-.366-.217-3.793.995 1.013-3.697-.238-.379a9.998 9.998 0 01-1.536-5.322c0-5.514 4.49-10.003 10.005-10.003 2.67 0 5.183 1.04 7.07 2.928 1.888 1.887 2.929 4.399 2.929 7.07 0 5.513-4.49 10.005-10.005 10.005z"/><path d="M17.535 14.127c-.302-.151-1.789-.882-2.065-.983-.275-.101-.476-.151-.677.151-.201.302-.779.983-.954 1.184-.176.202-.352.227-.654.076-.302-.151-1.275-.47-2.428-1.5-1.012-.904-1.694-2.019-1.894-2.321-.201-.302-.021-.466.13-.617.135-.135.302-.352.452-.529.151-.176.202-.301.302-.503.101-.202.05-.378-.025-.529-.076-.151-.677-1.632-.927-2.235-.243-.585-.49-.505-.677-.514-.176-.009-.377-.009-.578-.009s-.527.075-.803.377c-.276.302-1.054 1.031-1.054 2.516s1.079 2.919 1.23 3.121c.15.202 2.13 3.253 5.161 4.561.721.31 1.283.496 1.723.635.723.23 1.382.197 1.9.119.58-.088 1.789-.731 2.04-1.437.251-.706.251-1.311.176-1.437-.076-.126-.277-.202-.579-.353z"/></svg>
      </a>`;
    }
    return `<td class="td-cliente">${x(c.nombre)}</td><td class="td-chofer">${x(c.chofer) || '—'}</td><td class="td-horario" style="white-space:nowrap;">${c.tel ? fmtTel(c.tel) + waLink : '<span style="color:var(--text-muted)">—</span>'}</td><td style="text-align:center"><input type="checkbox" class="rec-check" ${c.colecta ? 'checked' : ''} data-action="marcar-llegada" data-row="${c.rowIndex}"></td><td class="td-horario" id="hora-col-${c.rowIndex}">${c.horario ? `<span style="color:var(--accent);font-weight:700;">${c.horario}</span>` : ''}</td><td class="td-acciones"><button class="btn-edit" data-action="editar-colecta" data-row="${c.rowIndex}">✏</button></td>`;
  },
  _colectaEditRow(c) {
    return `<td class="td-cliente">${x(c.nombre)}</td><td class="td-chofer">${x(c.chofer) || '—'}</td><td class="td-horario">${c.tel ? fmtTel(c.tel) : '<span style="color:var(--text-muted)">—</span>'}</td><td style="text-align:center"><input type="checkbox" disabled ${c.colecta ? 'checked' : ''}></td><td><input class="inp-inline" id="ec-horario-${c.rowIndex}" value="${x(c.horario)}" placeholder="HH:MM"></td><td class="td-acciones"><button class="btn-save" data-action="guardar-colecta" data-row="${c.rowIndex}">✓</button><button class="btn-cancel" data-action="cancelar-colecta" data-row="${c.rowIndex}">✕</button></td>`;
  },

  recorridos(zonas) {
    const cont = document.getElementById('recorridos-container');
    cont.innerHTML = '';
    if (!zonas.length) { cont.innerHTML = '<div class="empty-state">No hay recorridos en esta hoja.</div>'; return; }
    zonas.forEach(z => cont.appendChild(Render._zonaBlock(z)));
    initDragDrop(cont);
  },
  actualizarPorcentaje(rowId) {
    const paq = parseInt(document.querySelector(`input[data-row="${rowId}"][data-field="paquetes"]`)?.value) || 0;
    const ext = parseInt(document.querySelector(`input[data-row="${rowId}"][data-field="paquetesFuera"]`)?.value) || 0;
    const ent = parseInt(document.querySelector(`input[data-row="${rowId}"][data-field="entregados"]`)?.value) || 0;
    const pctEl = document.getElementById(`pct-${rowId}`);
    if (!pctEl) return;
    const total = paq + ext;
    if (total === 0) { pctEl.textContent = '-'; pctEl.style.color = 'var(--text-muted)'; return; }
    const pct = Math.round((ent / total) * 100);
    pctEl.textContent = `${pct}%`;
    pctEl.style.color = pct >= 90 ? '#10b981' : pct >= 70 ? '#f59e0b' : '#ef4444';
  },

  _zonaBlock(z) {
    const div = document.createElement('div'); div.className = 'zona-block'; div.dataset.zonaid = z.id;
    div.innerHTML = `<div class="zona-title-row"><input class="zona-name-input" value="${x(z.nombre)}" readonly><button class="btn-del-zona" data-action="eliminar-zona" data-nombre="${x(z.nombre)}" data-ids="${x(JSON.stringify(z.filas.map(f => f.id)))}">🗑️ Borrar zona</button></div><table class="rec-table"><thead><tr><th></th><th>LOCALIDAD</th><th>ID</th><th>CHOFER</th><th>PAQUETE</th><th>POR FUERA</th><th>ENTREGADOS</th><th>% DEL DÍA</th><th></th></tr></thead><tbody class="zona-tbody" data-zona="${x(z.nombre)}">${(z.filas || []).map(f => Render._recorridoFila(f, z.nombre)).join('')}</tbody></table>`;
    return div;
  },
  _recorridoFila(f, zonaNombre) {
    const trashIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`;

    // Evaluar estado inicial para el color rojo (con conversión explícita)
    const clsPaq = (Number(f.paquetes || 0) > 40) ? ' over-limit' : '';
    const clsExt = (Number(f.paquetesFuera || 0) > 40) ? ' over-limit' : '';

    const pN = Number(f.paquetes) || 0; const eN = Number(f.paquetesFuera) || 0; const enN = Number(f.entregados) || 0;
    const tN = pN + eN; const pVal = tN > 0 ? Math.round((enN / tN) * 100) : null;
    const pTxt = pVal !== null ? pVal + '%' : '-'; const pCol = pVal >= 90 ? '#10b981' : pVal >= 70 ? '#f59e0b' : pVal !== null ? '#ef4444' : 'var(--text-muted)';

    return `<tr data-rowid="${f.id}" draggable="true" id="rec-tr-${f.id}">
      <td><span class="drag-handle" title="Arrastrar">⠿</span></td>
      <td><input class="rec-inp" value="${x(f.localidad)}" placeholder="Localidad" data-action="guardar-rec-field" data-row="${f.id}" data-field="localidad"></td>
      <td><input class="rec-inp id-chofer" id="rec-id-${f.id}" value="${x(S.choferesBDFull.find(k => k.nombre === f.nombreChofer)?.choferIdAt || f.idChofer || '')}" placeholder="ID" data-action="id-select" data-row="${f.id}" style="text-align:center"></td>
      <td><span class="rec-nombre-display" id="rec-nom-${f.id}">${x(f.nombreChofer || '— Sin asignar —')}</span></td>
      
      <td><input type="number" class="rec-inp num-inp${clsPaq}" value="${x(f.paquetes)}" placeholder="0" data-action="guardar-rec-field" data-row="${f.id}" data-field="paquetes" oninput="this.classList.toggle('over-limit', this.value > 40); Render.actualizarPorcentaje('${f.id}')"></td>
      <td><input type="number" class="rec-inp num-inp${clsExt}" value="${x(f.paquetesFuera)}" placeholder="0" data-action="guardar-rec-field" data-row="${f.id}" data-field="paquetesFuera" oninput="this.classList.toggle('over-limit', this.value > 40); Render.actualizarPorcentaje('${f.id}')"></td>
      <td><input type="number" class="rec-inp num-inp" value="${x(f.entregados)}" placeholder="0" data-action="guardar-rec-field" data-row="${f.id}" data-field="entregados" style="color:var(--accent);" oninput="Render.actualizarPorcentaje('${f.id}')"></td>
      <td style="text-align:center; vertical-align:middle; font-weight:800; color:${pCol};" id="pct-${f.id}">${pTxt}</td>
      
      <td><button class="btn-del-rec" onclick="Handlers.quitarChoferDeRecorrido('${x(zonaNombre)}', '${f.id}')" title="Eliminar fila">${trashIcon}</button></td>
    </tr>`;
  },

  syncIndicator(show) {
    const el = document.getElementById('sync-indicator');
    if (el) el.style.display = show ? 'flex' : 'none';
  },

  database(lista) {
    const tbody = document.getElementById('tbody-db');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!lista.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty-state">
        <div style="padding:40px; text-align:center;">
          <div style="font-size:2rem; margin-bottom:10px;">📂</div>
          <div style="font-family:'Plus Jakarta Sans',sans-serif; font-weight:700; color:#fff;">No hay conductores registrados</div>
          <div style="font-size:0.8rem; color:var(--text-muted); margin-top:5px;">Iniciá la carga con el botón superior.</div>
        </div>
      </td></tr>`;
      return;
    }
    lista.forEach(c => tbody.appendChild(this._dbRow(c)));
  },
  _dbRow(c) {
    const tr = document.createElement('tr');
    tr.id = `db-row-${c.id}`;
    const condicion = String(c.condicion || 'TITULAR').toUpperCase(); // Respetar valor guardado

    let condBadge = '';
    if (condicion === 'COLECTADOR') condBadge = `<span style="background:#8b5cf622;color:#8b5cf6;border:1px solid #8b5cf655;border-radius:4px;padding:2px 6px;font-size:0.72rem;font-weight:700;letter-spacing:0.04em;">COLECTADOR</span>`;
    else if (condicion === 'SUPLENTE') condBadge = `<span style="background:#f59e0b22;color:#f59e0b;border:1px solid #f59e0b55;border-radius:4px;padding:2px 6px;font-size:0.72rem;font-weight:700;letter-spacing:0.04em;">SUPLENTE</span>`;
    else condBadge = `<span style="background:#10b98122;color:#10b981;border:1px solid #10b98155;border-radius:4px;padding:2px 6px;font-size:0.72rem;font-weight:700;letter-spacing:0.04em;">TITULAR</span>`;

    tr.innerHTML = `
      <td style="text-align: center; vertical-align: middle;">
        <input type="text" class="rec-inp" value="${x(c.choferIdAt)}" data-action="update-id-inline" data-id="${c.id}" style="width:75px; margin: 0 auto; display: block; text-align:center; font-weight:700; color:var(--accent); background:rgba(0,0,0,0.08); border-radius:4px; border:1px solid transparent;">
      </td>
      <td class="td-cliente">${x(c.nombre)}</td>
      <td class="td-horario">${x(c.tel)}</td>
      <td>${x(c.dni)}</td>
      <td>${x(c.zona)}</td>
      <td class="td-dir">${x(c.direccion)}</td>
      <td>${x(c.ingreso)}</td>
      <td style="text-align:center">${condBadge}</td>
      <td style="text-align:center; font-weight:600; font-size:0.75rem; color:var(--text-muted);">${x(c.vehiculo || 'AUTO')}</td>
      <td class="td-acciones">
        <button class="btn-edit" data-action="editar-db" data-id="${c.id}">✏</button>
        <button class="btn-del"  data-action="eliminar-db" data-id="${c.id}">🗑</button>
      </td>`;
    return tr;
  },

  _dbEditRow(c) {
    const tr = document.createElement('tr');
    tr.id = `db-edit-row-${c.id}`;
    tr.innerHTML = `
      <td><input class="inp-inline" id="db-in-idat-${c.id}" value="${x(c.choferIdAt)}" oninput="Handlers.autoCategorizarID(this, 'db-in-cond-${c.id}')"></td>
      <td><input class="inp-inline" id="db-in-nom-${c.id}" value="${x(c.nombre)}"></td>
      <td><input class="inp-inline" id="db-in-tel-${c.id}" value="${x(c.tel)}"></td>
      <td><input class="inp-inline" id="db-in-dni-${c.id}" value="${x(c.dni)}"></td>
      <td><input class="inp-inline" id="db-in-zon-${c.id}" value="${x(c.zona)}"></td>
      <td><input class="inp-inline" id="db-in-dir-${c.id}" value="${x(c.direccion)}"></td>
      <td><input class="inp-inline" id="db-in-ing-${c.id}" value="${x(c.ingreso)}"></td>
      <td style="text-align:center">
        <select class="select-inline" id="db-in-cond-${c.id}" style="font-size:0.7rem; padding:2px; text-align:center; text-align-last:center;">
          <option value="TITULAR"${c.condicion === 'TITULAR' ? ' selected' : ''}>TITULAR</option>
          <option value="SUPLENTE"${c.condicion === 'SUPLENTE' ? ' selected' : ''}>SUPLENTE</option>
          <option value="COLECTADOR"${c.condicion === 'COLECTADOR' ? ' selected' : ''}>COLECTADOR</option>
        </select>
      </td>
      <td style="text-align:center">
        <select class="select-inline" id="db-in-veh-${c.id}" style="font-size:0.7rem; padding:2px; text-align:center; text-align-last:center;">
          <option value="AUTO"${c.vehiculo === 'AUTO' ? ' selected' : ''}>AUTO</option>
          <option value="SUV"${c.vehiculo === 'SUV' ? ' selected' : ''}>SUV</option>
          <option value="UTILITARIO"${c.vehiculo === 'UTILITARIO' ? ' selected' : ''}>UTILITARIO</option>
        </select>
      </td>
      <td class="td-acciones">
        <button class="btn-save" data-action="guardar-db" data-id="${c.id}">✓</button>
        <button class="btn-cancel" data-action="cancelar-db" data-id="${c.id}">✕</button>
      </td>`;
    return tr;
  },

  historial(lista) {
    const tbody = document.getElementById('tbody-historial');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!lista.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No hay registros en el historial.</td></tr>'; return; }
    lista.forEach(h => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td style="font-size:0.75rem;color:var(--text-muted);text-align:center">${h.fecha}</td><td style="font-weight:600">${x(h.cliente)}</td><td style="font-size:0.75rem;color:var(--text-muted)">${x(h.direccion || '—')}</td><td>${x(h.chofer)}</td><td style="text-align:center;font-size:0.75rem">${h.celular || '—'}</td><td style="text-align:center;font-weight:700;color:var(--accent)">${h.horario}</td>`;
      tbody.appendChild(tr);
    });
  },

  cargando(show) {
    const el = document.getElementById('loading');
    if (el) el.style.display = show ? 'block' : 'none';
    if (show) {
      const pD = document.getElementById('page-despacho'); if (pD) pD.classList.remove('active');
      const pC = document.getElementById('page-clientes'); if (pC) pC.classList.remove('active');
    }
  },
  error(msg) {
    const el = document.getElementById('error-msg');
    if (el) { el.innerHTML = `<strong>❌ Error al conectar</strong><br><br>${msg}`; el.style.display = 'block'; }
    const ld = document.getElementById('loading'); if (ld) ld.style.display = 'none';
  },
  setStatus(s) {
    const el = document.getElementById('status-dot');
    if (el) el.className = `status-dot${s ? ' ' + s : ''}`;
  },
  toast(msg, tipo = 'ok') {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg; t.className = `show ${tipo}`;
    clearTimeout(t._t); t._t = setTimeout(() => { t.className = ''; }, 3200);
  },
};

// ─── HANDLERS ────────────────────────────────────────────────────
const Handlers = {
  buscarEnMapa() {
    const input = document.getElementById('map-input-search');
    if (!input || !input.value.trim()) return;

    // Obtener el valor y limpiarlo
    const direccion = input.value.trim();
    // Codificar para la URL (convierte espacios en %20, etc.)
    const query = encodeURIComponent(direccion);

    const iframe = document.getElementById('map-iframe');
    if (iframe) {
      // Actualizar el atributo src del iframe usando el endpoint oficial de Google Maps
      iframe.src = `https://maps.google.com/maps?q=${query}&t=&z=15&ie=UTF8&iwloc=&output=embed`;
      Render.toast('📍 Buscando dirección...', 'info');
    }
  },
  solicitarGuardarRecorrido() {
    Handlers.solicitarConfirmacion('Guardar Recorrido', '¿Archivar el recorrido actual en el historial?', async () => {
      Handlers.confirmarGuardarRecorrido();
    });
  },
  confirmarGuardarRecorrido() {
    // Aseguramos formato DD/MM/YYYY para compatibilidad con el Ranking
    const fechaFormat = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const records = [];

    // Leemos directo del DOM para asegurar capturar lo que el usuario ve
    document.querySelectorAll('.zona-tbody tr').forEach(tr => {
      const rowId = tr.dataset.rowid;
      if (!rowId) return;

      const zonaNombre = tr.closest('.zona-tbody')?.dataset.zona || '';
      const localidad = tr.querySelector(`input[data-field="localidad"]`)?.value || '';
      const choferNode = document.getElementById(`rec-nom-${rowId}`);
      const chofer = choferNode ? choferNode.textContent : '';

      const paq = tr.querySelector(`input[data-field="paquetes"]`)?.value || '';
      const ext = tr.querySelector(`input[data-field="paquetesFuera"]`)?.value || '';
      const ent = tr.querySelector(`input[data-field="entregados"]`)?.value || '';
      const pct = document.getElementById(`pct-${rowId}`)?.textContent || '-';

      // Validar: Tiene localidad, tiene chofer asignado y hay al menos un número cargado
      if (localidad && chofer && chofer !== '— Sin asignar —') {
        if (paq !== '' || ext !== '' || ent !== '') {
          records.push({ fecha: fechaFormat, zona: zonaNombre, localidad, chofer, paquetes: paq, paquetesFuera: ext, entregados: ent, porcentaje: pct });
        }
      }
    });

    if (records.length === 0) {
      Render.toast('⚠️ No hay números cargados para guardar', 'info');
      return;
    }

    Storage.saveToHistorialRec(records);

    // Limpiar pantalla y memoria (overrides)
    document.querySelectorAll('.zona-tbody tr').forEach(tr => {
      const rowId = tr.dataset.rowid;
      ['paquetes', 'paquetesFuera', 'entregados'].forEach(field => {
        const inp = tr.querySelector(`input[data-field="${field}"]`);
        if (inp) {
          inp.value = '0'; // Forzar el valor base a 0
          inp.classList.remove('over-limit'); // Limpiar el borde rojo si lo tuviera
        }
        Storage.saveRecOverride(S.hojaRecorridos, rowId, field, '0');
      });
      Render.actualizarPorcentaje(rowId);
    });

    Render.toast('💾 Recorrido guardado y reseteado', 'ok');
  },
  cargarHistorialRecorridos() {
    const data = Storage.loadHistorialRec();
    Render.historialRecorridos(data);
  },

  cargarRankings() {
    const historial = Storage.loadHistorialRec() || [];
    const now = new Date();
    // Obtener formato de mes y año (ej: "/03/" o "-03-")
    const mesActual = String(now.getMonth() + 1).padStart(2, '0');

    const statsPorChofer = {};

    historial.forEach(r => {
      const fechaStr = String(r.fecha || '');
      // Filtrar para que solo sume lo de este mes
      if (!fechaStr.includes(`/${mesActual}/`) && !fechaStr.includes(`-${mesActual}-`)) return;

      const chofer = r.chofer;
      if (!chofer || chofer === '— Sin asignar —') return;

      if (!statsPorChofer[chofer]) {
        statsPorChofer[chofer] = { chofer, asignados: 0, entregados: 0 };
      }

      const paq = parseInt(r.paquetes) || 0;
      const ext = parseInt(r.paquetesFuera) || 0;
      const ent = parseInt(r.entregados) || 0;

      statsPorChofer[chofer].asignados += (paq + ext);
      statsPorChofer[chofer].entregados += ent;
    });

    const ranking = Object.values(statsPorChofer).map(c => {
      c.pct = c.asignados > 0 ? Math.round((c.entregados / c.asignados) * 100) : 0;
      return c;
    });

    // Ordenar primero por %, luego por cantidad de entregados para desempatar
    ranking.sort((a, b) => b.pct - a.pct || b.entregados - a.entregados);

    Render.rankings(ranking);
  },

  cerrarMesPDF() {
    const tablaRankings = document.getElementById('tbody-rankings');
    if (!tablaRankings || tablaRankings.innerText.includes('No hay datos')) {
      return Render.toast('No hay datos suficientes para exportar', 'err');
    }

    const mesActual = new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }).toUpperCase();

    // 1. Generar Reporte Visual Limpio para PDF
    const vent = window.open('', '_blank');
    let html = `
      <html>
      <head>
        <title>Reporte Logística - ${mesActual}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 30px; color: #000; background: #fff; }
          .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #000; padding-bottom: 10px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px; }
          th, td { border: 1px solid #ccc; padding: 12px; text-align: left; }
          th { background: #f4f4f4; font-weight: bold; text-transform: uppercase; }
          td { color: #333; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>REPORTE DE EFECTIVIDAD MENSUAL</h2>
          <p>MES: <strong>${mesActual}</strong></p>
        </div>
        <table>
          <thead>
            <tr>
              <th>PUESTO</th><th>CHOFER</th><th>PAQ. ASIGNADOS</th><th>ENTREGADOS</th><th>% EFECTIVIDAD</th>
            </tr>
          </thead>
          <tbody>
            ${tablaRankings.innerHTML}
          </tbody>
        </table>
        <p style="margin-top: 30px; font-size: 12px; color: #666; text-align: center;">Generado por Logística Hogareño - ${new Date().toLocaleString('es-AR')}</p>
      </body>
      </html>
    `;

    vent.document.write(html);
    vent.document.close();

    // Esperar a que renderice y llamar al menú de impresión (Guardar como PDF)
    setTimeout(() => {
      vent.focus();
      vent.print();

      // 2. Después de imprimir, preguntar si dinamitamos los datos
      setTimeout(() => {
        Handlers.solicitarConfirmacion(
          '¿Ejecutar Cierre de Mes?',
          '¿Ya guardaste tu PDF? Si aceptas, se <strong>borrará todo el historial del mes y los números de la pantalla de Recorridos</strong> para empezar de cero.',
          () => {
            // Borramos el Historial profundo
            Storage.clearHistorialRec();

            // Borramos los números anclados en la pantalla de Recorridos (Semana y Sábado)
            Storage.remove('col_rec_ovr_HOJA DE RECORRIDO');
            Storage.remove('col_rec_ovr_HOJA DE RECORRIDOS SABADOS');

            // Recargamos la app para que aplique visualmente
            location.reload();
          }
        );
      }, 500); // Pequeño delay después de cerrar la ventana de impresión
    }, 250);
  },

  limpiarHistorialRec() {
    Handlers.abrirAdminModal(async (pass) => {
      if (await checkAdminPass(pass)) {
        Storage.clearHistorialRec();
        Render.historialRecorridos([]);
        Render.toast('🗑️ Historial vaciado', 'ok');
      } else { Render.toast('❌ Contraseña Incorrecta', 'err'); }
    });
  },

  async cargarDespacho() {
    Render.skeletonDespacho();
    try {
      await Store.cargarDespacho();
      Render.despacho(S.choferes); Render.stats(); Render.setStatus('ok');
    } catch (err) {
      Render.setStatus('error');
      Render.toast('Sincronización en curso...', 'info');
      console.error("Error cargarDespacho:", err);
    }
    finally { document.getElementById('page-despacho').classList.add('active'); }
  },

  toggleEnviado(nombre, forzar = false) {
    const c = S.choferes.find(k => k.nombre === nombre);
    if (!c) return;
    const nuevo = forzar ? true : !c.enviado;
    if (c.enviado === nuevo) return; // Evitar guardado innecesario si no hay cambio

    c.enviado = nuevo;
    nuevo ? S.enviados.add(nombre) : S.enviados.delete(nombre);
    Storage.saveEnviados(S.hojaDespacho, S.enviados);
    Render.despacho(S.choferes); Render.stats();
    Render.toast(nuevo ? '✓ Enviado' : '↺ Pendiente', 'ok');
  },

  marcarEnviado(nombre) { setTimeout(() => Handlers.toggleEnviado(nombre, true), 400); },

  toggleMarcarTodos() {
    const todosMarcados = S.choferes.every(c => c.enviado);
    const nuevoEstado = !todosMarcados;
    S.choferes.forEach(c => {
      c.enviado = nuevoEstado;
      nuevoEstado ? S.enviados.add(c.nombre) : S.enviados.delete(c.nombre);
    });
    Storage.saveEnviados(S.hojaDespacho, S.enviados);
    Render.despacho(S.choferes); Render.stats();
    Render.toast(nuevoEstado ? '✓ Todos enviados' : '↺ Todos pendientes', 'ok');
  },

  filtrarChoferes() {
    const q = document.getElementById('search-despacho').value.toLowerCase();
    Render.despacho(q ? S.choferes.filter(c => c.nombre.toLowerCase().includes(q)) : S.choferes);
  },

  async cargarClientes() {
    Render.skeletonTabla('tbody-clientes', 8, 6);
    try {
      await Store.cargarClientes();
      Render.clientes(S.clientesFiltrados);
      Render.setStatus('ok');
    } catch (err) {
      Render.toast('Sincronización en curso...', 'info');
      console.error("Error cargarClientes:", err);
    }
    finally { document.getElementById('page-clientes').classList.add('active'); }
  },

  editarCliente(rowIndex) {
    if (S.editando && S.editando !== rowIndex) Handlers.cancelarCliente(S.editando);
    S.editando = rowIndex;
    const c = S.clientes.find(k => k.rowIndex === rowIndex);
    const tr = document.getElementById(`row-${rowIndex}`);
    if (!c || !tr) return;
    tr.classList.add('editando'); tr.innerHTML = Render._clienteEditRow(c);
  },

  cancelarCliente(rowIndex) {
    const c = S.clientes.find(k => k.rowIndex === rowIndex);
    const tr = document.getElementById(`row-${rowIndex}`);
    if (!c || !tr) return;
    tr.classList.remove('editando'); tr.innerHTML = Render._clienteRow(c);
    if (S.editando === rowIndex) S.editando = null;
  },

  async guardarCliente(rowIndex) {
    const c = S.clientes.find(k => k.rowIndex === rowIndex);
    const tr = document.getElementById(`row-${rowIndex}`);
    if (!c || !tr) return;
    const nc = document.getElementById(`ec-${rowIndex}`)?.value.trim() || '';
    const nh = document.getElementById(`eh-${rowIndex}`)?.value.trim() || '';
    const nd = document.getElementById(`ed-${rowIndex}`)?.value.trim() || '';

    c.chofer = nc; c.horario = nh; c.direccion = nd;
    Storage.saveOverrideCliente(S.hojaClientes, rowIndex, { chofer: nc, horario: nh, direccion: nd });

    if (S.hojaClientes === S.hojaDespacho) {
      const enviadosDia = Storage.loadEnviados(S.hojaDespacho);
      S.choferes = API.reagrupar(S.clientes, S.telMap, enviadosDia);
    } else S.despachoDirty = true;

    tr.classList.remove('editando'); tr.innerHTML = Render._clienteRow(c); S.editando = null;
    Render.toast('✓ Cambio guardado localmente', 'ok');
  },

  async eliminarCliente(rowIndex) {
    const c = S.clientes.find(k => k.rowIndex === rowIndex);
    if (!c) return;
    Handlers.solicitarConfirmacion(
      '¿Eliminar Cliente?',
      `¿Borrar a <strong>${c.nombre}</strong> de la lista?`,
      () => {
        // 1. Remover de las listas en memoria
        S.clientes = S.clientes.filter(k => k.rowIndex !== rowIndex);
        S.clientesFiltrados = S.clientesFiltrados.filter(k => k.rowIndex !== rowIndex);

        // 2. Persistencia en dbLogistica si existe (Modo Local)
        const db = LocalDB.getDB();
        const hoja = S.hojaClientes.includes('SABADO') ? 'clientes_SABADO' : 'clientes_SEMANA';
        if (db && db[hoja]) {
          db[hoja] = db[hoja].filter(k => k.rowIndex !== rowIndex);
          LocalDB.saveDB(db);
        }

        // 3. Limpiar overrides específicos para esta fila
        const overrides = Storage.loadOverridesClientes(S.hojaClientes);
        if (overrides[rowIndex]) {
          delete overrides[rowIndex];
          Storage.setJSON(`col_cli_ovr_${S.hojaClientes}`, overrides);
        }
        // 4. Remover de la lista de clientes locales agregados manualmente
        const locales = Storage.loadLocalNuevosClientes(S.hojaClientes);
        const localesActualizados = locales.filter(k => k.rowIndex !== rowIndex);
        Storage.setJSON(`col_local_clientes_${S.hojaClientes}`, localesActualizados);

        S.despachoDirty = true;
        Render.clientes(S.clientesFiltrados);
        Render.toast('🗑️ Cliente eliminado definitivamente', 'ok');
      }
    );
  },

  actualizarTelInline(rowIndex, choferNombre) {
    const tel = S.telMap[choferNombre] || '';
    const td = document.getElementById(`tel-edit-${rowIndex}`);
    if (td) td.textContent = tel ? fmtTel(tel) : '—';
    const c = S.clientes.find(k => k.rowIndex === rowIndex);
    if (c) c.tel = tel;
  },

  filtrarClientes() {
    const q = document.getElementById('search-clientes').value.toLowerCase();
    S.clientesFiltrados = q ? S.clientes.filter(c => c.nombre.toLowerCase().includes(q) || c.chofer.toLowerCase().includes(q)) : [...S.clientes];
    Render.clientes(S.clientesFiltrados);
  },

  agregarCliente() {
    const m = document.getElementById('modal-nuevo-cliente');
    if (m) m.style.setProperty('display', 'flex', 'important');
    // Poblar dropdown de conductores (titulares + suplentes, ordenados)
    const sel = document.getElementById('ncli-cho');
    if (sel) {
      const conductores = [...S.dbChoferesBDFull].sort((a, b) => a.nombre.localeCompare(b.nombre));
      sel.innerHTML = '<option value="">— sin asignar —</option>' +
        conductores.map(c => `<option value="${x(c.nombre)}">${x(c.nombre)}</option>`).join('');
    }
    document.getElementById('ncli-nom').focus();
  },

  cerrarModalNuevoCliente() {
    const m = document.getElementById('modal-nuevo-cliente');
    if (m) m.style.removeProperty('display');
    ['ncli-nom', 'ncli-cho', 'ncli-hor', 'ncli-dir'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  },

  async confirmarNuevoCliente() {
    const nombre = document.getElementById('ncli-nom').value.trim();
    const horario = document.getElementById('ncli-hor').value.trim();
    const direccion = document.getElementById('ncli-dir').value.trim();
    const chofer = document.getElementById('ncli-cho')?.value.trim() || '';
    const tel = chofer ? (S.telMap[chofer] || '') : '';

    if (!nombre) { Render.toast('El nombre es obligatorio', 'err'); return; }

    const nuevo = { rowIndex: Date.now(), nombre, chofer, tel, horario, direccion };
    Storage.saveLocalNuevoCliente(S.hojaClientes, nuevo);
    S.clientes.push(nuevo);
    Handlers.filtrarClientes();

    Render.toast('✓ Cliente Guardado Localmente', 'ok');
    this.cerrarModalNuevoCliente();
  },

  async cargarColectas() {
    Render.skeletonTabla('tbody-colectas', 8, 7);
    try {
      await Store.cargarColectas();
      Render.colectas(S.colectasFiltradas);
    } catch (err) {
      Render.toast('Sincronización en curso...', 'info');
      console.error("Error cargarColectas:", err);
    }
  },

  async marcarLlegada(rowIndex, isChecked) {
    const c = S.colectas.find(k => k.rowIndex === rowIndex);
    if (!c) return;
    let timeStr = '';
    if (isChecked) {
      const now = new Date(); timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
    c.colecta = isChecked; c.horario = timeStr;
    Storage.saveOverrideColecta(rowIndex, { colecta: isChecked, horario: timeStr });
    const tdHora = document.getElementById(`hora-col-${rowIndex}`);
    if (tdHora) tdHora.innerHTML = timeStr ? `<span style="color:var(--accent);font-weight:700;">${timeStr}</span>` : '';
    Render.toast(isChecked ? '✓ Colecta Marcada' : '✓ Colecta Desmarcada', 'ok');
  },

  editarColecta(rowIndex) {
    if (S.editandoCol && S.editandoCol !== rowIndex) Handlers.cancelarColecta(S.editandoCol);
    S.editandoCol = rowIndex;
    const c = S.colectas.find(k => k.rowIndex === rowIndex);
    const tr = document.getElementById(`col-row-${rowIndex}`);
    if (tr) { tr.classList.add('editando'); tr.innerHTML = Render._colectaEditRow(c); }
  },

  cancelarColecta(rowIndex) {
    const c = S.colectas.find(k => k.rowIndex === rowIndex);
    const tr = document.getElementById(`col-row-${rowIndex}`);
    if (tr) { tr.classList.remove('editando'); tr.innerHTML = Render._colectaRow(c); S.editandoCol = null; }
  },

  async guardarColecta(rowIndex) {
    const c = S.colectas.find(k => k.rowIndex === rowIndex);
    const tr = document.getElementById(`col-row-${rowIndex}`);
    if (!c || !tr) return;
    c.horario = document.getElementById(`ec-horario-${rowIndex}`)?.value.trim() || '';
    Storage.saveOverrideColecta(rowIndex, { horario: c.horario });
    tr.classList.remove('editando'); tr.innerHTML = Render._colectaRow(c); S.editandoCol = null;
    Render.toast('✓ Horario guardado localmente', 'ok');
  },

  filtrarColectas() {
    const q = document.getElementById('search-colectas').value.toLowerCase();
    S.colectasFiltradas = q ? S.colectas.filter(c => c.nombre.toLowerCase().includes(q) || c.chofer.toLowerCase().includes(q)) : [...S.colectas];
    Render.colectas(S.colectasFiltradas);
  },

  solicitarLimpiarHoy() {
    Handlers.solicitarConfirmacion(
      '¿Limpiar Colectas?',
      'Se desmarcarán todas las colectas de hoy y se borrarán sus horarios de llegada.',
      () => Handlers.ejecutarLimpiarHoy()
    );
  },

  ejecutarLimpiarHoy() {
    Storage.clearColectas();
    Handlers.cargarColectas();
    Handlers.cerrarConfirm();
    Render.toast('✓ Colectas desmarcadas', 'ok');
  },

  solicitarConfirmacion(titulo, msg, onConfirm) {
    const modal = document.getElementById('modal-confirm');
    if (!modal) return;
    document.getElementById('confirm-title').innerText = titulo;
    document.getElementById('confirm-msg').innerHTML = msg;
    Handlers._onConfirmCallback = onConfirm;
    modal.style.setProperty('display', 'flex', 'important');
  },

  onConfirmAction() {
    if (typeof Handlers._onConfirmCallback === 'function') {
      Handlers._onConfirmCallback();
    }
    Handlers.cerrarConfirm();
    Handlers._onConfirmCallback = null;
  },

  cerrarConfirm() {
    const modal = document.getElementById('modal-confirm');
    if (modal) modal.style.removeProperty('display');
  },



  async renderRecorridos() {
    Render.skeletonRecorridos();
    try {
      await Store.cargarChoferesBDSiNecesario();
      const zonas = await Store.cargarRecorridos();
      Render.recorridos(zonas);
    } catch (err) {
      Render.toast('Sincronización en curso...', 'info');
      console.error("Error renderRecorridos:", err);
    }
    finally { document.getElementById('page-recorridos').classList.add('active'); }
  },

  async abrirModalLocalidad() {
    const modal = document.getElementById('modal-nueva-localidad');
    const inp = document.getElementById('nl-inp');
    if (!modal || !inp) return;
    inp.value = '';
    modal.style.setProperty('display', 'flex', 'important');
    setTimeout(() => inp.focus(), 100);
  },

  async confirmarNuevaLocalidad() {
    const inp = document.getElementById('nl-inp');
    const loc = inp?.value?.trim();
    if (!loc) {
      window.cerrarModalNuevaLocalidad();
      return;
    }

    if (!S.recorridos || S.recorridos.length === 0) {
      S.recorridos = await Store.cargarRecorridos();
    }

    let targetZona = S.recorridos.find(z => z.nombre?.toUpperCase().includes('OESTE')) || S.recorridos[0];
    if (!targetZona) {
      targetZona = { id: Date.now(), nombre: 'ZONA OESTE', filas: [] };
      S.recorridos.push(targetZona);
    }

    const newRowId = "LOCAL_" + Date.now();
    const nuevaFila = {
      id: newRowId,
      localidad: loc,
      idChofer: '',
      nombreChofer: '',
      colecta: false,
      colectan: false
    };

    targetZona.filas.push(nuevaFila);

    Render.recorridos(S.recorridos);
    window.cerrarModalNuevaLocalidad();

    Storage.saveRecOverride(S.hojaRecorridos, newRowId, 'localidad', loc);
    Storage.saveRecOverride(S.hojaRecorridos, newRowId, 'zona_manual', targetZona.nombre);

    setTimeout(() => {
      const rowEl = document.getElementById(`rec-tr-${newRowId}`);
      if (rowEl) {
        rowEl.classList.add('row-success-flash');
        rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);

    Render.toast(`✓ ${loc} agregada reactivamente a ${targetZona.nombre}`, 'ok');
  },

  guardarRecField(rowIndex, field, value) {
    Storage.saveRecOverride(S.hojaRecorridos, rowIndex, field, value);
    Render.toast('✓ Guardado local', 'ok');
  },

  onIdSelect(inp, rowId) {
    const idat = inp.value.trim().toUpperCase();
    if (!idat) {
      const nomDisplay = document.getElementById(`rec-nom-${rowId}`);
      if (nomDisplay) nomDisplay.textContent = "— Sin asignar —";
      Handlers.guardarRecField(rowId, 'nombreChofer', "");
      Handlers.guardarRecField(rowId, 'idChofer', "");
      return;
    }

    // --- NUEVA VALIDACIÓN EN TIEMPO REAL (DOM) ---
    let duplicado = false;
    let zonaDuplicada = '';
    let locDuplicada = '';

    document.querySelectorAll('.zona-tbody tr').forEach(tr => {
      const currentId = tr.dataset.rowid;
      if (currentId && currentId !== rowId) {
        // Leemos el valor actual del input directamente de la pantalla
        const inputId = tr.querySelector('.id-chofer')?.value.trim().toUpperCase();
        if (inputId === idat) {
          duplicado = true;
          zonaDuplicada = tr.closest('.zona-tbody')?.dataset.zona || 'Otra zona';
          locDuplicada = tr.querySelector('input[data-field="localidad"]')?.value || 'Localidad desconocida';
        }
      }
    });

    if (duplicado) {
      Render.errorModal('Doble Asignación', `El ID <strong>${idat}</strong> ya está asignado a la localidad de <strong>${locDuplicada}</strong> en <strong>${zonaDuplicada}</strong>.`);
      inp.value = ""; // Vaciamos el input rebelde para no dejarlo pasar
      return;
    }
    // ----------------------------------------------

    const found = S.choferesBDFull.find(c => c.choferIdAt && c.choferIdAt.toUpperCase() === idat);
    const nomDisplay = document.getElementById(`rec-nom-${rowId}`);
    if (nomDisplay) {
      nomDisplay.textContent = found ? found.nombre : "— ID no encontrado —";
      if (found) Handlers.guardarRecField(rowId, 'nombreChofer', found.nombre);
    }
    Handlers.guardarRecField(rowId, 'idChofer', idat);
  },

  async quitarChoferDeRecorrido(zonaNombre, rowId) {
    Handlers.solicitarConfirmacion(
      '¿Quitar Chofer?',
      '¿Borrar esta fila de la memoria del recorrido?',
      async () => {
        if (!S.recorridos) S.recorridos = await Store.cargarRecorridos();
        const zona = S.recorridos.find(z => z.nombre === zonaNombre);
        if (zona) zona.filas = zona.filas.filter(f => String(f.id) !== String(rowId));

        const ovr = Storage.loadRecOverrides(S.hojaRecorridos);
        if (ovr[rowId]) { delete ovr[rowId]; Storage.setJSON(`col_rec_ovr_${S.hojaRecorridos}`, ovr); }

        Render.recorridos(S.recorridos);
        Render.toast('🗑️ Fila eliminada', 'ok');
      }
    );
  },

  async eliminarZona(nombre, ids) {
    Handlers.solicitarConfirmacion(
      '¿Eliminar Zona?',
      `¿Borrar TODAS las localidades de <strong>${nombre}</strong>?`,
      async () => {
        if (!S.recorridos) S.recorridos = await Store.cargarRecorridos();
        S.recorridos = S.recorridos.filter(z => z.nombre !== nombre);
        Render.recorridos(S.recorridos);
        Render.toast(`🗑️ Zona ${nombre} eliminada`, 'ok');
      }
    );
  },

  async cargarDB() {
    try {
      await Store.cargarDB();
      Handlers.filtrarDB(); // Fix: Forzar filtro visual en lugar de Render directo
    } catch (err) {
      Render.toast(err.message, 'err');
    }
  },

  cambiarTabDB(tab) {
    S.filtroDB = tab;
    Storage.saveFiltroDB(tab); // ← Persiste el tab activo para sobrevivir F5
    document.querySelectorAll('#tab-group-db .tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    Handlers.filtrarDB();
  },

  filtrarDB() {
    const q = document.getElementById('search-db-choferes').value.toLowerCase();
    const tabActual = S.filtroDB || 'titulares';

    // --- FIX VISUAL ABSOLUTO: Sincronizar botones con el estado real ---
    document.querySelectorAll('#tab-group-db .tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabActual);
    });

    const filtrados = S.dbChoferes.filter(c => {
      const condReal = c.condicion;

      if (tabActual === 'titulares' && condReal !== 'TITULAR') return false;
      if (tabActual === 'suplentes' && condReal !== 'SUPLENTE') return false;
      if (tabActual === 'colectadores' && condReal !== 'COLECTADOR') return false;

      if (q && !c.nombre.toLowerCase().includes(q) && !(c.dni && String(c.dni).includes(q))) return false;
      return true;
    });

    filtrados.sort((a, b) => {
      const numA = parseInt(String(a.choferIdAt).replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(String(b.choferIdAt).replace(/\D/g, ''), 10) || 0;
      return numA - numB;
    });

    S.dbChoferesFiltrados = filtrados;
    Render.database(S.dbChoferesFiltrados);
  },

  actualizarIdInline(rowId, nuevoId) {
    const c = S.dbChoferes.find(k => k.id === rowId);
    if (!c) return;

    c.choferIdAt = nuevoId.trim().toUpperCase();
    const numIdValue = parseInt(String(c.choferIdAt).replace(/\D/g, ''), 10) || 0;

    // Auto-reclasificación al tipear
    if (numIdValue >= 1000) c.condicion = 'COLECTADOR';
    else if (numIdValue >= 200) c.condicion = 'SUPLENTE';
    else c.condicion = 'TITULAR';

    // GUARDADO EN BÓVEDA INDESTRUCTIBLE
    let memoria = JSON.parse(localStorage.getItem('hogareno_memoria_db')) || {};
    const backupData = { condicion: c.condicion, vehiculo: c.vehiculo, choferIdAt: c.choferIdAt };
    memoria[c.choferIdAt] = backupData;
    memoria[c.nombre.toLowerCase()] = backupData;
    localStorage.setItem('hogareno_memoria_db', JSON.stringify(memoria));

    if (typeof LocalDB !== 'undefined' && LocalDB.saveChoferes) LocalDB.saveChoferes(S.dbChoferes);

    Handlers.filtrarDB();
    Render.toast('✓ ID actualizado y anclado', 'ok');
  },

  abrirModalConductor() {
    Handlers.cerrarModalNuevoRegistro();
    const modal = document.getElementById('modal-nuevo-chofer');
    if (modal) modal.style.setProperty('display', 'flex', 'important');
  },

  // Alias definido directamente en el objeto para evitar dependencia del alias window
  cerrarModalNuevoRegistro() {
    if (typeof window.cerrarModalNuevoConductor === 'function') {
      window.cerrarModalNuevoConductor();
    }
  },

  // Alias para data-action="eliminar-rec-fila" (el botón usa onclick directo,
  // pero se mantiene por si algún elemento usa el atributo delegado)
  eliminarRecFila(rowId) {
    const tr = document.querySelector(`tr[data-rowid="${rowId}"]`);
    if (!tr) return;
    const zonaNombre = tr.closest('.zona-tbody')?.dataset.zona || '';
    Handlers.quitarChoferDeRecorrido(zonaNombre, rowId);
  },

  // Alias para data-action="chofer-select" (equivalente funcional a onIdSelect)
  onChoferSelect(el, rowId) {
    Handlers.onIdSelect(el, rowId);
  },

  editarRegistro(idInterno) {
    const c = S.dbChoferesBDFull.find(x => String(x.id) === String(idInterno));
    if (!c) return;
    S._editId = c.id; // Guardamos el ID interno para la edición

    // Actualizar título de modal
    const title = document.getElementById('modal-chofer-title');
    if (title) title.textContent = 'Editar Registro';

    // Poblar campos de texto
    const fill = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    fill('nc-idat', c.choferIdAt);
    fill('nc-nom', c.nombre);
    fill('nc-cel', c.tel);
    fill('nc-dni', c.dni);
    fill('nc-dir', c.direccion);

    const selVeh = document.getElementById('nc-veh');
    if (selVeh) selVeh.value = c.vehiculo || 'AUTO';

    // Poblar multi-select de zona
    const selZona = document.getElementById('nc-zon');
    if (selZona && c.zona) {
      const zonas = c.zona.split(/,\s*/);
      Array.from(selZona.options).forEach(opt => { opt.selected = zonas.includes(opt.value); });
    }

    const elIng = document.getElementById('nc-ing');
    if (elIng) {
      elIng.value = (c.ingreso && c.ingreso !== '—') ? c.ingreso : '';
    }

    // Mostrar modal con prioridad y título de edición
    const modal = document.getElementById('modal-nuevo-chofer');
    if (modal) {
      modal.style.setProperty('display', 'flex', 'important');
      const title = document.getElementById('modal-chofer-title');
      if (title) title.textContent = '✎ Editar Registro';
    }
  },

  agregarDB() {
    const modal = document.getElementById('modal-nuevo-chofer');
    if (modal) {
      modal.style.setProperty('display', 'flex', 'important');
      setTimeout(() => {
        const inputId = document.getElementById('nc-idat');
        if (inputId) inputId.focus();
      }, 100);
    } else {
      Render.toast('❌ Error: Modal no encontrado', 'err');
    }
  },

  abrirNuevoRegistro() {
    const modal = document.getElementById('modal-nuevo-chofer');
    if (modal) {
      modal.style.setProperty('display', 'flex', 'important');
      setTimeout(() => {
        const inputId = document.getElementById('nc-idat');
        if (inputId) inputId.focus();
      }, 100);
    } else {
      Render.toast('❌ Error: Modal no encontrado', 'err');
    }
  },

  confirmarNuevoChofer() {
    // Esta función delega a la función maestra global
    window.guardarRegistroGlobal();
  },

  _confirmarNuevoChofer_legacy() {
    const idat = document.getElementById('nc-idat')?.value.trim();
    const nom = document.getElementById('nc-nom')?.value.trim();
    const tel = document.getElementById('nc-cel')?.value.trim();
    if (!idat || !nom || !tel) { Render.toast('ID, Conductor y Celular son obligatorios', 'err'); return; }

    const idatUpper = String(idat).toUpperCase();
    const editIdStr = String(S._editId || '');
    const existe = S.dbChoferesBDFull.find(c => String(c.choferIdAt).toUpperCase() === idatUpper && String(c.id) !== editIdStr);

    if (existe) {
      Render.errorModal('ID Duplicado', `El ID ya está asignado a ${existe.nombre}.`);
      return;
    }

    try {
      // Formatear Fecha
      const rawDate = document.getElementById('nc-ing')?.value || '';
      let fechaFormateada = '—';
      if (rawDate) {
        const [y, m, d] = rawDate.split('-');
        fechaFormateada = `${d}/${m}/${y}`;
      }

      // Leer zona desde multi-select
      const selZona = document.getElementById('nc-zon');
      let zonaVal = '';
      if (selZona && selZona.multiple) {
        zonaVal = Array.from(selZona.selectedOptions).map(opt => opt.value).join(', ');
      } else if (selZona) {
        zonaVal = selZona.value.trim();
      }

      // Condición: regla de negocio automática + manual
      let condicionVal;
      const selCond = document.getElementById('nc-cond');
      if (selCond && selCond.value) {
        condicionVal = selCond.value;
      } else {
        condicionVal = parseInt(idatUpper, 10) >= 1000 ? 'COLECTADOR' : parseInt(idatUpper, 10) >= 200 ? 'SUPLENTE' : 'TITULAR';
      }

      const data = {
        choferIdAt: idatUpper,
        nombre: nom,
        tel: tel,
        dni: document.getElementById('nc-dni')?.value.trim() || '',
        zona: zonaVal || 'Sin Zona',
        direccion: document.getElementById('nc-dir')?.value.trim() || '',
        ingreso: fechaFormateada,
        condicion: condicionVal
      };

      if (S._editId) {
        const idx1 = S.dbChoferesBDFull.findIndex(x => String(x.id) === String(S._editId));
        if (idx1 !== -1) { Object.assign(S.dbChoferesBDFull[idx1], data); S.dbChoferesBDFull[idx1].choferIdAt = idatUpper; }

        const idx2 = S.dbChoferes.findIndex(x => String(x.id) === String(S._editId));
        if (idx2 !== -1) { Object.assign(S.dbChoferes[idx2], data); S.dbChoferes[idx2].choferIdAt = idatUpper; }
      } else {
        // LA LÍNEA MÁGICA QUE FALTABA PARA QUE APAREZCA EN LA LISTA
        const newId = Date.now();
        const nuevo = { ...data, id: newId, choferIdAt: idatUpper, activo: true };
        S.dbChoferesBDFull.unshift(nuevo);
        S.dbChoferes.unshift(nuevo);
      }

      LocalDB.saveChoferes(S.dbChoferesBDFull);
      Handlers.filtrarDB();

      Handlers.cerrarModalNuevoChofer();
      Render.toast(S._editId ? '✓ Cambios guardados' : '✓ Registro guardado', 'ok');

      if (S.config && S.config.appsUrl) {
        Render.syncIndicator(true);
        API.saveChofer({ ...data, id: idatUpper }, S.config).then(() => {
          Render.toast('✓ Sincronizado', 'ok');
        }).catch(e => console.error("Sync error:", e)).finally(() => Render.syncIndicator(false));
      }
      S._editId = null;
    } catch (err) { Render.toast('Error al guardar: ' + err.message, 'err'); }
  },

  cerrarModalNuevoChofer() {
    const m = document.getElementById('modal-nuevo-chofer');
    if (m) m.style.setProperty('display', 'none', 'important');

    // Limpia campos de texto
    ['nc-idat', 'nc-nom', 'nc-cel', 'nc-dni', 'nc-dir', 'nc-ing'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    // Limpia multi-select de zona (deseleccionar todas las opciones)
    const selZona = document.getElementById('nc-zon');
    if (selZona) Array.from(selZona.options).forEach(opt => opt.selected = false);

    // Resetear condición a TITULAR
    const selCond = document.getElementById('nc-cond');
    if (selCond) selCond.value = 'TITULAR';

    const title = document.getElementById('modal-chofer-title');
    if (title) title.textContent = '+ Nuevo Registro';
    S._editId = null;
  },

  borrarRegistro(rowId) {
    const c = S.dbChoferes.find(k => String(k.id) === String(rowId));
    if (!c) return;

    Handlers.solicitarConfirmacion(
      '¿Eliminar?',
      `¿Borrar definitivamente a <strong>${c.nombre}</strong>?`,
      () => {
        // Remover de la memoria activa
        S.dbChoferesBDFull = S.dbChoferesBDFull.filter(x => String(x.id) !== String(rowId));
        S.dbChoferes = S.dbChoferes.filter(x => String(x.id) !== String(rowId));

        // Persistencia completa (Actualiza dbChoferes y dbLogistica.conductores)
        LocalDB.saveChoferes(S.dbChoferesBDFull);

        Handlers.filtrarDB();
        Render.toast('🗑️ Registro eliminado con éxito', 'ok');
      }
    );
  },

  async cargarHistorial() { Render.historial(Storage.loadHistorial()); },

  mostrarConfirmarHistorial() {
    if (!S.colectas.filter(c => c.colecta).length) return Render.toast('⚠ No hay colectas marcadas hoy', 'info');
    const m = document.getElementById('modal-historial-confirm');
    if (m) m.style.setProperty('display', 'flex', 'important');
  },

  confirmarGuardarHistorial() {
    // Obtenemos solo las colectas que tienen el check marcado (true)
    const hoy = S.colectas.filter(c => c.colecta === true);

    if (!hoy.length) {
      const m = document.getElementById('modal-historial-confirm');
      if (m) m.style.setProperty('display', 'none', 'important');
      Render.toast('⚠ No hay colectas marcadas para guardar', 'info');
      return;
    }

    const fecha = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const records = hoy.map(c => {
      const searchName = (c.nombre || '').trim().toUpperCase();
      const cliData = S.clientes.find(cli => (cli.nombre || '').trim().toUpperCase() === searchName) || {};

      return {
        fecha,
        cliente: c.nombre,
        direccion: cliData.direccion || '—',
        chofer: c.chofer || '—',
        celular: c.tel || '—',
        horario: c.horario || '—'
      };
    });

    // Guardamos en LocalStorage
    Storage.saveToHistorial(records);

    // Limpiamos los checks de hoy (reset visual)
    Storage.clearColectas();
    Handlers.cargarColectas();

    // Cerramos modal y avisamos
    const m = document.getElementById('modal-historial-confirm');
    if (m) m.style.removeProperty('display');

    Render.toast(`✓ ${records.length} colectas guardadas en el Historial`, 'ok');
  },

  limpiarHistorial() {
    Handlers.abrirAdminModal(async (pass) => {
      if (!(await checkAdminPass(pass))) return Render.toast('⚠ Clave incorrecta', 'err');
      Handlers.solicitarConfirmacion(
        'Limpiar Historial',
        '¿ESTÁ SEGURO? Esta acción borrará permanentemente todo el historial local almacenado.',
        () => {
          Storage.clearHistorial();
          Handlers.cargarHistorial();
          Render.toast('✓ Historial eliminado', 'ok');
        }
      );
    });
  },

  abrirAdminModal(cb) {
    Handlers._adminCallback = cb;
    const modal = document.getElementById('modal-admin-pass');
    if (modal) modal.style.setProperty('display', 'flex', 'important');
    const inp = document.getElementById('inp-admin-pass');
    if (inp) { inp.value = ''; setTimeout(() => inp.focus(), 100); }
  },

  cerrarAdminModal() {
    const modal = document.getElementById('modal-admin-pass');
    if (modal) modal.style.setProperty('display', 'none', 'important');
    Handlers._adminCallback = null;
  },
  confirmarAdminModal() {
    const inp = document.getElementById('inp-admin-pass'); if (!inp) return;
    const pass = inp.value; const cb = Handlers._adminCallback;
    Handlers.cerrarAdminModal(); if (cb) cb(pass);
  },

  abrirModalLocalidad() {
    const inp = document.getElementById('nl-inp');
    if (inp) inp.value = '';
    const modal = document.getElementById('modal-nueva-localidad');
    if (modal) modal.style.setProperty('display', 'flex', 'important');
  },

  abrirModalCliente() {
    // 1. Limpiar campos de texto
    ['ncli-nom', 'ncli-hor', 'ncli-dir'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    // 2. Poblar dropdown de conductores con la base de datos actualizada
    const sel = document.getElementById('ncli-cho');
    if (sel) {
      const conductores = [...S.dbChoferesBDFull].sort((a, b) => a.nombre.localeCompare(b.nombre));
      sel.innerHTML = '<option value="">— sin asignar —</option>' +
        conductores.map(c => `<option value="${x(c.nombre)}">${x(c.nombre)}</option>`).join('');
    }

    // 3. Mostrar el modal y hacer foco en el primer input
    const modal = document.getElementById('modal-nuevo-cliente');
    if (modal) {
      modal.style.setProperty('display', 'flex', 'important');
      setTimeout(() => document.getElementById('ncli-nom')?.focus(), 100);
    }
  },

  guardarRegDB(id) {
    const c = S.dbChoferes.find(x => x.id === id);
    if (!c) return;
    const idat = document.getElementById(`db-in-idat-${id}`)?.value.trim().toUpperCase();
    const nom = document.getElementById(`db-in-nom-${id}`)?.value.trim();
    const tel = document.getElementById(`db-in-tel-${id}`)?.value.trim();
    const dni = document.getElementById(`db-in-dni-${id}`)?.value.trim();
    const zon = document.getElementById(`db-in-zon-${id}`)?.value.trim();
    const dir = document.getElementById(`db-in-dir-${id}`)?.value.trim();
    const ing = document.getElementById(`db-in-ing-${id}`)?.value.trim();
    const numIdValue = parseInt(String(idat).replace(/\D/g, ''), 10) || 0;

    let cond = 'TITULAR';
    if (numIdValue >= 1000) cond = 'COLECTADOR';
    else if (numIdValue >= 200) cond = 'SUPLENTE';
    const veh = document.getElementById(`db-in-veh-${id}`)?.value || 'AUTO';

    if (!idat || !nom || !tel) return Render.toast('ID, Nombre y Celular obligatorios', 'err');

    const data = { choferIdAt: idat, nombre: nom, tel, dni, zona: zon, direccion: dir, ingreso: ing, condicion: cond, vehiculo: veh };
    Object.assign(c, data);

    // GUARDADO EN BÓVEDA INDESTRUCTIBLE (por ID y por Nombre)
    let memoria = JSON.parse(localStorage.getItem('hogareno_memoria_db')) || {};
    const backupData = { condicion: cond, vehiculo: veh, choferIdAt: idat };
    memoria[idat] = backupData;
    memoria[nom.toLowerCase()] = backupData;
    localStorage.setItem('hogareno_memoria_db', JSON.stringify(memoria));

    if (typeof LocalDB !== 'undefined' && LocalDB.saveChoferes) LocalDB.saveChoferes(S.dbChoferes);

    Handlers.filtrarDB();
    Render.toast('✓ Cambios guardados y anclados', 'ok');
  },

  cancelarRegDB(id) {
    Handlers.filtrarDB();
  },

  toggleActivoDB(id, checked) {
    const c = S.dbChoferesBDFull.find(x => x.id === id);
    if (c) {
      c.activo = checked;
      LocalDB.saveChoferes(S.dbChoferesBDFull);
      Render.toast(checked ? '✓ Conductor Activo' : '⚪ Conductor Inactivo', 'info');
    }
  },

  autoCategorizarID(inp, selectId) {
    const v = parseInt(inp.value) || 0;
    const s = document.getElementById(selectId);
    if (s) {
      s.value = v >= 1000 ? 'COLECTADOR' : (v >= 200 ? 'SUPLENTE' : 'TITULAR');
    }
  },
};

// ─── DRAG & DROP ─────────────────────────────────────────────────
function initDragDrop(cont) {
  let dragSrcRow = null;
  let dragSrcTbody = null;

  function onDragStart(e) {
    dragSrcRow = this; dragSrcTbody = this.closest('.zona-tbody');
    this.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.rowid);
  }

  function onDragEnd() {
    this.classList.remove('dragging'); dragSrcRow = dragSrcTbody = null;
    document.querySelectorAll('.zona-tbody.drag-over').forEach(tb => tb.classList.remove('drag-over'));
    document.querySelectorAll('.drop-indicator').forEach(el => el.remove());
  }

  function getDragAfterElement(container, y) {
    return [...container.querySelectorAll('tr[draggable="true"]:not(.dragging)')].reduce((closest, child) => {
      const offset = y - child.getBoundingClientRect().top - child.getBoundingClientRect().height / 2;
      return (offset < 0 && offset > closest.offset) ? { offset, element: child } : closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  function onDragOver(e) {
    if (!dragSrcRow) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    this.classList.add('drag-over'); document.querySelectorAll('.drop-indicator').forEach(el => el.remove());
    const indicator = document.createElement('tr'); indicator.className = 'drop-indicator'; indicator.innerHTML = '<td colspan="5"></td>';
    const after = getDragAfterElement(this, e.clientY);
    after ? this.insertBefore(indicator, after) : this.appendChild(indicator);
  }

  function onDragLeave(e) {
    if (!this.contains(e.relatedTarget)) {
      this.classList.remove('drag-over'); document.querySelectorAll('.drop-indicator').forEach(el => el.remove());
    }
  }

  function onDrop(e) {
    e.preventDefault(); if (!dragSrcRow) return;
    const destTbody = this; destTbody.classList.remove('drag-over');
    document.querySelectorAll('.drop-indicator').forEach(el => el.remove());
    const after = getDragAfterElement(destTbody, e.clientY);
    after ? destTbody.insertBefore(dragSrcRow, after) : destTbody.appendChild(dragSrcRow);

    const zonaOrigen = dragSrcTbody?.dataset.zona || ''; const zonaDestino = destTbody.dataset.zona || '';
    if (zonaOrigen !== zonaDestino) {
      Render.toast(`↕ ${zonaOrigen} → ${zonaDestino}`, 'info');
      Storage.saveRecOverride(S.hojaRecorridos, dragSrcRow.dataset.rowid, 'zona_manual', zonaDestino);
      if (S.config?.appsUrl) API.ping(`${S.config.appsUrl}?action=updateRecorridoFila&sheet=${enc(S.hojaRecorridos)}&row=${dragSrcRow.dataset.rowid}&field=zona_manual&value=${enc(zonaDestino)}&docid=${S.config.sheetId}`);
    }
  }

  cont.querySelectorAll('tr[draggable="true"]').forEach(row => {
    row.addEventListener('dragstart', onDragStart); row.addEventListener('dragend', onDragEnd);
    const handle = row.querySelector('.drag-handle');
    if (handle) {
      handle.addEventListener('mouseenter', () => row.setAttribute('draggable', true));
      handle.addEventListener('mouseleave', () => row.removeAttribute('draggable'));
    }
  });

  cont.querySelectorAll('.zona-tbody').forEach(tbody => {
    tbody.addEventListener('dragover', onDragOver); tbody.addEventListener('dragleave', onDragLeave); tbody.addEventListener('drop', onDrop);
  });
}

// ─── NAVEGACIÓN Y CONFIG ─────────────────────────────────────────
async function irA(pagina, pushHistory = true) {
  const protegidas = ['despacho', 'clientes', 'colectas', 'db-choferes', 'admin', 'historial-recorridos'];
  if (protegidas.includes(pagina) && !S.dbAutenticado) {
    window.toggleMenu(false);
    Handlers.abrirAdminModal(async (pass) => {
      if (await checkAdminPass(pass)) {
        S.dbAutenticado = true;
        Render.toast('🔐 Acceso Concedido', 'ok');
        const btn = document.getElementById('btn-nuevo-conductor');
        if (btn) btn.style.display = 'inline-block';
        irA(pagina, pushHistory);
      } else {
        Render.toast('❌ Contraseña Incorrecta', 'err');
      }
    });
    return;
  }
  window.toggleMenu(false); S.pagina = pagina; Storage.savePage(pagina);
  if (pushHistory) {
    history.pushState({ pagina: pagina }, '', '#' + pagina);
  }
  document.querySelectorAll('.nav-tab').forEach((b, i) => b.classList.toggle('active', ['clientes', 'despacho', 'recorridos', 'colectas', 'historial', 'historial-recorridos', 'rankings', 'db-choferes'][i] === pagina));
  ['despacho', 'clientes', 'recorridos', 'colectas', 'historial', 'historial-recorridos', 'rankings', 'db-choferes', 'admin'].forEach(p => { const el = document.getElementById(`page-${p}`); if (el) el.classList.toggle('active', p === pagina); });

  const tg = document.getElementById('tab-group');
  if (tg) { tg.style.display = pagina === 'despacho' ? 'flex' : 'none'; if (pagina === 'despacho') document.querySelectorAll('#tab-group .tab-btn').forEach((b, i) => b.classList.toggle('active', (i === 0 && S.hojaDespacho === 'DESPACHO_WHATSAPP') || (i === 1 && S.hojaDespacho === 'DESPACHO_WHATSAPP_SABADOS'))); }

  const tgc = document.getElementById('tab-group-clientes');
  if (tgc) { tgc.style.display = pagina === 'clientes' ? 'flex' : 'none'; if (pagina === 'clientes') document.querySelectorAll('#tab-group-clientes .tab-btn').forEach((b, i) => b.classList.toggle('active', (i === 0 && S.hojaClientes === 'DESPACHO_WHATSAPP') || (i === 1 && S.hojaClientes === 'DESPACHO_WHATSAPP_SABADOS'))); }

  const rtg = document.getElementById('tab-group-recorridos');
  if (rtg) { rtg.style.display = pagina === 'recorridos' ? 'flex' : 'none'; if (pagina === 'recorridos') document.querySelectorAll('#tab-group-recorridos .tab-btn').forEach((b, i) => b.classList.toggle('active', (i === 0 && S.hojaRecorridos === 'HOJA DE RECORRIDO') || (i === 1 && S.hojaRecorridos !== 'HOJA DE RECORRIDO'))); }

  if (pagina === 'despacho') {
    if (!S.choferes.length || S.despachoDirty) {
      S.despachoDirty = false;
      await Handlers.cargarDespacho();
    } else {
      Render.despacho(S.choferes);
      Render.stats();
    }
  }
  if (pagina === 'clientes') await Handlers.cargarClientes();
  if (pagina === 'colectas') await Handlers.cargarColectas();
  if (pagina === 'recorridos') await Handlers.renderRecorridos();
  if (pagina === 'historial') await Handlers.cargarHistorial();
  if (pagina === 'historial-recorridos') Handlers.cargarHistorialRecorridos();
  if (pagina === 'db-choferes' && S.dbAutenticado) await Handlers.cargarDB();
  if (pagina === 'rankings') { Handlers.cargarRankings(); Render.setStatus('ok'); }

  // Actualizar estado visual del botón Modo Offline en el panel Admin
  if (pagina === 'admin') {
    const btn = document.getElementById('btn-offline-mode');
    const lbl = document.getElementById('offline-mode-label');
    if (btn && lbl) {
      const isOff = Storage.isOfflineMode();
      btn.style.border = isOff ? '1px solid #10b981' : '1px solid #f59e0b';
      btn.style.background = isOff ? 'rgba(16,185,129,0.10)' : 'rgba(245,158,11,0.10)';
      btn.querySelector('span').textContent = isOff ? '✅' : '🔌';
      btn.querySelector('strong').textContent = isOff ? 'Modo Offline ACTIVO' : 'Desconectar de Sheets';
      lbl.textContent = isOff ? 'La app funciona 100% local · sin conexión a Sheets' : 'Activar modo 100% local · reclasifica TITULARES/SUPLENTES/COLECTADORES';
      if (isOff) btn.onclick = null; // Evitar re-activar si ya está activo
    }
  }
}

function cambiarHoja(nombre) { S.hojaDespacho = nombre; S.hojaClientes = nombre; Storage.saveHojaDespacho(nombre); Storage.saveHojaCli(nombre); S.choferes = []; S.enviados = Storage.loadEnviados(nombre); irA('despacho'); }
function cambiarHojaClientes(nombre) { S.hojaClientes = nombre; S.hojaDespacho = nombre; Storage.saveHojaCli(nombre); Storage.saveHojaDespacho(nombre); irA('clientes'); }
function cambiarHojaRecorrido(nombre) { S.hojaRecorridos = nombre; Storage.saveHojaRec(nombre); irA('recorridos'); }

// ─── EVENTOS Y EXPORTS ───────────────────────────────────────────
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const a = el.dataset.action; const r = parseInt(el.dataset.row); const id = parseInt(el.dataset.id); const n = el.dataset.nombre;
  if (a === 'toggle-enviado') Handlers.toggleEnviado(n); if (a === 'marcar-enviado') Handlers.marcarEnviado(n);
  if (a === 'editar-cliente') Handlers.editarCliente(r); if (a === 'guardar-cliente') Handlers.guardarCliente(r); if (a === 'cancelar-cliente') Handlers.cancelarCliente(r); if (a === 'eliminar-cliente') Handlers.eliminarCliente(r);
  if (a === 'editar-colecta') Handlers.editarColecta(r); if (a === 'guardar-colecta') Handlers.guardarColecta(r); if (a === 'cancelar-colecta') Handlers.cancelarColecta(r);
  if (a === 'eliminar-rec-fila') Handlers.eliminarRecFila(r); if (a === 'eliminar-zona') Handlers.eliminarZona(n, JSON.parse(el.dataset.ids || '[]'));
  if (a === 'editar-db') Handlers.editarRegistro(id);
  if (a === 'eliminar-db') Handlers.borrarRegistro(id);
  if (a === 'guardar-db') Handlers.guardarRegDB(id);
  if (a === 'cancelar-db') Handlers.cancelarRegDB(id);
  if (a === 'nuevo-conductor') window.agregarFilaDB();
  if (a === 'abrir-nuevo-registro') Handlers.abrirNuevoRegistro();
  if (a === 'nueva-localidad') Handlers.abrirModalLocalidad();
  if (a === 'guardar-nuevo-registro') window.guardarRegistroGlobal();
});

document.addEventListener('change', e => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const a = el.dataset.action; const r = parseInt(el.dataset.row); const id = parseInt(el.dataset.id);
  if (a === 'marcar-llegada') Handlers.marcarLlegada(r, el.checked);
  if (a === 'toggle-activo-db') Handlers.toggleActivoDB(id, el.checked);
  if (a === 'actualizar-tel-inline') Handlers.actualizarTelInline(r, el.value);
  if (a === 'chofer-select') Handlers.onChoferSelect(el, r);
  if (a === 'id-select') Handlers.onIdSelect(el, r);
  if (a === 'guardar-rec-field') Handlers.guardarRecField(r, el.dataset.field, el.value);
  if (a === 'update-id-inline') Handlers.actualizarIdInline(id, el.value);
});

document.addEventListener('input', e => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  if (el.dataset.action === 'guardar-rec-field') Handlers.guardarRecField(parseInt(el.dataset.row), el.dataset.field, el.value);
  if (el.dataset.action === 'id-select') Handlers.onIdSelect(el, parseInt(el.dataset.row));
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter') { const el = e.target.closest('[data-action="id-select"]'); if (el) { Handlers.onIdSelect(el, parseInt(el.dataset.row)); el.blur(); } }
});

window.irA = irA; window.cambiarHoja = cambiarHoja; window.cambiarHojaClientes = cambiarHojaClientes; window.cambiarHojaRecorrido = cambiarHojaRecorrido;
window.abrirModalConductor = () => window.agregarFilaDB();
window.confirmarNuevaLocalidad = () => Handlers.confirmarNuevaLocalidad();
window.cerrarModalNuevaLocalidad = () => {
  const m = document.getElementById('modal-nueva-localidad');
  if (!m) return;
  m.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.98)' }], { duration: 200, easing: 'ease-in' }).onfinish = () => m.style.removeProperty('display');
};
window.abrirSeguridad = () => irA('db-choferes');
window.guardarConfig = () => { Storage.saveConfig({ sheetId: document.getElementById('inp-sheet-id').value.trim(), apiKey: document.getElementById('inp-api-key').value.trim(), appsUrl: document.getElementById('inp-apps-url').value.trim(), sheetIdRec: document.getElementById('inp-sid-rec').value.trim() }); Render.toast('✓ Configuración Guardada', 'ok'); location.reload(); };

// ─── MODO OFFLINE: Desconecta de Google Sheets y reclasifica todos los datos ───
window.activarModoOffline = function () {
  Handlers.solicitarConfirmacion(
    '🔌 Desconectar de Google Sheets',
    '¿Activar Modo Offline? La app dejará de leer y escribir en Sheets. <strong>Todos los datos actuales quedan guardados localmente</strong> y se reclasifican automáticamente por rango de ID.',
    () => {
      // 1. Activar flags de modo offline y local
      Storage.setOfflineMode(true);
      Storage.set('migration_done', 'true');

      // 2. Reclasificar TODOS los conductores existentes por rango de ID
      const db = LocalDB.getDB();
      const conductores = db.conductores || [];
      const memoria = JSON.parse(localStorage.getItem('hogareno_memoria_db')) || {};

      let reclasificados = 0;
      conductores.forEach(c => {
        const numId = parseInt(String(c.choferIdAt || '').replace(/\D/g, ''), 10) || 0;
        let nuevaCond;
        if (numId >= 1000) nuevaCond = 'COLECTADOR';
        else if (numId >= 200) nuevaCond = 'SUPLENTE';
        else nuevaCond = 'TITULAR';

        if (c.condicion !== nuevaCond) reclasificados++;
        c.condicion = nuevaCond;

        // Grabar en bóveda para que sea indestructible
        const backup = { condicion: nuevaCond, vehiculo: c.vehiculo || 'AUTO', choferIdAt: c.choferIdAt };
        memoria[c.choferIdAt] = backup;
        if (c.nombre) memoria[c.nombre.toLowerCase()] = backup;
      });

      // 3. Persistir datos reclasificados
      LocalDB.saveChoferes(conductores);
      localStorage.setItem('hogareno_memoria_db', JSON.stringify(memoria));

      Render.toast(`✅ Modo Offline activado. ${conductores.length} conductores reclasificados (${reclasificados} corregidos). Reiniciando...`, 'ok');
      setTimeout(() => location.reload(), 2200);
    }
  );
};
window.resetConfig = () => {
  Handlers.solicitarConfirmacion(
    'Resetear App',
    '¿Borrar TODA la configuración y datos locales? Esta acción recargará la página.',
    () => {
      Storage.resetAll();
      location.reload();
    }
  );
};
window.toggleConfigInputs = () => { const el = document.getElementById('admin-config-technical'); el.style.display = el.style.display === 'none' ? 'block' : 'none'; };
window.toggleTheme = () => { const root = document.documentElement; const newTheme = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light'; root.setAttribute('data-theme', newTheme); Storage.saveTheme(newTheme); const btn = document.getElementById('btn-theme'); if (btn) btn.innerHTML = newTheme === 'light' ? '🌙 Modo Oscuro' : '☀️ Modo Claro'; };
window.toggleMenu = (f) => { const s = document.getElementById('sidebar'); const o = document.getElementById('sidebar-overlay'); if (!s || !o) return; const shouldOpen = typeof f === 'boolean' ? f : !s.classList.contains('open'); s.classList.toggle('open', shouldOpen); o.classList.toggle('show', shouldOpen); };
window.cerrarAdmin = () => irA('despacho');
window.abrirModalLocalidad = () => Handlers.abrirModalLocalidad();
window.agregarChofer = () => Handlers.agregarCliente();
window.agregarFilaDB = () => {
  const modal = document.getElementById('modal-nuevo-chofer');
  if (modal) {
    modal.style.setProperty('display', 'flex', 'important');
    setTimeout(() => {
      const inputId = document.getElementById('nc-idat');
      if (inputId) inputId.focus();
    }, 100);
  } else {
    alert("❌ Error: No se encontró la ventana del modal en el HTML.");
  }
};
window.Handlers = Handlers;
window.confirmarNuevoChofer = () => Handlers.confirmarNuevoChofer();

// ─── GLOBAL EXPORTS ──────────────────────────────────────────────
window.confirmarNuevoCliente = () => Handlers.confirmarNuevoCliente();
window.cerrarModalNuevoCliente = () => Handlers.cerrarModalNuevoCliente();

window.cerrarModalNuevoConductor = function () {
  const m = document.getElementById('modal-nuevo-chofer');
  if (m) m.style.removeProperty('display');
  // Limpiar campos de texto (incluyendo DNI)
  ['nc-idat', 'nc-nom', 'nc-cel', 'nc-dni', 'nc-dir', 'nc-ing'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  // Limpiar select múltiple de zona
  const selZona = document.getElementById('nc-zon');
  if (selZona) Array.from(selZona.options).forEach(opt => opt.selected = false);
  // Resetear condición a TITULAR
  const selCond = document.getElementById('nc-cond');
  if (selCond) selCond.value = 'TITULAR';
  const selVeh = document.getElementById('nc-veh');
  if (selVeh) selVeh.value = 'AUTO';
  // Resetear título del modal
  const title = document.getElementById('modal-chofer-title');
  if (title) title.textContent = '+ Nuevo Conductor';
  S._editId = null;
};

window.cerrarModalNuevoRegistro = window.cerrarModalNuevoConductor;
window.cerrarModalNuevoChofer = window.cerrarModalNuevoConductor;

window.abrirModalNuevoConductor = function () {
  window.cerrarModalNuevoConductor(); // Limpiar primero
  const m = document.getElementById('modal-nuevo-chofer');
  if (m) m.style.setProperty('display', 'flex', 'important');
  setTimeout(() => {
    const inputId = document.getElementById('nc-idat');
    if (inputId) inputId.focus();
  }, 100);
};

// ─── FUNCIÓN MAESTRA DE GUARDADO (ÚNICA FUENTE DE VERDAD) ────────
window.guardarRegistroGlobal = function () {
  // 1. Capturar valores del formulario
  const idInput = document.getElementById('nc-idat')?.value.trim();
  const nom = document.getElementById('nc-nom')?.value.trim();
  const tel = document.getElementById('nc-cel')?.value.trim();
  const dni = document.getElementById('nc-dni')?.value.trim() || '';
  const dir = document.getElementById('nc-dir')?.value.trim() || '';
  const rawDate = document.getElementById('nc-ing')?.value;
  const veh = document.getElementById('nc-veh')?.value || 'AUTO';

  // Capturar selección múltiple de zona
  const selZona = document.getElementById('nc-zon');
  let zona = '';
  if (selZona && selZona.multiple) {
    zona = Array.from(selZona.selectedOptions).map(opt => opt.value).join(', ');
  } else if (selZona) {
    zona = selZona.value.trim();
  }

  // 2. Validaciones básicas
  if (!idInput || !nom || !tel) {
    Render.toast('ID, Conductor y Celular son obligatorios', 'err');
    return;
  }
  if (isNaN(idInput)) {
    Render.toast('El ID debe ser un número', 'err');
    return;
  }

  // 3. Validar formato de fecha DD/MM/AAAA de la máscara
  let fechaFormateada = '—';
  if (rawDate) {
    if (rawDate.length === 10) {
      fechaFormateada = rawDate;
    } else {
      Render.toast('La fecha debe tener el formato completo DD/MM/AAAA', 'err');
      return;
    }
  }

  const idatUpper = idInput;
  const editIdStr = S._editId ? String(S._editId) : null;

  // 4. Validar duplicados (excluir el registro en edición)
  const existe = S.dbChoferesBDFull.find(c =>
    String(c.choferIdAt) === idatUpper && String(c.id) !== editIdStr
  );
  if (existe) {
    Render.errorModal('ID Duplicado', `El ID ${idatUpper} ya pertenece a <strong>${existe.nombre}</strong>.`);
    return;
  }

  try {
    // 5. Regla de negocio ABSOLUTA (fuente de verdad: rango del ID)
    const numIdValue = parseInt(String(idatUpper).replace(/\D/g, ''), 10) || 0;
    let condicion = 'TITULAR';
    if (numIdValue >= 1000) condicion = 'COLECTADOR';
    else if (numIdValue >= 200) condicion = 'SUPLENTE';

    const data = {
      choferIdAt: idatUpper,
      nombre: nom,
      tel: tel,
      dni: dni,
      zona: zona || 'Sin Zona',
      direccion: dir,
      ingreso: fechaFormateada,
      condicion: condicion,
      vehiculo: veh
    };

    if (S._editId) {
      // ── MODO EDICIÓN ──
      const idx1 = S.dbChoferesBDFull.findIndex(x => String(x.id) === editIdStr);
      if (idx1 !== -1) Object.assign(S.dbChoferesBDFull[idx1], data);
      const idx2 = S.dbChoferes.findIndex(x => String(x.id) === editIdStr);
      if (idx2 !== -1) Object.assign(S.dbChoferes[idx2], data);
    } else {
      // ── MODO NUEVO ──
      const newId = Date.now();
      const nuevo = { ...data, id: newId };
      S.dbChoferesBDFull.unshift(nuevo);
      S.dbChoferes.unshift(nuevo);
    }

    // 6. Persistencia y refresco visual
    LocalDB.saveChoferes(S.dbChoferesBDFull);

    // Actualizar bóveda de memoria para que la condición sobreviva migraciones y recargas
    const memoriaGuardado = JSON.parse(localStorage.getItem('hogareno_memoria_db')) || {};
    const backupDataGuardado = { condicion: condicion, vehiculo: veh, choferIdAt: idatUpper };
    memoriaGuardado[idatUpper] = backupDataGuardado;
    memoriaGuardado[nom.toLowerCase()] = backupDataGuardado;
    localStorage.setItem('hogareno_memoria_db', JSON.stringify(memoriaGuardado));

    Handlers.filtrarDB(); // Clasifica automáticamente en Titular/Suplente

    // 7. Cierre limpio del modal
    const wasEditing = !!S._editId;
    window.cerrarModalNuevoConductor(); // También hace S._editId = null
    Render.toast(wasEditing ? '✓ Cambios guardados' : '✓ Conductor registrado correctamente', 'ok');

    // 8. Sincronización en la nube (no bloquea) — se omite si está en Modo Offline
    if (S.config?.appsUrl && !Storage.isOfflineMode()) {
      Render.syncIndicator(true);
      API.saveChofer({ ...data, id: idatUpper }, S.config)
        .then(() => Render.toast('✓ Sincronizado con Sheets', 'ok'))
        .catch(e => console.error('Sync error:', e))
        .finally(() => Render.syncIndicator(false));
    }
  } catch (err) {
    Render.toast('Error crítico: ' + err.message, 'err');
    console.error(err);
  }
};

// Alias para compatibilidad con código anterior
Handlers.confirmarNuevoChofer = window.guardarRegistroGlobal;
window.confirmarNuevoChofer = window.guardarRegistroGlobal;

// ─── INICIALIZACIÓN ──────────────────────────────────────────────
(function init() {
  const cfg = Storage.loadConfig();
  S.config = cfg;
  initAdminHash();

  S.hojaDespacho = Storage.loadHojaDespacho();
  S.hojaClientes = Storage.loadHojaCli();
  S.hojaRecorridos = Storage.loadHojaRec();
  S.enviados = Storage.loadEnviados(S.hojaDespacho);
  S.filtroDB = Storage.loadFiltroDB(); // ← Restaurar el último tab activo (titulares/suplentes/colectadores)

  const theme = Storage.loadTheme();
  document.documentElement.setAttribute('data-theme', theme);
  const btnTheme = document.getElementById('btn-theme');
  if (btnTheme) btnTheme.innerHTML = theme === 'light' ? '🌙 Modo Oscuro' : '☀️ Modo Claro';

  // Mostrar controles de navegación
  const sidebarNav = document.getElementById('sidebar-nav');
  if (sidebarNav) sidebarNav.style.display = 'flex';
  const btnMenu = document.getElementById('btn-menu');
  if (btnMenu) btnMenu.style.display = 'flex';
  const btnReload = document.getElementById('btn-reload');
  if (btnReload) btnReload.style.display = 'block';

  // Hidratar desde cache local inicialmente
  const db = LocalDB.getDB();
  S.dbChoferesBDFull = db.conductores || [];
  S.dbChoferes = [...S.dbChoferesBDFull];
  S.choferesBDFull = S.dbChoferesBDFull;
  S.telMap = Object.fromEntries(S.dbChoferesBDFull.map(c => [c.nombre, c.tel]));

  // Manejo de Landing Page con soporte para Hash URL
  const hashInicial = window.location.hash.replace('#', '');
  const paginaInicial = hashInicial ? hashInicial : 'recorridos';
  irA(paginaInicial, true); // true para reemplazar/setear el estado inicial
  S.seccionActual = paginaInicial;
})();

/* ── NAVEGACIÓN DEL NAVEGADOR (ATRÁS / ADELANTE) ── */
window.addEventListener('popstate', (e) => {
  // Si hay un estado guardado, vamos a esa página sin volver a pushear al historial
  const destino = e.state && e.state.pagina ? e.state.pagina : (window.location.hash.replace('#', '') || 'recorridos');
  if (typeof irA === 'function') {
    irA(destino, false); // El 'false' evita un bucle infinito en el historial
  }
});

// ─── EJECUCIÓN INICIAL ──────────────────────────────────────────
document.body.style.overflow = 'hidden';
hideSplashScreen();

// ─── GLOBAL MODAL LISTENERS (ESC) ────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const modals = [
    'modal-nuevo-chofer',
    'modal-nuevo-cliente',
    'modal-nueva-localidad',
    'modal-historial-confirm',
    'modal-error-integrity',
  ];
  modals.forEach(id => {
    const el = document.getElementById(id);
    if (el && el.style.display !== 'none') el.style.removeProperty('display');
  });
});

// Cierre Global al hacer click en el overlay oscuro exterior
document.addEventListener('mousedown', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.style.removeProperty('display');
  }
});

/* ── UX: AUTO-BORRADO Y RESTAURACIÓN DE CEROS EN INPUTS NUMÉRICOS ── */
document.addEventListener('focusin', (e) => {
  if (e.target.classList.contains('num-inp') && e.target.value === '0') {
    e.target.value = '';
  }
});

document.addEventListener('focusout', (e) => {
  if (e.target.classList.contains('num-inp') && e.target.value.trim() === '') {
    e.target.value = '0';
    // Disparamos el evento 'input' para que el estado interno y los cálculos reaccionen al cambio
    e.target.dispatchEvent(new Event('input', { bubbles: true }));
  }
});