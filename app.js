/* Céu — previsão do tempo. Dados: Open-Meteo (https://open-meteo.com). */
(function () {
'use strict';

const VERSION = '1.4';
const CHANGELOG = [
  ['1.4', '26/11/2026', 'Texto do vento sem o "de": "Vento 14 km/h sudeste", no mesmo padrão de "Umidade 64%".'],
  ['1.3', '26/11/2026', 'Texto do vento sem "vindo do": agora "Vento de 14 km/h sudeste" (card principal e cartão de detalhes).'],
  ['1.2', '26/11/2026', 'Cartão de detalhes do vento agora mostra a frase completa: "Vento de 14 km/h vindo do sudeste", com as rajadas embaixo.'],
  ['1.1', '26/11/2026', 'Corrigido: ao trocar de cidade ou de °C/°F logo após abrir, o app podia mostrar o nome novo com a temperatura antiga. Localização por IP agora usa GeoJS e ipwho.is (o serviço anterior não respondia). Direção do vento por extenso: "Vento de 14 km/h vindo do sudeste".'],
  ['1.0', '26/11/2026', 'Primeira versão: previsão real (Open-Meteo), busca de cidades, várias cidades salvas, localização, gráfico de 24 horas, 7 dias, detalhes (sensação, umidade, vento, UV, pressão, sol), °C/°F, tema claro/escuro/automático, funciona offline com os últimos dados.']
];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('ceu.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ceu.' + k, JSON.stringify(v)); } catch { /* sem armazenamento */ } }
};

const DEFAULT_CITY = { id: '3448439', name: 'São Paulo', admin: 'São Paulo', country: 'Brasil', lat: -23.5475, lon: -46.63611 };
let cities = store.get('cities', null);
if (!Array.isArray(cities) || !cities.length) cities = [DEFAULT_CITY];
let selId = store.get('sel', cities[0].id);
if (!cities.some((c) => c.id === selId)) selId = cities[0].id;
let unit = store.get('unit', 'c');
let theme = store.get('theme', 'auto');
let current = null;      // dados da cidade selecionada
const mini = {};         // temperatura atual de cada cidade da lista
let loadSeq = 0;

/* ---------- condições e ícones ---------- */
const WMO = {
  0: ['Céu limpo', 'clear'], 1: ['Predominantemente limpo', 'partly'], 2: ['Parcialmente nublado', 'partly'], 3: ['Nublado', 'cloud'],
  45: ['Neblina', 'fog'], 48: ['Neblina com geada', 'fog'],
  51: ['Garoa fraca', 'rain'], 53: ['Garoa', 'rain'], 55: ['Garoa forte', 'rain'], 56: ['Garoa congelante', 'rain'], 57: ['Garoa congelante', 'rain'],
  61: ['Chuva fraca', 'rain'], 63: ['Chuva moderada', 'rain'], 65: ['Chuva forte', 'rain'], 66: ['Chuva congelante', 'rain'], 67: ['Chuva congelante forte', 'rain'],
  71: ['Neve fraca', 'snow'], 73: ['Neve', 'snow'], 75: ['Neve forte', 'snow'], 77: ['Grãos de neve', 'snow'],
  80: ['Pancadas de chuva fracas', 'rain'], 81: ['Pancadas de chuva', 'rain'], 82: ['Pancadas de chuva fortes', 'rain'],
  85: ['Pancadas de neve', 'snow'], 86: ['Pancadas de neve fortes', 'snow'],
  95: ['Trovoadas', 'storm'], 96: ['Trovoadas com granizo', 'storm'], 99: ['Trovoadas com granizo forte', 'storm']
};
const cond = (code) => WMO[code] || ['—', 'cloud'];

const P = {
  sun: '<g class="s"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></g>',
  moon: '<path class="m" d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  sunSmall: '<g class="s"><path d="M8 2.5v1.5M3.2 4.7l1 1M1.5 9.5H3M12.8 4.7l-1 1"/><path d="M5 10a3 3 0 0 1 5.7-1.3"/></g>',
  moonSmall: '<path class="m" d="M10.5 9.2A4 4 0 0 1 5.3 3.6a4.2 4.2 0 1 0 5.2 5.6z"/>',
  cloudLow: '<path class="c" d="M9 20h8a3.5 3.5 0 0 0 .4-7A5 5 0 0 0 8 13.6 3.2 3.2 0 0 0 9 20z"/>',
  cloud: '<path class="c" d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 11 3.5 3.5 0 0 0 7 18z"/>',
  cloudHigh: '<path class="c" d="M7 15h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 8 3.5 3.5 0 0 0 7 15z"/>',
  rain: '<path class="r" d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
  snow: '<path class="r" d="M8 19h.01M12 21h.01M16 19h.01M10 22h.01M14 18h.01"/>',
  bolt: '<path class="s" d="M13 15l-2.5 4h3L11 23"/>',
  fog: '<path class="c" d="M4 9h16M3 13h18M5 17h14"/>'
};
function icon(code, isDay, size, extra) {
  const k = cond(code)[1];
  let b;
  if (k === 'clear') b = isDay ? P.sun : P.moon;
  else if (k === 'partly') b = (isDay ? P.sunSmall : P.moonSmall) + P.cloudLow;
  else if (k === 'cloud') b = P.cloud;
  else if (k === 'fog') b = P.fog;
  else if (k === 'rain') b = P.cloudHigh + P.rain;
  else if (k === 'snow') b = P.cloudHigh + P.snow;
  else b = P.cloudHigh + P.bolt;
  return `<svg class="ic ${extra || ''}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${b}</svg>`;
}
$('brandIcon').innerHTML = icon(2, true, 26);
$('locIcon').innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';

/* ---------- rede ---------- */
async function getJSON(url, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
function forecastURL(c) {
  const p = new URLSearchParams({
    latitude: c.lat, longitude: c.lon, timezone: 'auto', forecast_days: '7', wind_speed_unit: 'kmh',
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl',
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day,uv_index,visibility',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,uv_index_max'
  });
  if (unit === 'f') p.set('temperature_unit', 'fahrenheit');
  return 'https://api.open-meteo.com/v1/forecast?' + p;
}
async function searchCities(q) {
  const p = new URLSearchParams({ name: q, count: '8', language: 'pt', format: 'json' });
  const d = await getJSON('https://geocoding-api.open-meteo.com/v1/search?' + p, 10000);
  return (d.results || []).map((r) => ({ id: String(r.id), name: r.name, admin: r.admin1 || '', country: r.country || '', lat: r.latitude, lon: r.longitude }));
}

/* ---------- formatação ---------- */
const deg = (v) => (v == null || isNaN(v) ? '—' : Math.round(v) + '°');
const hhmm = (iso) => (iso ? iso.slice(11, 16) : '—');
const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const WDL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const dateOf = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
function compassName(d) { return ['norte', 'nordeste', 'leste', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste'][Math.round(((d % 360) / 45)) % 8]; }
function compass(d) { return ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(((d % 360) / 45)) % 8]; }
function uvLabel(u) { return u < 3 ? 'Baixo' : u < 6 ? 'Moderado' : u < 8 ? 'Alto' : u < 11 ? 'Muito alto' : 'Extremo'; }
const place = (c) => [c.admin, c.country].filter((x, i, a) => x && a.indexOf(x) === i).join(', ');

/* ---------- carregar ---------- */
async function load(force) {
  const c = cities.find((x) => x.id === selId) || cities[0];
  selId = c.id;
  $('cityName').textContent = c.name;
  $('citySub').textContent = place(c);
  const cacheKey = 'cache.' + c.id + '.' + unit;
  const cached = store.get(cacheKey, null);
  if (cached && !current) render(c, cached.data, cached.ts, true);
  const seq = ++loadSeq;
  $('refreshBtn').classList.add('spin');
  try {
    const data = await getJSON(forecastURL(c));
    if (seq !== loadSeq) return;
    const ts = Date.now();
    store.set(cacheKey, { data, ts });
    hideNotice();
    render(c, data, ts, false);
    mini[c.id] = { t: data.current.temperature_2m, code: data.current.weather_code, day: data.current.is_day };
    renderCities();
    window.__ceu = { status: 'ok', city: c.name, temp: data.current.temperature_2m, days: data.daily.time.length, hours: data.hourly.time.length };
  } catch (e) {
    if (seq !== loadSeq) return;
    if (cached) { render(c, cached.data, cached.ts, true); showNotice('Sem conexão com o serviço de previsão. Mostrando os últimos dados salvos.', true); }
    else { showNotice('Não consegui buscar a previsão (' + (e.name === 'AbortError' ? 'tempo esgotado' : e.message) + '). Verifique a internet.', true); $('skeleton').hidden = true; }
    window.__ceu = { status: 'error', error: String(e && e.message || e), cached: !!cached };
  } finally {
    if (seq === loadSeq) $('refreshBtn').classList.remove('spin');
  }
  void force;
}
function showNotice(msg, retry) {
  const n = $('notice');
  n.innerHTML = '<span></span>' + (retry ? '<button class="btn" type="button">Tentar de novo</button>' : '');
  n.firstChild.textContent = msg;
  if (retry) n.querySelector('button').onclick = () => load(true);
  n.hidden = false;
}
function hideNotice() { $('notice').hidden = true; }

/* ---------- render ---------- */
function render(c, d, ts, stale) {
  current = { c, d };
  const cu = d.current, dy = d.daily, hr = d.hourly;
  const now = new Date(cu.time);
  $('citySub').textContent = `${place(c)} · ${WDL[now.getDay()]}, ${now.getDate()} de ${MONTHS[now.getMonth()]} · ${stale ? 'dados de' : 'atualizado às'} ${new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

  // índice da hora atual
  const h0 = Math.max(0, hr.time.findIndex((t) => t >= cu.time.slice(0, 13)));
  const uvNow = hr.uv_index ? hr.uv_index[h0] : null;
  const [label] = cond(cu.weather_code);

  $('hero').innerHTML = `
    <div>
      <div class="temp num">${deg(cu.temperature_2m)}</div>
      <div class="cond">${esc(label)}</div>
      <div class="mm">Máx ${deg(dy.temperature_2m_max[0])} · Mín ${deg(dy.temperature_2m_min[0])} · Sensação ${deg(cu.apparent_temperature)}</div>
      <div class="chips"><span>Umidade ${Math.round(cu.relative_humidity_2m)}%</span><span>Vento ${Math.round(cu.wind_speed_10m)} km/h ${compassName(cu.wind_direction_10m)}</span>${uvNow != null ? `<span>UV ${Math.round(uvNow)}</span>` : ''}</div>
    </div>
    ${icon(cu.weather_code, cu.is_day, 150, 'big')}`;

  // horas
  const N = Math.min(24, hr.time.length - h0);
  const H = [];
  for (let i = 0; i < N; i++) {
    const j = h0 + i;
    H.push({ t: hr.time[j], temp: hr.temperature_2m[j], p: hr.precipitation_probability ? hr.precipitation_probability[j] : null, code: hr.weather_code[j], day: hr.is_day[j] });
  }
  if (H.length) { H[0].temp = cu.temperature_2m; H[0].code = cu.weather_code; H[0].day = cu.is_day; }
  $('hours').innerHTML = H.map((h, i) => `
    <div class="hour${i === 0 ? ' now' : ''}"><span class="h">${i === 0 ? 'Agora' : hhmm(h.t).slice(0, 2) + 'h'}</span>${icon(h.code, h.day, 26)}<span class="num">${deg(h.temp)}</span><span class="p">${h.p >= 20 ? h.p + '%' : ''}</span></div>`).join('');
  const rainAt = H.find((h, i) => i > 0 && h.p >= 50);
  $('rainHint').textContent = rainAt ? `Chance de chuva a partir das ${hhmm(rainAt.t)}` : (H.some((h) => h.p >= 30) ? 'Possibilidade de chuva' : 'Sem chuva prevista');
  chartData = H;
  drawChart();

  // dias
  const lo = Math.min(...dy.temperature_2m_min), hi = Math.max(...dy.temperature_2m_max), span = Math.max(1, hi - lo);
  $('days').innerHTML = dy.time.map((t, i) => {
    const mn = dy.temperature_2m_min[i], mx = dy.temperature_2m_max[i];
    const k = cond(dy.weather_code[i])[1];
    const col = (k === 'rain' || k === 'storm' || k === 'snow') ? 'var(--sky)' : (k === 'clear' || k === 'partly') ? (mx >= (unit === 'f' ? 86 : 30) ? 'var(--hot)' : 'var(--sun)') : 'var(--mild)';
    const pp = dy.precipitation_probability_max ? dy.precipitation_probability_max[i] : null;
    return `<li class="day" title="${esc(cond(dy.weather_code[i])[0])}"><span class="d">${i === 0 ? 'Hoje' : WD[dateOf(t).getDay()]}</span>${icon(dy.weather_code[i], 1, 26)}<span class="pp">${pp != null ? pp + '%' : ''}</span><span class="lo num">${deg(mn)}</span><span class="bar"><i style="left:${((mn - lo) / span * 100).toFixed(1)}%;width:${Math.max(4, (mx - mn) / span * 100).toFixed(1)}%;background:${col}"></i></span><span class="num">${deg(mx)}</span></li>`;
  }).join('');

  // detalhes
  const uvMax = dy.uv_index_max ? dy.uv_index_max[0] : null;
  const vis = hr.visibility ? hr.visibility[h0] : null;
  const tiles = [
    ['Sensação térmica', deg(cu.apparent_temperature), '', cu.apparent_temperature > cu.temperature_2m + 1 ? 'Parece mais quente' : cu.apparent_temperature < cu.temperature_2m - 1 ? 'Parece mais frio' : 'Igual à real'],
    ['Umidade', Math.round(cu.relative_humidity_2m) + '%', '', cu.relative_humidity_2m < 30 ? 'Ar seco' : cu.relative_humidity_2m > 80 ? 'Ar muito úmido' : 'Confortável'],
    ['Vento', 'Vento ' + Math.round(cu.wind_speed_10m) + ' km/h ' + compassName(cu.wind_direction_10m), '', 'Rajadas de ' + Math.round(cu.wind_gusts_10m) + ' km/h', 'txt'],
    ['Índice UV máx.', uvMax != null ? Math.round(uvMax) : '—', '', uvMax != null ? uvLabel(uvMax) : ''],
    ['Pressão', Math.round(cu.pressure_msl), 'hPa', vis != null ? 'Visibilidade ' + (vis >= 10000 ? '10+ km' : (vis / 1000).toFixed(1).replace('.', ',') + ' km') : ''],
    ['Nascer e pôr do sol', hhmm(dy.sunrise[0]), '· ' + hhmm(dy.sunset[0]), 'Chuva hoje: ' + (dy.precipitation_sum[0] || 0).toFixed(1).replace('.', ',') + ' mm']
  ];
  $('details').innerHTML = tiles.map(([k, v, s, x, cls]) => `<div class="tile"><div class="k">${esc(k)}</div><div class="v${cls ? ' ' + cls : ''}">${esc(v)}${s ? `<small>${esc(s)}</small>` : ''}</div><div class="x">${esc(x)}</div></div>`).join('');

  $('skeleton').hidden = true;
  $('content').hidden = false;
  document.title = `${deg(cu.temperature_2m)} ${c.name} — Céu`;
}

/* ---------- gráfico ---------- */
let chartData = [];
function drawChart() {
  const box = $('chart');
  const W = box.clientWidth, Hh = box.clientHeight;
  if (!W || !chartData.length) return;
  const n = chartData.length, padX = 16, top = 26, bottom = 34;
  const temps = chartData.map((h) => h.temp);
  const mn = Math.min(...temps), mx = Math.max(...temps), sp = Math.max(2, mx - mn);
  const x = (i) => padX + (W - 2 * padX) * (n === 1 ? 0.5 : i / (n - 1));
  const y = (t) => top + (Hh - top - bottom) * (1 - (t - mn) / sp);
  const pts = chartData.map((h, i) => [x(i), y(h.temp)]);
  let line = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2;
    line += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  const base = Hh - bottom;
  const bw = Math.max(3, (W - 2 * padX) / n * 0.5);
  const bars = chartData.map((h, i) => h.p > 0 ? `<rect x="${x(i) - bw / 2}" y="${Hh - 4 - h.p / 100 * 22}" width="${bw}" height="${h.p / 100 * 22}" rx="2" style="fill:var(--sky);opacity:.55"/>` : '').join('');
  const step = W < 520 ? 4 : 3;
  let labels = '';
  for (let i = 0; i < n; i += step) labels += `<text class="tl" x="${x(i)}" y="${pts[i][1] - 9}" text-anchor="middle">${deg(chartData[i].temp)}</text>`;
  box.innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Gráfico de temperatura nas próximas 24 horas">
    <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:var(--sun);stop-opacity:.28"/><stop offset="1" style="stop-color:var(--sun);stop-opacity:0"/></linearGradient></defs>
    <path d="${line} L${pts[n - 1][0]},${base} L${pts[0][0]},${base} Z" fill="url(#g)"/>
    <path d="${line}" style="fill:none;stroke:var(--sun);stroke-width:2.5;stroke-linecap:round"/>
    <circle cx="${pts[0][0]}" cy="${pts[0][1]}" r="4.5" style="fill:var(--sun)"/>
    ${labels}${bars}</svg>`;
}
const chartRO = new ResizeObserver(() => drawChart());
chartRO.observe($('chart'));

/* ---------- cidades ---------- */
function renderCities() {
  $('cities').innerHTML = cities.map((c) => {
    const m = mini[c.id];
    return `<li class="city${c.id === selId ? ' on' : ''}" data-id="${esc(c.id)}">
      <button class="pick" type="button"><span><b>${esc(c.name)}</b><small>${esc(m ? cond(m.code)[0] : place(c))}</small></span><span class="t">${m ? deg(m.t) : ''}</span></button>
      ${cities.length > 1 ? `<button class="del" type="button" aria-label="Remover ${esc(c.name)}"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" style="margin:auto;stroke:currentColor;stroke-width:2;stroke-linecap:round;fill:none"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : ''}</li>`;
  }).join('');
}
$('cities').addEventListener('click', (e) => {
  const li = e.target.closest('.city'); if (!li) return;
  const id = li.dataset.id;
  if (e.target.closest('.del')) {
    cities = cities.filter((c) => c.id !== id);
    store.set('cities', cities);
    if (selId === id) { selId = cities[0].id; store.set('sel', selId); current = null; load(); }
    renderCities();
    return;
  }
  select(id);
});
function select(id) {
  selId = id; store.set('sel', id); current = null;
  renderCities(); closeSide(); load();
}
function addCity(c) {
  if (!cities.some((x) => x.id === c.id)) { cities.push(c); store.set('cities', cities); }
  select(c.id);
}
async function refreshMinis() {
  const u = unit;
  await Promise.all(cities.filter((c) => c.id !== selId).map(async (c) => {
    try {
      const p = new URLSearchParams({ latitude: c.lat, longitude: c.lon, current: 'temperature_2m,weather_code,is_day', timezone: 'auto' });
      if (unit === 'f') p.set('temperature_unit', 'fahrenheit');
      const d = await getJSON('https://api.open-meteo.com/v1/forecast?' + p, 10000);
      if (u !== unit) return;
      mini[c.id] = { t: d.current.temperature_2m, code: d.current.weather_code, day: d.current.is_day };
    } catch { /* ignora */ }
  }));
  renderCities();
}

/* ---------- busca ---------- */
let sTimer = 0, sSeq = 0;
$('q').addEventListener('input', () => {
  clearTimeout(sTimer);
  const q = $('q').value.trim();
  if (q.length < 2) { $('results').hidden = true; return; }
  sTimer = setTimeout(() => runSearch(q), 300);
});
$('searchForm').addEventListener('submit', (e) => { e.preventDefault(); const q = $('q').value.trim(); if (q.length >= 2) runSearch(q); });
async function runSearch(q) {
  const seq = ++sSeq, ul = $('results');
  ul.innerHTML = '<li class="sub" style="padding:10px">Buscando…</li>'; ul.hidden = false;
  try {
    const r = await searchCities(q);
    if (seq !== sSeq) return;
    ul.innerHTML = r.length ? r.map((c, i) => `<li><button type="button" data-i="${i}">${esc(c.name)}<small>${esc(place(c))}</small></button></li>`).join('') : '<li class="sub" style="padding:10px">Nenhuma cidade encontrada.</li>';
    ul.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; addCity(r[+b.dataset.i]); $('q').value = ''; ul.hidden = true; };
  } catch {
    if (seq === sSeq) ul.innerHTML = '<li class="sub" style="padding:10px">Falha na busca. Verifique a internet.</li>';
  }
}
document.addEventListener('click', (e) => { if (!e.target.closest('.search')) $('results').hidden = true; });

/* ---------- localização ---------- */
$('locBtn').addEventListener('click', async () => {
  const b = $('locBtn'); b.disabled = true;
  const old = b.lastChild.textContent; b.lastChild.textContent = 'Localizando…';
  try {
    let c = null;
    if (navigator.geolocation && /^https?:/.test(location.protocol)) {
      c = await new Promise((res) => navigator.geolocation.getCurrentPosition(
        (p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }), () => res(null), { timeout: 8000, maximumAge: 600000 }));
    }
    let name = 'Minha localização', admin = '', country = '';
    if (!c) {
      let ip = null;
      try {
        const g = await getJSON('https://get.geojs.io/v1/ip/geo.json', 8000);
        if (g.latitude) ip = { lat: parseFloat(g.latitude), lon: parseFloat(g.longitude), city: g.city, region: g.region, country: g.country };
      } catch { /* tenta o próximo */ }
      if (!ip) {
        const w = await getJSON('https://ipwho.is/', 8000);
        if (w.success !== false && w.latitude != null) ip = { lat: +w.latitude, lon: +w.longitude, city: w.city, region: w.region, country: w.country };
      }
      if (!ip || isNaN(ip.lat)) throw new Error('sem localização');
      c = { lat: ip.lat, lon: ip.lon }; name = ip.city || name; admin = ip.region || ''; country = ip.country || '';
    }
    const loc = { id: 'loc', name, admin, country, lat: c.lat, lon: c.lon };
    cities = cities.some((x) => x.id === 'loc') ? cities.map((x) => x.id === 'loc' ? loc : x) : [loc, ...cities];
    store.set('cities', cities);
    select('loc');
  } catch { showNotice('Não consegui descobrir sua localização. Busque a cidade pelo nome.', false); }
  finally { b.disabled = false; b.lastChild.textContent = old; }
});

/* ---------- preferências ---------- */
function applyPrefs() {
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll('[data-unit]').forEach((b) => b.classList.toggle('on', b.dataset.unit === unit));
  document.querySelectorAll('[data-theme-btn]').forEach((b) => b.classList.toggle('on', b.dataset.themeBtn === theme));
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]').content = dark ? '#0E1726' : '#F4F7FB';
}
document.querySelectorAll('[data-unit]').forEach((b) => b.addEventListener('click', () => {
  if (unit === b.dataset.unit) return;
  unit = b.dataset.unit; store.set('unit', unit); Object.keys(mini).forEach((k) => delete mini[k]); renderCities(); applyPrefs(); current = null; load(); refreshMinis();
}));
document.querySelectorAll('[data-theme-btn]').forEach((b) => b.addEventListener('click', () => { theme = b.dataset.themeBtn; store.set('theme', theme); applyPrefs(); drawChart(); }));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyPrefs);

/* ---------- menu lateral (celular) ---------- */
function openSide() { $('side').classList.add('open'); $('scrim').hidden = false; }
function closeSide() { $('side').classList.remove('open'); $('scrim').hidden = true; }
$('menuBtn').addEventListener('click', openSide);
$('scrim').addEventListener('click', closeSide);
$('refreshBtn').addEventListener('click', () => { load(true); refreshMinis(); });

/* ---------- sobre ---------- */
document.querySelectorAll('.ver').forEach((e) => { e.textContent = VERSION; });
$('changelog').innerHTML = CHANGELOG.map(([v, d, t]) => `<li><b>v${esc(v)}</b> · ${esc(d)}<br>${esc(t)}</li>`).join('');
$('aboutBtn').addEventListener('click', () => $('about').showModal());

/* ---------- início ---------- */
applyPrefs();
renderCities();
load().then(refreshMinis);
setInterval(() => { if (!document.hidden) { load(); refreshMinis(); } }, 15 * 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && current && Date.now() - (store.get('cache.' + selId + '.' + unit, { ts: 0 }).ts) > 15 * 60 * 1000) load();
});
if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});

window.CeuTest = { search: searchCities, add: addCity, version: VERSION };
})();
