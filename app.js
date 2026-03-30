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

  dbAutenticado: false,
  filtroDB: 'titulares',
  despachoDirty: false,
  initialLoadFinished: false,
};

// Bloqueo inmediato de scroll al cargar el script
document.body.style.overflow = 'hidden';

// ─── SPLASH CONTROL ──────────────────────────────────────────────
function hideSplashScreen() {
  const splash = document.getElementById('splash-screen');
  if (!splash) return;

  document.body.style.overflow = 'hidden';

  // Sincronización en background — NO bloquea al usuario
  Store.syncEverything().catch(e => console.warn('Sync background:', e));

  // 2 segundos fijos, sin excepciones
  setTimeout(() => {
    // 1. Aterrizar en Recorridos
    window.irA('recorridos');

    // 2. Iniciar fade-out del splash
    splash.classList.add('fade-out');

    // 3. Remover del DOM y restaurar scroll tras la animación (0.8s)
    setTimeout(() => {
      splash.remove();
      document.body.style.overflow = '';
    }, 800);
  }, 2000);
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
  if (!Storage.get('col_admin_hash')) {
    // Se inicializa con la clave maestra Senior solicitada
    Storage.set('col_admin_hash', await hashPass('Sye8m94h1M@'));
  }
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
    return rows.slice(1).map((r, i) => ({
      id: i + 1, // Row relative ID
      choferIdAt: r[0]?.toString().trim() || '', // ID CH001
      nombre: r[1]?.toString().trim() || '',
      tel: r[2]?.toString().trim() || '',
      dni: r[3]?.toString().trim() || '',
      zona: r[4]?.toString().trim() || '',
      direccion: r[5]?.toString().trim() || '',
      ingreso: r[6]?.toString().trim() || '—',
      activo: r[7]?.toString().toUpperCase() !== 'FALSE'
    })).filter(c => c.nombre);
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
        paquetes: r.paquetes || '', paquetesFuera: r.paquetesFuera || ''
      });
    }
    return Object.values(zonasMap);
  },

  // parseDBChoferes duplicate removed for cleanliness
};

// ─── STORE ───────────────────────────────────────────────────────
const Store = {
  isLocal() { return Storage.get('migration_done') === 'true'; },

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
    const local = localStorage.getItem('dbChoferes');
    if (local) {
      S.dbChoferes = JSON.parse(local);
    } else if (this.isLocal()) {
      S.dbChoferes = LocalDB.getDB().conductores || [];
    }
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
      if (S.pagina === 'db-choferes') Render.db(S.dbChoferes);
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
    modal.animate([{ opacity: 0, transform: 'scale(0.95)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 200, easing: 'ease-out' });
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
    const opts = S.choferesBD.map(ch => `<option value="${x(ch)}"${ch === c.chofer ? ' selected' : ''}>${x(ch)}</option>`).join('');
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
    return `<td class="td-cliente">${x(c.nombre)}</td><td class="td-chofer">${x(c.chofer) || '—'}</td><td class="td-horario">${c.tel ? fmtTel(c.tel) : '<span style="color:var(--text-muted)">—</span>'}</td><td style="text-align:center"><input type="checkbox" class="rec-check" ${c.colecta ? 'checked' : ''} data-action="marcar-llegada" data-row="${c.rowIndex}"></td><td class="td-horario" id="hora-col-${c.rowIndex}">${c.horario ? `<span style="color:var(--accent);font-weight:700;">${c.horario}</span>` : ''}</td><td class="td-acciones"><button class="btn-edit" data-action="editar-colecta" data-row="${c.rowIndex}">✏</button></td>`;
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
  _zonaBlock(z) {
    const div = document.createElement('div'); div.className = 'zona-block'; div.dataset.zonaid = z.id;
    div.innerHTML = `<div class="zona-title-row"><input class="zona-name-input" value="${x(z.nombre)}" readonly><button class="btn-del-zona" data-action="eliminar-zona" data-nombre="${x(z.nombre)}" data-ids="${x(JSON.stringify(z.filas.map(f => f.id)))}">🗑️ Borrar zona</button></div><table class="rec-table"><thead><tr><th></th><th>LOCALIDAD</th><th>ID</th><th>CHOFER</th><th>PAQUETE</th><th>POR FUERA</th><th></th></tr></thead><tbody class="zona-tbody" data-zona="${x(z.nombre)}">${(z.filas || []).map(f => Render._recorridoFila(f, z.nombre)).join('')}</tbody></table>`;
    return div;
  },
  _recorridoFila(f, zonaNombre) {
    const trashIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`;

    // Evaluar estado inicial para el color rojo (con conversión explícita)
    const clsPaq = (Number(f.paquetes || 0) > 40) ? ' over-limit' : '';
    const clsExt = (Number(f.paquetesFuera || 0) > 40) ? ' over-limit' : '';

    return `<tr data-rowid="${f.id}" draggable="true" id="rec-tr-${f.id}">
      <td><span class="drag-handle" title="Arrastrar">⠿</span></td>
      <td><input class="rec-inp" value="${x(f.localidad)}" placeholder="Localidad" data-action="guardar-rec-field" data-row="${f.id}" data-field="localidad"></td>
      <td><input class="rec-inp id-chofer" id="rec-id-${f.id}" value="${x(S.choferesBDFull.find(k => k.nombre === f.nombreChofer)?.choferIdAt || f.idChofer || '')}" placeholder="ID" data-action="id-select" data-row="${f.id}" style="text-align:center"></td>
      <td><span class="rec-nombre-display" id="rec-nom-${f.id}">${x(f.nombreChofer || '— Sin asignar —')}</span></td>
      
      <td><input type="number" class="rec-inp num-inp${clsPaq}" value="${x(f.paquetes)}" placeholder="0" data-action="guardar-rec-field" data-row="${f.id}" data-field="paquetes" oninput="this.classList.toggle('over-limit', this.value > 40)"></td>
      <td><input type="number" class="rec-inp num-inp${clsExt}" value="${x(f.paquetesFuera)}" placeholder="0" data-action="guardar-rec-field" data-row="${f.id}" data-field="paquetesFuera" oninput="this.classList.toggle('over-limit', this.value > 40)"></td>
      
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
    // Determinar condición: del campo o por regla de negocio (ID > 300 = SUPLENTE)
    const condicion = c.condicion || (parseInt(String(c.choferIdAt).replace(/\D/g, ''), 10) > 300 ? 'SUPLENTE' : 'TITULAR');
    const condBadge = condicion === 'SUPLENTE'
      ? `<span style="background:#f59e0b22;color:#f59e0b;border:1px solid #f59e0b55;border-radius:4px;padding:2px 6px;font-size:0.72rem;font-weight:700;letter-spacing:0.04em;">SUPLENTE</span>`
      : `<span style="background:#10b98122;color:#10b981;border:1px solid #10b98155;border-radius:4px;padding:2px 6px;font-size:0.72rem;font-weight:700;letter-spacing:0.04em;">TITULAR</span>`;
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
      <td style="text-align:center">
        <input type="checkbox" ${c.activo ? 'checked' : ''}
               data-action="toggle-activo-db" data-id="${c.id}">
      </td>
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
      <td><input class="inp-inline" id="db-in-idat-${c.id}" value="${x(c.choferIdAt)}"></td>
      <td><input class="inp-inline" id="db-in-nom-${c.id}" value="${x(c.nombre)}"></td>
      <td><input class="inp-inline" id="db-in-tel-${c.id}" value="${x(c.tel)}"></td>
      <td><input class="inp-inline" id="db-in-dni-${c.id}" value="${x(c.dni)}"></td>
      <td><input class="inp-inline" id="db-in-zon-${c.id}" value="${x(c.zona)}"></td>
      <td><input class="inp-inline" id="db-in-dir-${c.id}" value="${x(c.direccion)}"></td>
      <td><input class="inp-inline" id="db-in-ing-${c.id}" value="${x(c.ingreso)}"></td>
      <td style="text-align:center">
        <select class="inp-inline" id="db-in-cond-${c.id}">
          <option value="TITULAR" ${c.condicion !== 'SUPLENTE' ? 'selected' : ''}>TITULAR</option>
          <option value="SUPLENTE" ${c.condicion === 'SUPLENTE' ? 'selected' : ''}>SUPLENTE</option>
        </select>
      </td>
      <td style="text-align:center"><input type="checkbox" id="db-in-act-${c.id}" ${c.activo ? 'checked' : ''}></td>
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
    if (c.enviado === nuevo && !forzar) return; // Evitar guardado innecesario si no hay cambio

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
        // En Memoria
        S.clientes = S.clientes.filter(k => k.rowIndex !== rowIndex);
        S.clientesFiltrados = S.clientesFiltrados.filter(k => k.rowIndex !== rowIndex);
        S.despachoDirty = true;

        // Storage: Removemos de nuevos locales por si se creó manual
        const locales = Storage.loadLocalNuevosClientes(S.hojaClientes);
        const filtradosLocal = locales.filter(k => k.rowIndex !== rowIndex);
        Storage.setJSON(`col_local_clientes_${S.hojaClientes}`, filtradosLocal);

        // Storage: Guardamos en Overrides como fila eliminada/nula para que no se rehidrate
        const overrides = Storage.loadOverridesClientes(S.hojaClientes);
        overrides[rowIndex] = { eliminado: true };
        Storage.setJSON(`col_cli_ovr_${S.hojaClientes}`, overrides);

        // Storage: Forzamos la actualización completa de la lista filtrada en la base cruda
        const db = LocalDB.getDB();
        const dbKey = S.hojaClientes.toUpperCase().includes('SABADO') ? 'clientes_SABADO' : 'clientes_SEMANA';
        db[dbKey] = S.clientes;
        LocalDB.saveDB(db);

        Render.clientes(S.clientesFiltrados);
        Render.toast('🗑️ Cliente eliminado', 'ok');
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
    document.getElementById('ncli-nom').focus();
  },

  cerrarModalNuevoCliente() {
    const m = document.getElementById('modal-nuevo-cliente');
    if (m) m.style.removeProperty('display');
    ['ncli-nom', 'ncli-hor', 'ncli-dir'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  },

  async confirmarNuevoCliente() {
    const nombre = document.getElementById('ncli-nom').value.trim();
    const horario = document.getElementById('ncli-hor').value.trim();
    const direccion = document.getElementById('ncli-dir').value.trim();

    if (!nombre) { Render.toast('El nombre es obligatorio', 'err'); return; }

    const nuevo = { rowIndex: Date.now(), nombre, chofer: '', tel: '', horario, direccion };
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

    if (!S.recorridos) S.recorridos = [];

    // Validación de Doble Asignación en toda la hoja
    let duplicadoEn = null;
    S.recorridos.forEach(z => {
      const f = z.filas.find(row => row.id != rowId && row.idChofer && row.idChofer.toUpperCase() === idat);
      if (f) duplicadoEn = z.nombre || 'otra zona';
    });

    if (duplicadoEn) {
      Render.errorModal('Doble Asignación', `El ID <strong>${idat}</strong> ya está asignado a la localidad de <strong>${duplicadoEn}</strong>.`);
      inp.value = "";
      return;
    }

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
        if (zona) zona.filas = zona.filas.filter(f => f.id != rowId);

        const ovr = Storage.loadRecOverrides(S.hojaRecorridos);
        if (ovr[rowId]) { delete ovr[rowId]; Storage.setJSON(`col_rec_ovr_${S.hojaRecorridos}`, ovr); }

        Storage.saveRecorridos(S.hojaRecorridos, S.recorridos);
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
        Storage.saveRecorridos(S.hojaRecorridos, S.recorridos);
        Render.recorridos(S.recorridos);
        Render.toast(`🗑️ Zona ${nombre} eliminada`, 'ok');
      }
    );
  },

  async cargarDB() {
    try { await Store.cargarDB(); Render.database(S.dbChoferesFiltrados); } catch (err) { Render.toast(err.message, 'err'); }
  },

  cambiarTabDB(tab) {
    S.filtroDB = tab;
    document.querySelectorAll('#tab-group-db .tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    Handlers.filtrarDB();
  },

  filtrarDB() {
    const q = document.getElementById('search-db-choferes').value.toLowerCase();

    const filtrados = S.dbChoferes.filter(c => {
      // Extraer números del ID para evaluar si es suplente (> 300)
      const numId = parseInt(String(c.choferIdAt).replace(/\D/g, ''), 10) || 0;
      const esSuplente = c.condicion === 'SUPLENTE' || numId > 300;

      // Filtrar por pestaña
      const tabActual = S.filtroDB || 'titulares';
      if (tabActual === 'suplentes' && !esSuplente) return false;
      if (tabActual === 'titulares' && esSuplente) return false;

      // Filtrar por texto
      if (q && !c.nombre.toLowerCase().includes(q) && !(c.dni && String(c.dni).includes(q))) return false;

      return true;
    });

    S.dbChoferesFiltrados = filtrados;
    Render.database(S.dbChoferesFiltrados);
  },

  actualizarIdInline(rowId, nuevoId) {
    const c = S.dbChoferes.find(k => k.id === rowId);
    if (!c) return;

    c.choferIdAt = nuevoId.trim().toUpperCase();

    // Actualizar localmente si fue un chofer creado offline
    const locales = Storage.loadLocalNuevosChoferes();
    const idxLocal = locales.findIndex(x => x.id === rowId);
    if (idxLocal !== -1) {
      locales[idxLocal].choferIdAt = c.choferIdAt;
      Storage.setJSON('col_local_db_choferes', locales);
    }

    // Refrescar la vista (hará que salte de pestaña automáticamente si pasa los 300)
    Handlers.filtrarDB();
    Render.toast('✓ ID actualizado', 'ok');

    // Sincronizar con Google Sheets en segundo plano
    if (S.config.appsUrl) {
      const sid = S.config.sheetIdRec || S.config.sheetId;
      API.ping(`${S.config.appsUrl}?action=updateRecorridoFila&sheet=${enc('BASE DE DATOS CHOFERES')}&row=${rowId}&docid=${sid}&field=db_id&value=${enc(c.choferIdAt)}`);
    }
  },

  abrirModalConductor() {
    Handlers.cerrarModalNuevoRegistro();
    const modal = document.getElementById('modal-nuevo-chofer');
    if (modal) modal.style.setProperty('display', 'flex', 'important');
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

    // Poblar multi-select de zona
    const selZona = document.getElementById('nc-zon');
    if (selZona && c.zona) {
      const zonas = c.zona.split(/,\s*/);
      Array.from(selZona.options).forEach(opt => { opt.selected = zonas.includes(opt.value); });
    }

    // Convertir DD/MM/YYYY a YYYY-MM-DD para el input type="date"
    const elIng = document.getElementById('nc-ing');
    if (elIng) {
      if (c.ingreso && c.ingreso !== '—') {
        const parts = c.ingreso.split('/');
        if (parts.length === 3) elIng.value = `${parts[2]}-${parts[1]}-${parts[0]}`;
        else elIng.value = '';
      } else { elIng.value = ''; }
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
        condicionVal = parseInt(idatUpper, 10) > 300 ? 'SUPLENTE' : 'TITULAR';
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
        S.dbChoferesBDFull = S.dbChoferesBDFull.filter(x => String(x.id) !== String(rowId));
        S.dbChoferes = S.dbChoferes.filter(x => String(x.id) !== String(rowId));

        // Persistencia directa según instrucción
        LocalDB.saveChoferes(S.dbChoferesBDFull);

        Handlers.filtrarDB();
        Render.toast('🗑️ Registro eliminado', 'ok');
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
    ['ncli-nom', 'ncli-hor', 'ncli-dir'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const modal = document.getElementById('modal-nuevo-cliente');
    if (modal) modal.style.setProperty('display', 'flex', 'important');
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
async function irA(pagina) {
  window.toggleMenu(false); S.pagina = pagina; Storage.savePage(pagina);
  document.querySelectorAll('.nav-tab').forEach((b, i) => b.classList.toggle('active', ['clientes', 'despacho', 'recorridos', 'colectas', 'historial', 'db-choferes'][i] === pagina));
  ['despacho', 'clientes', 'recorridos', 'colectas', 'historial', 'db-choferes', 'admin'].forEach(p => { const el = document.getElementById(`page-${p}`); if (el) el.classList.toggle('active', p === pagina); });

  const tg = document.getElementById('tab-group');
  if (tg) { tg.style.display = pagina === 'despacho' ? 'flex' : 'none'; if (pagina === 'despacho') document.querySelectorAll('#tab-group .tab-btn').forEach((b, i) => b.classList.toggle('active', (i === 0 && S.hojaDespacho === 'DESPACHO_WHATSAPP') || (i === 1 && S.hojaDespacho === 'DESPACHO_WHATSAPP_SABADOS'))); }

  const tgc = document.getElementById('tab-group-clientes');
  if (tgc) { tgc.style.display = pagina === 'clientes' ? 'flex' : 'none'; if (pagina === 'clientes') document.querySelectorAll('#tab-group-clientes .tab-btn').forEach((b, i) => b.classList.toggle('active', (i === 0 && S.hojaClientes === 'DESPACHO_WHATSAPP') || (i === 1 && S.hojaClientes === 'DESPACHO_WHATSAPP_SABADOS'))); }

  const rtg = document.getElementById('tab-group-recorridos');
  if (rtg) { rtg.style.display = pagina === 'recorridos' ? 'flex' : 'none'; if (pagina === 'recorridos') document.querySelectorAll('#tab-group-recorridos .tab-btn').forEach((b, i) => b.classList.toggle('active', (i === 0 && S.hojaRecorridos === 'HOJA DE RECORRIDO') || (i === 1 && S.hojaRecorridos !== 'HOJA DE RECORRIDO'))); }

  if (pagina === 'despacho' && (!S.choferes.length || S.despachoDirty)) { S.despachoDirty = false; await Handlers.cargarDespacho(); }
  if (pagina === 'clientes') await Handlers.cargarClientes();
  if (pagina === 'colectas') await Handlers.cargarColectas();
  if (pagina === 'recorridos') await Handlers.renderRecorridos();
  if (pagina === 'historial') await Handlers.cargarHistorial();
  if (pagina === 'db-choferes' && S.dbAutenticado) await Handlers.cargarDB();
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
window.abrirSeguridad = () => {
  if (S.dbAutenticado) {
    irA('admin');
  } else {
    Handlers.abrirAdminModal(async (pass) => {
      if (await checkAdminPass(pass)) {
        S.dbAutenticado = true;
        irA('db-choferes');
        const btnNuevo = document.getElementById('btn-nuevo-conductor');
        if (btnNuevo) btnNuevo.style.display = 'inline-block';
        Handlers.cargarDB();
        Render.toast('🔐 Acceso Concedido', 'ok');
      } else {
        Render.toast('❌ Contraseña Incorrecta', 'err');
      }
    });
  }
};
window.guardarConfig = () => { Storage.saveConfig({ sheetId: document.getElementById('inp-sheet-id').value.trim(), apiKey: document.getElementById('inp-api-key').value.trim(), appsUrl: document.getElementById('inp-apps-url').value.trim(), sheetIdRec: document.getElementById('inp-sid-rec').value.trim() }); Render.toast('✓ Configuración Guardada', 'ok'); location.reload(); };
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
window.cerrarModalNuevoConductor = function () {
  const m = document.getElementById('modal-nuevo-chofer');
  if (m) m.style.removeProperty('display');
  // Limpiar campos de texto
  ['nc-idat', 'nc-nom', 'nc-cel', 'nc-dir', 'nc-ing'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  // Limpiar select múltiple de zona
  const selZona = document.getElementById('nc-zon');
  if (selZona) Array.from(selZona.options).forEach(opt => opt.selected = false);
  // Resetear condición a TITULAR
  const selCond = document.getElementById('nc-cond');
  if (selCond) selCond.value = 'TITULAR';
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

  // 3. Formatear fecha de YYYY-MM-DD a DD/MM/YYYY
  let fechaFormateada = '—';
  if (rawDate) {
    const [y, m, d] = rawDate.split('-');
    fechaFormateada = `${d}/${m}/${y}`;
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
    // 5. Regla de negocio: ID > 300 → SUPLENTE, si no → TITULAR
    //    La condición del select tiene prioridad, pero si no hay select la calculamos
    let condicion;
    const selCond = document.getElementById('nc-cond');
    if (selCond && selCond.value) {
      condicion = selCond.value;
    } else {
      condicion = parseInt(idatUpper, 10) > 300 ? 'SUPLENTE' : 'TITULAR';
    }

    const data = {
      choferIdAt: idatUpper,
      nombre: nom,
      tel: tel,
      dni: dni,
      zona: zona || 'Sin Zona',
      direccion: dir,
      ingreso: fechaFormateada,
      condicion: condicion,
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
      const nuevo = { ...data, id: newId, activo: true };
      S.dbChoferesBDFull.unshift(nuevo);
      S.dbChoferes.unshift(nuevo);
    }

    // 6. Persistencia y refresco visual
    LocalDB.saveChoferes(S.dbChoferesBDFull);
    Handlers.filtrarDB(); // Clasifica automáticamente en Titular/Suplente

    // 7. Cierre limpio del modal
    const wasEditing = !!S._editId;
    window.cerrarModalNuevoConductor(); // También hace S._editId = null
    Render.toast(wasEditing ? '✓ Cambios guardados' : '✓ Conductor registrado correctamente', 'ok');

    // 8. Sincronización en la nube (no bloquea)
    if (S.config?.appsUrl) {
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

  S.hojaDespacho = Storage.loadHojaDespacho();
  S.hojaClientes = Storage.loadHojaCli();
  S.hojaRecorridos = Storage.loadHojaRec();
  S.enviados = Storage.loadEnviados(S.hojaDespacho);

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

  // Landing page en Recorridos
  irA('recorridos');
  S.seccionActual = 'recorridos';
})();

// ─── EJECUCIÓN INICIAL ──────────────────────────────────────────
document.body.style.overflow = 'hidden';

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

// ─── DISPARO DEL SPLASH (SIEMPRE) ───────────────────────────────
hideSplashScreen();
