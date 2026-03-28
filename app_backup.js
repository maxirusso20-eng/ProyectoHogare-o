// ════════════════════════════════════════════════════════════════
//  LOGÍSTICA HOGAREÑO — app.js (Sintaxis y Separación de Hojas Corregida)
// ════════════════════════════════════════════════════════════════

// ─── STATE ───────────────────────────────────────────────────────
const S = {
  config: null,
  pagina: 'despacho',
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
  despachoDirty: false,
};

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
      apiKey: env.apiKey || Storage.get('col_key') || '',
      appsUrl: Storage.get('col_url') || env.appsUrl || '',
      sheetIdRec: Storage.get('col_sid_rec') || env.sheetIdRec || Storage.get('col_sid') || env.sheetId || ''
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

  // 👇 ACÁ ESTABA EL ERROR: Ahora se separa por Planilla 👇
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
      zonasMap[zonaFinal].filas.push({ id: i + 1, localidad: colB, idChofer: colC, nombreChofer: colD, colecta: colE, colectan: colF });
    }
    return Object.values(zonasMap);
  },

  parseDBChoferes(rows) {
    const result = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r[1] && !r[0]) continue;
      result.push({
        id: i + 1, choferIdAt: r[0] || '', nombre: r[1] || '', tel: r[2] || '',
        dni: r[3] || '', zona: r[4] || '', direccion: r[5] || '', condicion: r[6] || '',
        activo: r[7]?.toString().toUpperCase() === 'TRUE',
      });
    }
    return result;
  },
};

// ─── STORE ───────────────────────────────────────────────────────
const Store = {
  async cargarDespacho() {
    await this.cargarClientes();
    S.choferes = API.reagrupar(S.clientes, S.telMap, S.enviados);
    return S.choferes;
  },

  async cargarChoferesBDSiNecesario() {
    if (S.choferesBDFull.length > 0 || !S.config) return;
    try {
      const id = S.config.sheetIdRec || S.config.sheetId;
      const rows = await API.fetchSheet(id, 'BASE DE DATOS CHOFERES', S.config.apiKey);
      const bd = API.parseChoferesBD(rows);
      S.choferesBDFull = bd.full;
      S.choferesBD = bd.nombres;
      if (!Object.keys(S.telMap).length) S.telMap = bd.telMap;
    } catch { }
  },

  async cargarClientes() {
    const id = S.config.sheetIdRec || S.config.sheetId;
    const [rowsCli, rowsBD] = await Promise.all([
      API.fetchSheet(id, `${S.hojaClientes}!A1:Z`, S.config.apiKey),
      API.fetchSheet(id, 'BASE DE DATOS CHOFERES', S.config.apiKey).catch(() => []),
    ]);

    const bd = API.parseChoferesBD(rowsBD);
    S.choferesBD = bd.nombres;
    if (!Object.keys(S.telMap).length) S.telMap = bd.telMap;

    S.clientes = API.parseClientes(rowsCli, S.telMap);
    S.clientes = [...S.clientes, ...Storage.loadLocalNuevosClientes(S.hojaClientes)];

    const overrides = Storage.loadOverridesClientes(S.hojaClientes);
    S.clientes.forEach(c => { if (overrides[c.rowIndex]) Object.assign(c, overrides[c.rowIndex]); });

    S.clientesFiltrados = [...S.clientes];
    return S.clientes;
  },

  async cargarColectas() {
    const id = S.config.sheetIdRec || S.config.sheetId;
    const [rows] = await Promise.all([
      API.fetchSheet(id, 'CLIENTES', S.config.apiKey),
      S.clientes.length === 0 ? Store.cargarClientes().catch(() => []) : Promise.resolve()
    ]);
    if (!Object.keys(S.telMap).length) await Store.cargarChoferesBDSiNecesario();

    S.colectas = API.parseColectas(rows, S.telMap);
    const overrides = Storage.loadOverridesColectas();
    S.colectas.forEach(c => { if (overrides[c.rowIndex]) Object.assign(c, overrides[c.rowIndex]); });

    S.colectasFiltradas = [...S.colectas];
    return S.colectas;
  },

  async cargarRecorridos() {
    await Store.cargarChoferesBDSiNecesario();
    const rows = await API.fetchSheet(S.config.sheetId, S.hojaRecorridos, S.config.apiKey);
    const overrides = Storage.loadRecOverrides(S.hojaRecorridos);
    return API.parseRecorridos(rows, overrides);
  },

  async cargarDB() {
    const id = S.config.sheetIdRec || S.config.sheetId;
    const rows = await API.fetchSheet(id, 'BASE DE DATOS CHOFERES', S.config.apiKey);
    S.dbChoferes = API.parseDBChoferes(rows);
    S.dbChoferes = [...S.dbChoferes, ...Storage.loadLocalNuevosChoferes()];
    S.dbChoferesFiltrados = [...S.dbChoferes];
    return S.dbChoferes;
  },
};

// ─── RENDER ──────────────────────────────────────────────────────
const Render = {
  despacho(lista) {
    const grid = document.getElementById('choferes-grid');
    const empty = document.getElementById('empty-despacho');
    grid.innerHTML = '';
    if (!lista.length) { empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    lista.forEach(c => {
      const card = document.createElement('div');
      card.className = `chofer-card${c.enviado ? ' enviado' : ''}`;
      card.dataset.nombre = c.nombre;
      const waHref = buildWA(c);
      const totalClientes = c.clientes.length;

      card.innerHTML = `
        <div class="card-header">
          <div class="card-header-info">
            <div class="chofer-name">${x(c.nombre)}</div>
            <div class="chofer-meta">
              <span class="meta-chip">👥 ${totalClientes} clientes</span>
              ${c.telefono ? `<span class="meta-chip">📱 ${fmtTel(c.telefono)}</span>` : '<span class="meta-chip meta-warn">⚠ sin teléfono</span>'}
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
      grid.appendChild(card);
    });
  },

  stats() {
    const env = S.choferes.filter(c => c.enviado).length;
    document.getElementById('stat-total').textContent = S.choferes.length;
    document.getElementById('stat-enviados').textContent = env;
    document.getElementById('stat-clientes').textContent = S.choferes.reduce((s, c) => s + c.clientes.length, 0);
    document.getElementById('stat-pendientes').textContent = S.choferes.length - env;
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
    return `<td class="td-cliente">${x(c.nombre)}</td><td class="td-chofer">${x(c.chofer) || '—'}</td><td class="td-horario">${c.tel ? fmtTel(c.tel) : '—'}</td><td class="td-horario" style="color:var(--text-muted);font-weight:600;text-align:center">${x(c.horarioProg)}</td><td style="text-align:center"><input type="checkbox" class="rec-check" ${c.colecta ? 'checked' : ''} data-action="marcar-llegada" data-row="${c.rowIndex}"></td><td class="td-horario" id="hora-col-${c.rowIndex}">${c.horario ? `<span style="color:var(--accent);font-weight:700;">${c.horario}</span>` : ''}</td><td class="td-acciones"><button class="btn-edit" data-action="editar-colecta" data-row="${c.rowIndex}">✏</button></td>`;
  },
  _colectaEditRow(c) {
    return `<td class="td-cliente">${x(c.nombre)}</td><td class="td-chofer">${x(c.chofer) || '—'}</td><td class="td-horario">${c.tel ? fmtTel(c.tel) : '—'}</td><td class="td-horario" style="color:var(--text-muted);font-weight:600;text-align:center">${x(c.horarioProg)}</td><td style="text-align:center"><input type="checkbox" disabled ${c.colecta ? 'checked' : ''}></td><td><input class="inp-inline" id="ec-horario-${c.rowIndex}" value="${x(c.horario)}" placeholder="HH:MM"></td><td class="td-acciones"><button class="btn-save" data-action="guardar-colecta" data-row="${c.rowIndex}">✓</button><button class="btn-cancel" data-action="cancelar-colecta" data-row="${c.rowIndex}">✕</button></td>`;
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
    div.innerHTML = `<div class="zona-title-row"><input class="zona-name-input" value="${x(z.nombre)}" readonly><button class="btn-del-zona" data-action="eliminar-zona" data-nombre="${x(z.nombre)}" data-ids="${x(JSON.stringify(z.filas.map(f => f.id)))}">🗑️ Borrar zona</button></div><table class="rec-table"><thead><tr><th></th><th>LOCALIDAD</th><th>ID CHOFER</th><th>NOMBRE CHOFER</th><th></th></tr></thead><tbody class="zona-tbody" data-zona="${x(z.nombre)}">${(z.filas || []).map(f => Render._recorridoFila(f)).join('')}</tbody></table>`;
    return div;
  },
  _recorridoFila(f) {
    return `<tr data-rowid="${f.id}" draggable="true" id="rec-tr-${f.id}"><td><span class="drag-handle" title="Arrastrar">⠿</span></td><td><input class="rec-inp" value="${x(f.localidad)}" placeholder="Localidad" data-action="guardar-rec-field" data-row="${f.id}" data-field="localidad"></td><td><input class="rec-inp" id="rec-id-${f.id}" value="${x(S.choferesBDFull.find(k => k.nombre === f.nombreChofer)?.choferIdAt || f.idChofer || '')}" placeholder="ID" data-action="id-select" data-row="${f.id}" style="text-align:center"></td><td><span class="rec-nombre-display" id="rec-nom-${f.id}">${x(f.nombreChofer || '— Sin asignar —')}</span></td><td><button class="btn-icon" data-action="eliminar-rec-fila" data-row="${f.id}">✕</button></td></tr>`;
  },

  db(lista) {
    const tbody = document.getElementById('tbody-db');
    tbody.innerHTML = '';
    if (!lista.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No hay registros.</td></tr>'; return; }
    const condOpts = ['Titular', 'Semititular', 'Suplente'];
    lista.forEach(c => {
      const tr = document.createElement('tr'); tr.id = `db-row-${c.id}`;
      const condBadge = c.condicion ? `<span class="cond-badge cond-${(c.condicion || '').toLowerCase().replace(' ', '')}">` + x(c.condicion) + '</span>' : '—';
      tr.innerHTML = `<td class="td-idat">${x(c.choferIdAt)}</td><td class="td-cliente">${x(c.nombre)}</td><td class="td-horario">${c.tel ? `<a class="tel-link" href="tel:${x(c.tel)}">${fmtTel(c.tel)}</a>` : '—'}</td><td>${x(c.dni)}</td><td>${x(c.zona)}</td><td class="td-dir">${x(c.direccion)}</td><td>${condBadge}</td><td class="td-acciones"><button class="btn-edit" data-action="editar-db" data-id="${c.id}">✏</button><button class="btn-del" data-action="eliminar-db" data-id="${c.id}">🗑</button></td>`;
      tbody.appendChild(tr);
    });
  },
  _dbEditRow(c) {
    const condOpts = ['Titular', 'Semititular', 'Suplente'].map(o => `<option value="${o}"${o === c.condicion ? ' selected' : ''}>${o}</option>`).join('');
    return `<td><input class="inp-inline" id="db-in-idat-${c.id}" value="${x(c.choferIdAt)}"></td><td><input class="inp-inline" id="db-in-nom-${c.id}" value="${x(c.nombre)}"></td><td><input class="inp-inline" id="db-in-tel-${c.id}" value="${x(c.tel)}"></td><td><input class="inp-inline" id="db-in-dni-${c.id}" value="${x(c.dni)}"></td><td><input class="inp-inline" id="db-in-zon-${c.id}" value="${x(c.zona)}"></td><td><input class="inp-inline" id="db-in-dir-${c.id}" value="${x(c.direccion)}"></td><td><select class="select-inline" id="db-in-cond-${c.id}"><option value="">— sin condición —</option>${condOpts}</select></td><td class="td-acciones"><button class="btn-save" data-action="guardar-db" data-id="${c.id}">✓</button><button class="btn-cancel" data-action="cancelar-db" data-id="${c.id}">✕</button></td>`;
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
    document.getElementById('loading').style.display = show ? 'block' : 'none';
    if (show) { document.getElementById('page-despacho').classList.remove('active'); document.getElementById('page-clientes').classList.remove('active'); }
  },
  error(msg) {
    const el = document.getElementById('error-msg');
    el.innerHTML = `<strong>❌ Error al conectar</strong><br><br>${msg}`; el.style.display = 'block'; document.getElementById('loading').style.display = 'none';
  },
  setStatus(s) { document.getElementById('status-dot').className = `status-dot${s ? ' ' + s : ''}`; },
  toast(msg, tipo = 'ok') {
    const t = document.getElementById('toast'); t.textContent = msg; t.className = `show ${tipo}`;
    clearTimeout(t._t); t._t = setTimeout(() => { t.className = ''; }, 3200);
  },
};

// ─── HANDLERS ────────────────────────────────────────────────────
const Handlers = {
  async cargarDespacho() {
    Render.cargando(true);
    try {
      await Store.cargarDespacho();
      Render.despacho(S.choferes); Render.stats(); Render.setStatus('ok'); Render.cargando(false);
      document.getElementById('page-despacho').classList.add('active');
    } catch (err) { Render.setStatus('error'); Render.error(err.message); }
  },

  toggleEnviado(nombre, forzar = false) {
    const c = S.choferes.find(k => k.nombre === nombre);
    if (!c) return;
    const nuevo = forzar ? true : !c.enviado;
    c.enviado = nuevo;
    nuevo ? S.enviados.add(nombre) : S.enviados.delete(nombre);
    Storage.saveEnviados(S.hojaDespacho, S.enviados);
    Render.despacho(S.choferes); Render.stats();
    if (S.config.appsUrl) API.ping(`${S.config.appsUrl}?action=setCheck&sheet=${enc(S.hojaDespacho)}&row=${c.rowIndex}&value=${nuevo}&docid=${S.config.sheetIdRec}`);
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
    if (S.config.appsUrl) {
      S.choferes.forEach(c => API.ping(`${S.config.appsUrl}?action=setCheck&sheet=${enc(S.hojaDespacho)}&row=${c.rowIndex}&value=${nuevoEstado}&docid=${S.config.sheetIdRec}`));
    }
  },

  filtrarChoferes() {
    const q = document.getElementById('search-despacho').value.toLowerCase();
    Render.despacho(q ? S.choferes.filter(c => c.nombre.toLowerCase().includes(q)) : S.choferes);
  },

  async cargarClientes() {
    Render.cargando(true);
    try { await Store.cargarClientes(); Render.clientes(S.clientesFiltrados); Render.setStatus('ok'); Render.cargando(false); document.getElementById('page-clientes').classList.add('active'); } catch (err) { Render.toast(err.message, 'err'); }
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

    if (S.config.appsUrl) {
      API.ping(`${S.config.appsUrl}?action=updateCliente&sheet=${enc(S.hojaClientes)}&row=${rowIndex}&nombre=${enc(c.nombre)}&chofer=${enc(nc)}&horario=${enc(nh)}&dir=${enc(nd)}&docid=${S.config.sheetIdRec}`);
      Render.toast('✓ Sincronizado', 'ok');
    } else Render.toast('✓ Cambio aplicado local', 'ok');
  },

  async eliminarCliente(rowIndex) {
    const c = S.clientes.find(k => k.rowIndex === rowIndex);
    if (!c || !confirm(`¿ELIMINAR a ${c.nombre}?`)) return;
    Render.toast('Eliminando...', 'info');
    S.clientes = S.clientes.filter(k => k.rowIndex !== rowIndex);
    S.clientesFiltrados = S.clientesFiltrados.filter(k => k.rowIndex !== rowIndex);
    S.despachoDirty = true;
    Render.clientes(S.clientesFiltrados);
    if (S.config.appsUrl) API.ping(`${S.config.appsUrl}?action=deleteRow&sheet=${enc(S.hojaClientes)}&row=${rowIndex}&docid=${S.config.sheetIdRec}`);
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
    if (m) m.style.display = 'flex';
    document.getElementById('ncli-nom').focus();
  },

  cerrarModalNuevoCliente() {
    const m = document.getElementById('modal-nuevo-cliente');
    if (m) m.style.display = 'none';
    document.getElementById('ncli-nom').value = '';
    document.getElementById('ncli-hor').value = '';
    document.getElementById('ncli-dir').value = '';
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

    // Lo enviamos a Apps Script
    if (S.config.appsUrl) {
      API.ping(`${S.config.appsUrl}?action=addCliente&sheet=${enc(S.hojaClientes)}&nombre=${enc(nombre)}&horario=${enc(horario)}&direccion=${enc(direccion)}&docid=${S.config.sheetIdRec}`);
    }

    Render.toast('✓ Cliente Guardado', 'ok');
    this.cerrarModalNuevoCliente();
  },

  async cargarColectas() {
    try { await Store.cargarColectas(); Render.colectas(S.colectasFiltradas); } catch (err) { Render.toast(err.message, 'err'); }
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
    Render.toast('✓ Horario guardado (Local)', 'ok');
  },

  filtrarColectas() {
    const q = document.getElementById('search-colectas').value.toLowerCase();
    S.colectasFiltradas = q ? S.colectas.filter(c => c.nombre.toLowerCase().includes(q) || c.chofer.toLowerCase().includes(q)) : [...S.colectas];
    Render.colectas(S.colectasFiltradas);
  },

  limpiarColectas() {
    if (!confirm('¿Borrar todos los horarios de hoy de la memoria local?')) return;
    Storage.clearColectas(); Handlers.cargarColectas(); Render.toast('✓ Memoria limpiada', 'ok');
  },

  async renderRecorridos() {
    Render.cargando(true);
    try { await Store.cargarChoferesBDSiNecesario(); const zonas = await Store.cargarRecorridos(); Render.recorridos(zonas); } catch (err) { Render.toast(err.message, 'err'); }
    Render.cargando(false); document.getElementById('page-recorridos').classList.add('active');
  },

  guardarRecField(rowIndex, field, value) {
    Storage.saveRecOverride(S.hojaRecorridos, rowIndex, field, value);
    if (!S.config.appsUrl) return;
    API.ping(`${S.config.appsUrl}?action=updateRecorridoFila&sheet=${enc(S.hojaRecorridos)}&row=${rowIndex}&field=${field}&value=${enc(value)}&docid=${S.config.sheetId}`);
  },

  onIdSelect(inp, rowId) {
    const idat = inp.value.trim();
    const nomDisplay = document.getElementById(`rec-nom-${rowId}`);
    if (!idat) {
      if (nomDisplay) nomDisplay.textContent = "— Sin asignar —";
      Handlers.guardarRecField(rowId, 'nombreChofer', "");
      Handlers.guardarRecField(rowId, 'idChofer', "");
      return;
    }
    const found = S.choferesBDFull.find(c => c.choferIdAt && c.choferIdAt.toUpperCase() === idat.toUpperCase());
    if (nomDisplay) {
      nomDisplay.textContent = found ? found.nombre : "— ID no encontrado —";
      if (found) Handlers.guardarRecField(rowId, 'nombreChofer', found.nombre);
    }
    Handlers.guardarRecField(rowId, 'idChofer', idat);
  },

  async eliminarRecFila(rowIndex) {
    if (!confirm('¿Borrar esta fila?')) return;
    if (S.config.appsUrl) API.ping(`${S.config.appsUrl}?action=deleteRow&sheet=${enc(S.hojaRecorridos)}&row=${rowIndex}&docid=${S.config.sheetId}`);
    Render.toast('✓ Borrado.', 'ok'); Handlers.renderRecorridos();
  },

  async eliminarZona(nombre, ids) {
    if (!confirm(`¿Borrar TODAS las localidades de ${nombre}?`)) return;
    const sortedIds = [...ids].sort((a, b) => b - a);
    for (const rid of sortedIds) {
      if (S.config.appsUrl) await API.ping(`${S.config.appsUrl}?action=deleteRow&sheet=${enc(S.hojaRecorridos)}&row=${rid}&docid=${S.config.sheetId}`);
    }
    Render.toast('✓ Zona eliminada.', 'ok'); Handlers.renderRecorridos();
  },

  async agregarLocalidad() {
    const loc = prompt('Nombre de la nueva localidad:'); if (!loc || !S.config.appsUrl) return;
    await API.ping(`${S.config.appsUrl}?action=addRecorrido&sheet=${enc(S.hojaRecorridos)}&localidad=${enc(loc)}&docid=${S.config.sheetId}`);
    Render.toast('✓ Localidad agregada.', 'ok'); Handlers.renderRecorridos();
  },

  async cargarDB() {
    try { await Store.cargarDB(); Render.db(S.dbChoferesFiltrados); } catch (err) { Render.toast(err.message, 'err'); }
  },

  filtrarDB() {
    const q = document.getElementById('search-db-choferes').value.toLowerCase();
    S.dbChoferesFiltrados = q ? S.dbChoferes.filter(c => c.nombre.toLowerCase().includes(q) || c.dni.includes(q)) : [...S.dbChoferes];
    Render.db(S.dbChoferesFiltrados);
  },

  editarDB(rowId) {
    if (S.editandoDB && S.editandoDB !== rowId) Handlers.cancelarDB(S.editandoDB);
    S.editandoDB = rowId;
    const c = S.dbChoferes.find(k => k.id === rowId);
    const tr = document.getElementById(`db-row-${rowId}`);
    if (tr) { tr.classList.add('editando'); tr.innerHTML = Render._dbEditRow(c); }
  },

  cancelarDB(rowId) {
    const c = S.dbChoferes.find(k => k.id === rowId);
    const tr = document.getElementById(`db-row-${rowId}`);
    if (tr) { tr.classList.remove('editando'); tr.innerHTML = Render._dbRow(c); S.editandoDB = null; }
  },

  async guardarDB(rowId) {
    const c = S.dbChoferes.find(k => k.id === rowId); if (!c) return;
    Object.assign(c, {
      nombre: document.getElementById(`db-in-nom-${rowId}`)?.value.trim() ?? c.nombre,
      direccion: document.getElementById(`db-in-dir-${rowId}`)?.value.trim() ?? c.direccion,
      dni: document.getElementById(`db-in-dni-${rowId}`)?.value.trim() ?? c.dni,
      zona: document.getElementById(`db-in-zon-${rowId}`)?.value.trim() ?? c.zona,
      tel: document.getElementById(`db-in-tel-${rowId}`)?.value.trim() ?? c.tel,
      choferIdAt: document.getElementById(`db-in-idat-${rowId}`)?.value.trim() ?? c.choferIdAt,
      condicion: document.getElementById(`db-in-cond-${rowId}`)?.value ?? c.condicion,
    });
    if (S.config.appsUrl) {
      const url = `${S.config.appsUrl}?action=updateRecorridoFila&sheet=${enc('BASE DE DATOS CHOFERES')}&row=${rowId}&docid=${S.config.sheetIdRec || S.config.sheetId}`;
      Promise.all(['nombre', 'dir', 'dni', 'zona', 'cel', 'id', 'condicion'].map(f => API.ping(`${url}&field=db_${f}&value=${enc(c[f === 'cel' ? 'tel' : f === 'id' ? 'choferIdAt' : f === 'dir' ? 'direccion' : f])}`)));
    }
    Handlers.cancelarDB(rowId); Render.toast('✓ Cambios guardados', 'ok');
  },

  async toggleActivoDB(rowId, isChecked) {
    const c = S.dbChoferes.find(k => k.id === rowId); if (!c) return; c.activo = isChecked;
    if (S.config.appsUrl) API.ping(`${S.config.appsUrl}?action=updateRecorridoFila&sheet=${enc('BASE DE DATOS CHOFERES')}&row=${rowId}&docid=${S.config.sheetIdRec || S.config.sheetId}&field=db_activo&value=${isChecked}`);
  },

  async eliminarDB(rowId) {
    if (!confirm('¿Borrar definitivamente?')) return;
    if (S.config.appsUrl) await API.ping(`${S.config.appsUrl}?action=deleteRow&sheet=${enc('BASE DE DATOS CHOFERES')}&row=${rowId}&docid=${S.config.sheetIdRec || S.config.sheetId}`);
    Render.toast('✓ Eliminado', 'ok'); Handlers.cargarDB();
  },

  async confirmarNuevoChofer() {
    const idat = document.getElementById('nc-idat').value.trim();
    const nom = document.getElementById('nc-nom').value.trim();
    if (!idat || !nom) return Render.toast('ID y nombre obligatorios', 'err');

    const btn = document.querySelector('#modal-nuevo-chofer .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }

    const nuevo = {
      id: Date.now(), choferIdAt: idat, nombre: nom,
      tel: document.getElementById('nc-cel').value.trim(),
      dni: document.getElementById('nc-dni').value.trim(),
      zona: document.getElementById('nc-zon').value.trim(),
      direccion: document.getElementById('nc-dir').value.trim(),
      condicion: document.getElementById('nc-cond').value || 'Titular',
      activo: true
    };

    if (S.config.appsUrl) {
      const url = `${S.config.appsUrl}?action=addConductorDB&sheet=${enc('BASE DE DATOS CHOFERES')}&idat=${enc(idat)}&nombre=${enc(nom)}&tel=${enc(nuevo.tel)}&dni=${enc(nuevo.dni)}&zona=${enc(nuevo.zona)}&dir=${enc(nuevo.direccion)}&condicion=${enc(nuevo.condicion)}&docid=${S.config.sheetIdRec || S.config.sheetId}`;
      try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.status === 'error') {
          if (btn) { btn.disabled = false; btn.textContent = '✓ Guardar Conductor'; }
          return Render.toast(data.message, 'err'); // Muestra alerta roja y no cierra modal
        }
      } catch (e) {
        console.error("Fetch error or CORS", e);
      }
    }

    Storage.saveLocalNuevoChofer(nuevo); S.dbChoferes.push(nuevo); Handlers.filtrarDB(); Handlers.cerrarModalNuevoChofer();
    Render.toast('✓ Conductor agregado', 'ok');
    if (btn) { btn.disabled = false; btn.textContent = '✓ Guardar Conductor'; }
  },

  cerrarModalNuevoChofer() {
    document.getElementById('modal-nuevo-chofer').style.display = 'none';
    ['nc-idat', 'nc-nom', 'nc-cel', 'nc-dni', 'nc-zon', 'nc-dir', 'nc-cond'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  },

  async cargarHistorial() { Render.historial(Storage.loadHistorial()); },

  mostrarConfirmarHistorial() {
    if (!S.colectas.filter(c => c.colecta).length) return Render.toast('⚠ No hay colectas marcadas hoy', 'info');
    document.getElementById('modal-historial-confirm').style.display = 'flex';
  },

  guardarHistorial() {
    const hoy = S.colectas.filter(c => c.colecta);
    if (!hoy.length) return;
    const fecha = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const records = hoy.map(c => {
      const cliData = S.clientes.find(cli => (cli.nombre || '').trim().toUpperCase() === (c.nombre || '').trim().toUpperCase()) || {};
      return { fecha, cliente: c.nombre, direccion: cliData.direccion || '—', chofer: c.chofer || '—', celular: c.tel || '—', horario: c.horario || '—' };
    });
    Storage.saveToHistorial(records); Storage.clearColectas(); Handlers.cargarColectas();
    document.getElementById('modal-historial-confirm').style.display = 'none'; Render.toast(`✓ Registros guardados`, 'ok');
  },

  limpiarHistorial() {
    Handlers.abrirAdminModal((pass) => {
      if (pass !== 'Logistica2026') return Render.toast('⚠ Clave incorrecta', 'err');
      if (!confirm('¿ESTÁ SEGURO? Esta acción borrará permanentemente todos los registros guardados.')) return;
      Storage.clearHistorial(); Handlers.cargarHistorial(); Render.toast('✓ Historial eliminado', 'ok');
    });
  },

  _adminCallback: null,
  abrirAdminModal(cb) {
    Handlers._adminCallback = cb;
    const modal = document.getElementById('modal-admin-pass'); const inp = document.getElementById('inp-admin-pass');
    if (modal && inp) { inp.value = ''; modal.style.display = 'flex'; setTimeout(() => inp.focus(), 100); }
  },
  cerrarAdminModal() { document.getElementById('modal-admin-pass').style.display = 'none'; Handlers._adminCallback = null; },
  confirmarAdminModal() {
    const inp = document.getElementById('inp-admin-pass'); if (!inp) return;
    const pass = inp.value; const cb = Handlers._adminCallback;
    Handlers.cerrarAdminModal(); if (cb) cb(pass);
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
function irA(pagina) {
  window.toggleMenu(false); S.pagina = pagina; Storage.savePage(pagina);
  document.querySelectorAll('.nav-tab').forEach((b, i) => b.classList.toggle('active', ['clientes', 'despacho', 'recorridos', 'colectas', 'historial', 'db-choferes'][i] === pagina));
  ['despacho', 'clientes', 'recorridos', 'colectas', 'historial', 'db-choferes', 'admin'].forEach(p => { const el = document.getElementById(`page-${p}`); if (el) el.classList.toggle('active', p === pagina); });

  const tg = document.getElementById('tab-group');
  if (tg) { tg.style.display = pagina === 'despacho' ? 'flex' : 'none'; if (pagina === 'despacho') document.querySelectorAll('#tab-group .tab-btn').forEach((b, i) => b.classList.toggle('active', (i === 0 && S.hojaDespacho === 'DESPACHO_WHATSAPP') || (i === 1 && S.hojaDespacho === 'DESPACHO_WHATSAPP_SABADOS'))); }

  const tgc = document.getElementById('tab-group-clientes');
  if (tgc) { tgc.style.display = pagina === 'clientes' ? 'flex' : 'none'; if (pagina === 'clientes') document.querySelectorAll('#tab-group-clientes .tab-btn').forEach((b, i) => b.classList.toggle('active', (i === 0 && S.hojaClientes === 'DESPACHO_WHATSAPP') || (i === 1 && S.hojaClientes === 'DESPACHO_WHATSAPP_SABADOS'))); }

  const rtg = document.getElementById('tab-group-recorridos');
  if (rtg) { rtg.style.display = pagina === 'recorridos' ? 'flex' : 'none'; if (pagina === 'recorridos') document.querySelectorAll('#tab-group-recorridos .tab-btn').forEach((b, i) => b.classList.toggle('active', (i === 0 && S.hojaRecorridos === 'HOJA DE RECORRIDO') || (i === 1 && S.hojaRecorridos !== 'HOJA DE RECORRIDO'))); }

  if (pagina === 'despacho' && (!S.choferes.length || S.despachoDirty)) { S.despachoDirty = false; Handlers.cargarDespacho(); }
  if (pagina === 'clientes') Handlers.cargarClientes();
  if (pagina === 'colectas') Handlers.cargarColectas();
  if (pagina === 'recorridos') Handlers.renderRecorridos();
  if (pagina === 'historial') Handlers.cargarHistorial();
  if (pagina === 'db-choferes' && S.dbAutenticado) Handlers.cargarDB();
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
  if (a === 'editar-db') Handlers.editarDB(id); if (a === 'guardar-db') Handlers.guardarDB(id); if (a === 'cancelar-db') Handlers.cancelarDB(id); if (a === 'eliminar-db') Handlers.eliminarDB(id);
});

document.addEventListener('change', e => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  const a = el.dataset.action; const r = parseInt(el.dataset.row); const id = parseInt(el.dataset.id);
  if (a === 'marcar-llegada') Handlers.marcarLlegada(r, el.checked); if (a === 'toggle-activo-db') Handlers.toggleActivoDB(id, el.checked);
  if (a === 'actualizar-tel-inline') Handlers.actualizarTelInline(r, el.value); if (a === 'chofer-select') Handlers.onChoferSelect(el, r);
  if (a === 'id-select') Handlers.onIdSelect(el, r); if (a === 'guardar-rec-field') Handlers.guardarRecField(r, el.dataset.field, el.value);
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
window.abrirSeguridad = () => { if (S.dbAutenticado) irA('admin'); else { document.getElementById('modal-seguridad').style.display = 'flex'; document.getElementById('admin-pass-inp').focus(); } };
window.cerrarSeguridad = () => { document.getElementById('modal-seguridad').style.display = 'none'; document.getElementById('admin-pass-inp').value = ''; };
window.validarAccesoAdmin = () => { if (document.getElementById('admin-pass-inp').value === 'Logistica2026') { S.dbAutenticado = true; window.cerrarSeguridad(); irA('db-choferes'); document.getElementById('btn-new-db').style.display = 'inline-block'; Handlers.cargarDB(); Render.toast('🔐 Acceso Concedido', 'ok'); } else { Render.toast('❌ Contraseña Incorrecta', 'err'); document.getElementById('admin-pass-inp').value = ''; document.getElementById('admin-pass-inp').focus(); } };
window.guardarConfig = () => { Storage.saveConfig({ sheetId: document.getElementById('inp-sheet-id').value.trim(), apiKey: document.getElementById('inp-api-key').value.trim(), appsUrl: document.getElementById('inp-apps-url').value.trim(), sheetIdRec: document.getElementById('inp-sid-rec').value.trim() }); Render.toast('✓ Configuración Guardada', 'ok'); location.reload(); };
window.resetConfig = () => { if (confirm('¿Borrar configuración?')) { Storage.resetAll(); location.reload(); } };
window.toggleConfigInputs = () => { const el = document.getElementById('admin-config-technical'); el.style.display = el.style.display === 'none' ? 'block' : 'none'; };
window.toggleTheme = () => { const root = document.documentElement; const newTheme = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light'; root.setAttribute('data-theme', newTheme); Storage.saveTheme(newTheme); const btn = document.getElementById('btn-theme'); if (btn) btn.innerHTML = newTheme === 'light' ? '🌙 Modo Oscuro' : '☀️ Modo Claro'; };
window.toggleMenu = (f) => { const s = document.getElementById('sidebar'); const o = document.getElementById('sidebar-overlay'); if (!s || !o) return; const shouldOpen = typeof f === 'boolean' ? f : !s.classList.contains('open'); s.classList.toggle('open', shouldOpen); o.classList.toggle('show', shouldOpen); };
window.cerrarAdmin = () => irA('despacho');
window.agregarLocalidad = () => Handlers.agregarLocalidad(); window.agregarChofer = () => Handlers.agregarCliente(); window.agregarFilaDB = () => { const m = document.getElementById('modal-nuevo-chofer'); if (m) m.style.display = 'flex'; }; window.confirmarNuevoChofer = () => Handlers.confirmarNuevoChofer(); window.cerrarModalNuevoChofer = () => Handlers.cerrarModalNuevoChofer();
window.cerrarModalNuevoCliente = () => Handlers.cerrarModalNuevoCliente(); window.confirmarNuevoCliente = () => Handlers.confirmarNuevoCliente();
window.recargarPagina = () => irA(S.pagina); window.toggleMarcarTodos = () => Handlers.toggleMarcarTodos(); window.limpiarColectas = () => Handlers.limpiarColectas(); window.limpiarHistorial = () => Handlers.limpiarHistorial();

// ─── INIT ────────────────────────────────────────────────────────
function iniciar() {
  const cfg = Storage.loadConfig();
  // Pre-llenamos los campos de config con los valores actuales
  const fillCfg = () => {
    ['inp-sheet-id', 'inp-api-key', 'inp-apps-url', 'inp-sid-rec'].forEach((id, i) => {
      const el = document.getElementById(id);
      if (el) el.value = [cfg.sheetId, cfg.apiKey, cfg.appsUrl, cfg.sheetIdRec][i] || '';
    });
  };
  setTimeout(fillCfg, 100);
  if (!cfg.sheetId || !cfg.apiKey) { irA('admin'); return; }
  S.config = cfg; S.hojaDespacho = Storage.loadHojaDespacho(); S.hojaClientes = Storage.loadHojaCli(); S.hojaRecorridos = Storage.loadHojaRec(); S.enviados = Storage.loadEnviados(S.hojaDespacho);

  const theme = Storage.loadTheme(); document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('btn-theme'); if (btn) btn.innerHTML = theme === 'light' ? '🌙 Modo Oscuro' : '☀️ Modo Claro';

  document.getElementById('sidebar-nav').style.display = 'flex'; document.getElementById('btn-menu').style.display = 'flex'; document.getElementById('btn-reload').style.display = 'block';
  irA(Storage.loadPage() || 'despacho');
}

iniciar();