const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

const config = {
		PORT: process.env.PORT || 3000,
		DATA_FILE: process.env.DATA_FILE || 'data.json',
		CACHE_TTL: 5 * 60 * 1000
};

const logger = {
		info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
		error: (msg, err) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`, err?.message || '')
};

app.use(compression());
app.use(helmet({
		contentSecurityPolicy: {
				directives: {
						defaultSrc: ["'self'"],
						styleSrc: ["'self'", "'unsafe-inline'"],
						scriptSrc: ["'self'", "'unsafe-inline'"],
						imgSrc: ["'self'", "data:", "https:", "http:", "blob:"],
						mediaSrc: ["'self'", "blob:", "data:", "https:", "http:"],
						connectSrc: ["'self'", "https:", "http:"]
				}
		}
}));

const videoProxyLimiter = rateLimit({
		windowMs: 15 * 60 * 1000,
		max: 100,
		message: { status: 'error', message: 'Demasiadas solicitudes' }
});

let SERIES_LIST = [];
let SERIES_INDEX = {};
let TOTAL_EPISODES = 0;
let DATA_LOADED = false;

function loadData() {
		try {
				const jsonPath = path.join(__dirname, config.DATA_FILE);
				if (!fs.existsSync(jsonPath)) {
						console.error('❌ NO EXISTE data.json');
						return;
				}

				const raw = fs.readFileSync(jsonPath, 'utf8');
				const data = JSON.parse(raw);

				if (!Array.isArray(data)) throw new Error('data.json debe ser un array');

				TOTAL_EPISODES = data.length;
				logger.info(`${TOTAL_EPISODES} episodios encontrados`);

				const map = {};
				data.forEach(item => {
						const name = item.series || 'Sin nombre';
						const season = String(item.season || '1');

						if (!map[name]) {
								map[name] = {
										name,
										poster: item["logo serie"] || '',
										seasons: {},
										count: 0
								};
						}

						if (!map[name].seasons[season]) {
								map[name].seasons[season] = [];
						}

						map[name].seasons[season].push({
								ep: item.ep || 1,
								title: item.title || `Episodio ${item.ep || 1}`,
								url: item.url || ''
						});
						map[name].count++;
				});

				Object.values(map).forEach(series => {
						Object.keys(series.seasons).forEach(season => {
								series.seasons[season].sort((a, b) => a.ep - b.ep);
						});
				});

				SERIES_INDEX = map;
				SERIES_LIST = Object.values(map)
						.map(s => ({
								name: s.name,
								poster: s.poster,
								seasons: Object.keys(s.seasons).length,
								count: s.count
						}))
						.sort((a, b) => a.name.localeCompare(b.name));

				DATA_LOADED = true;
				logger.info(`${SERIES_LIST.length} series indexadas`);

		} catch (error) {
				console.error('❌ Error en loadData:', error.message);
		}
}

loadData();

app.use((req, res, next) => {
		res.setHeader('Access-Control-Allow-Origin', '*');
		next();
});

app.get('/api/stats', (req, res) => {
		res.json({
				status: 'ok',
				series: SERIES_LIST.length,
				episodes: TOTAL_EPISODES,
				loaded: DATA_LOADED
		});
});

app.get('/api/series', (req, res) => {
		const page = parseInt(req.query.page) || 0;
		const limit = parseInt(req.query.limit) || 24;
		const search = (req.query.q || '').toLowerCase();
		const random = req.query.random === 'true';

		let list = [...SERIES_LIST];

		if (search) {
				list = list.filter(s => s.name.toLowerCase().includes(search));
		}

		if (random) {
				for (let i = list.length - 1; i > 0; i--) {
						const j = Math.floor(Math.random() * (i + 1));
						[list[i], list[j]] = [list[j], list[i]];
				}
		}

		const total = list.length;
		const start = page * limit;

		res.json({
				status: 'ok',
				total,
				page,
				hasMore: start + limit < total,
				data: list.slice(start, start + limit)
		});
});

app.get('/api/series/:name', (req, res) => {
		const series = SERIES_INDEX[decodeURIComponent(req.params.name)];
		if (!series) {
				return res.status(404).json({ status: 'error', message: 'Serie no encontrada' });
		}
		res.json({ status: 'ok', data: series });
});

app.get('/video-proxy', videoProxyLimiter, (req, res) => {
		const url = req.query.url;
		if (!url) return res.status(400).end();

		try {
				const decodedUrl = decodeURIComponent(url);
				const parsed = new URL(decodedUrl);
				const client = parsed.protocol === 'https:' ? https : http;

				const opts = {
						hostname: parsed.hostname,
						port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
						path: parsed.pathname + parsed.search,
						headers: {
								'User-Agent': 'Mozilla/5.0',
								'Accept': '*/*',
								'Accept-Encoding': 'identity'
						}
				};

				if (req.headers.range) {
						opts.headers['Range'] = req.headers.range;
				}

				const proxyReq = client.request(opts, (proxyRes) => {
						if ([301, 302, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
								return res.redirect(`/video-proxy?url=${encodeURIComponent(proxyRes.headers.location)}`);
						}

						res.status(proxyRes.statusCode);
						res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'video/mp4');
						res.setHeader('Accept-Ranges', 'bytes');

						if (proxyRes.headers['content-length']) {
								res.setHeader('Content-Length', proxyRes.headers['content-length']);
						}
						if (proxyRes.headers['content-range']) {
								res.setHeader('Content-Range', proxyRes.headers['content-range']);
						}

						proxyRes.pipe(res);
				});

				proxyReq.on('error', () => res.status(502).end());
				proxyReq.end();

		} catch (error) {
				res.status(400).end();
		}
});

const HTML = `<!DOCTYPE html>
<html lang="es">
<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
		<title>Stream Series</title>
		<style>
				*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
				:root{--primary:#e50914;--bg:#0a0a0a;--surface:#141414;--text:#fff;--text2:#888;--border:#222}
				html,body{overscroll-behavior-y:contain;overflow:hidden;height:100%}
				body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg);color:var(--text)}
				#app{height:100%;display:flex;flex-direction:column;overflow:hidden}

				.header{padding:10px 12px;background:var(--surface);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;flex-shrink:0}
				.logo{font-size:16px;font-weight:bold;color:var(--primary)}
				#search{flex:1;max-width:280px;padding:7px 12px;background:var(--bg);border:1px solid var(--border);border-radius:16px;color:var(--text);font-size:12px;outline:none}
				#search:focus{border-color:var(--primary)}
				.stats{font-size:10px;color:var(--text2);white-space:nowrap}

				.pull-indicator{
						position:absolute;top:0;left:0;right:0;height:0;
						background:var(--surface);display:flex;align-items:center;justify-content:center;
						overflow:hidden;transition:height .2s;z-index:50;border-bottom:1px solid var(--border);
				}
				.pull-indicator.pulling{transition:none}
				.pull-indicator.refreshing{height:50px}
				.pull-icon{font-size:20px;transition:transform .2s}
				.pull-indicator.refreshing .pull-icon{animation:spin .6s linear infinite}
				.pull-text{font-size:11px;color:var(--text2);margin-left:8px}

				.content-wrapper{flex:1;position:relative;overflow:hidden}
				.content{height:100%;padding:12px;overflow-y:auto;-webkit-overflow-scrolling:touch}
				.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(85px,1fr));gap:10px}
				@media(min-width:500px){.grid{grid-template-columns:repeat(auto-fill,minmax(95px,1fr))}}
				@media(min-width:800px){.grid{grid-template-columns:repeat(auto-fill,minmax(105px,1fr));gap:12px}}

				.card{background:var(--surface);border-radius:5px;overflow:hidden;cursor:pointer;transition:transform .15s}
				.card:hover{transform:scale(1.03)}
				.card-img{position:relative;width:100%;padding-top:130%;background:var(--border);overflow:hidden}
				.card-img canvas,.card-img img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}
				.card-img canvas{filter:blur(8px);transform:scale(1.1)}
				.card-img img{opacity:0;transition:opacity .2s}
				.card-img img.loaded{opacity:1}
				.card-info{padding:6px}
				.card-title{font-size:10px;font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.2}
				.card-meta{font-size:8px;color:var(--text2);margin-top:2px}

				.detail{position:fixed;inset:0;background:var(--bg);z-index:1000;display:none;flex-direction:column}
				.detail.active{display:flex}
				.detail-header{padding:12px;display:flex;align-items:center;gap:10px;background:var(--surface);border-bottom:1px solid var(--border)}
				.detail-title{flex:1;font-size:14px;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
				.btn{background:rgba(255,255,255,.1);border:none;color:var(--text);width:32px;height:32px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px}
				.btn:hover{background:rgba(255,255,255,.2)}
				.seasons{padding:10px 12px;display:flex;gap:6px;overflow-x:auto;background:var(--surface)}
				.season-btn{padding:5px 12px;background:var(--bg);border:1px solid var(--border);border-radius:14px;color:var(--text2);cursor:pointer;font-size:11px}
				.season-btn.active{background:var(--primary);border-color:var(--primary);color:#fff}
				.episodes{flex:1;overflow-y:auto;padding:12px}
				.episode{background:var(--surface);border-radius:5px;padding:10px;margin-bottom:8px;cursor:pointer;display:flex;align-items:center;gap:10px}
				.episode:hover{background:var(--border)}
				.ep-num{background:var(--primary);color:#fff;min-width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold}
				.ep-title{font-size:12px;font-weight:600}
				.ep-meta{font-size:10px;color:var(--text2)}

				.player{position:fixed;inset:0;background:#000;z-index:2000;display:none;flex-direction:column}
				.player.active{display:flex}
				.player-header{padding:12px;position:absolute;top:0;left:0;right:0;z-index:10;background:linear-gradient(#000,transparent);display:flex;align-items:center;gap:10px}
				.player-title{color:#fff;font-size:13px;flex:1}
				.video-wrap{flex:1;display:flex;align-items:center;justify-content:center}
				video{width:100%;height:100%}

				.loading,.empty{text-align:center;padding:30px;color:var(--text2);font-size:12px}
				.loading::after{content:'';display:block;width:20px;height:20px;margin:12px auto;border:2px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin .6s linear infinite}
				@keyframes spin{to{transform:rotate(360deg)}}
				::-webkit-scrollbar{width:5px;height:5px}
				::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
		</style>
</head>
<body>
<div id="app">
		<div class="header">
				<div class="logo">STREAM+</div>
				<input type="search" id="search" placeholder="Buscar...">
				<div class="stats" id="stats">...</div>
		</div>
		<div class="content-wrapper">
				<div class="pull-indicator" id="pullIndicator">
						<span class="pull-icon">🎲</span>
						<span class="pull-text">Suelta para mezclar</span>
				</div>
				<div class="content" id="content">
						<div class="grid" id="grid"><div class="loading">Cargando...</div></div>
				</div>
		</div>
		<div class="detail" id="detail">
				<div class="detail-header">
						<button class="btn" id="detailBack">←</button>
						<div class="detail-title" id="detailTitle"></div>
						<button class="btn" id="detailClose">✕</button>
				</div>
				<div class="seasons" id="seasons"></div>
				<div class="episodes" id="episodes"></div>
		</div>
		<div class="player" id="player">
				<div class="player-header">
						<button class="btn" id="playerClose">✕</button>
						<div class="player-title" id="playerTitle"></div>
				</div>
				<div class="video-wrap"><video id="video" controls playsinline></video></div>
		</div>
</div>
<script>
(function(){
		'use strict';

		const state = {series:[],page:0,hasMore:true,loading:false,search:'',random:true,currentSeries:null,currentSeason:null};

		let pullStartY = 0;
		let pullMoveY = 0;
		let isPulling = false;
		let isRefreshing = false;
		const PULL_THRESHOLD = 80;

		function createThumb(canvas, url) {
				const ctx = canvas.getContext('2d');
				const img = new Image();
				img.crossOrigin = 'anonymous';
				const size = 16;
				canvas.width = size;
				canvas.height = size * 1.4;
				img.onload = function() { ctx.drawImage(img, 0, 0, size, size * 1.4); };
				img.src = url;
		}

		let observer = null;
		function initObserver() {
				if (!('IntersectionObserver' in window)) return;
				observer = new IntersectionObserver(function(entries) {
						entries.forEach(function(entry) {
								if (entry.isIntersecting) {
										const card = entry.target;
										const img = card.querySelector('img');
										const src = img.dataset.src;
										if (src) {
												img.src = src;
												img.onload = function() { img.classList.add('loaded'); };
												img.onerror = function() { img.classList.add('loaded'); img.style.opacity = '0.3'; };
										}
										observer.unobserve(card);
								}
						});
				}, { rootMargin: '200px', threshold: 0.01 });
		}

		function esc(s) { return s ? String(s).replace(/[<>"'&]/g, c => ({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','&':'&amp;'}[c])) : ''; }
		function debounce(fn, ms) { let t; return function() { clearTimeout(t); t = setTimeout(() => fn.apply(this, arguments), ms); }; }
		function fetchJSON(url) { return fetch(url).then(r => r.ok ? r.json() : Promise.reject(r.status)); }

		// ========================================
		// NAVEGACIÓN CON HISTORIAL (BACK BUTTON)
		// ========================================
		function pushState(view) {
				history.pushState({ view: view }, '', '#' + view);
		}

		function handleBackButton() {
				const player = document.getElementById('player');
				const detail = document.getElementById('detail');
				const video = document.getElementById('video');

				// Prioridad: Player > Detail > Salir
				if (player.classList.contains('active')) {
						video.pause();
						video.src = '';
						player.classList.remove('active');
						return true; // Manejado
				}

				if (detail.classList.contains('active')) {
						detail.classList.remove('active');
						state.currentSeries = null;
						state.currentSeason = null;
						return true; // Manejado
				}

				// Si estamos en la pantalla principal, permitir salir
				return false;
		}

		// Escuchar evento popstate (botón back del navegador/app)
		window.addEventListener('popstate', function(e) {
				const handled = handleBackButton();
				if (!handled) {
						// Permitir navegación hacia atrás (salir al menú de la app)
						// Media App Creator manejará esto
				}
		});

		// Agregar estado inicial al historial
		if (!location.hash) {
				history.replaceState({ view: 'home' }, '', '#home');
		}

		document.addEventListener('DOMContentLoaded', function() {
				initObserver();

				const $ = id => document.getElementById(id);
				const grid = $('grid'), content = $('content'), search = $('search'), stats = $('stats');
				const detail = $('detail'), detailBack = $('detailBack'), detailClose = $('detailClose'), detailTitle = $('detailTitle');
				const seasons = $('seasons'), episodes = $('episodes');
				const player = $('player'), playerClose = $('playerClose'), playerTitle = $('playerTitle'), video = $('video');
				const pullIndicator = $('pullIndicator');
				const pullIcon = pullIndicator.querySelector('.pull-icon');
				const pullText = pullIndicator.querySelector('.pull-text');

				fetchJSON('/api/stats').then(d => { stats.textContent = d.series + ' series'; }).catch(() => {});

				// Pull to refresh
				function handleTouchStart(e) {
						if (content.scrollTop <= 0 && !isRefreshing) {
								pullStartY = e.touches[0].clientY;
								isPulling = true;
								pullIndicator.classList.add('pulling');
						}
				}

				function handleTouchMove(e) {
						if (!isPulling || isRefreshing) return;
						pullMoveY = e.touches[0].clientY - pullStartY;
						if (pullMoveY > 0 && content.scrollTop <= 0) {
								e.preventDefault();
								const resistance = 0.4;
								const height = Math.min(pullMoveY * resistance, PULL_THRESHOLD + 20);
								pullIndicator.style.height = height + 'px';
								const rotation = Math.min((height / PULL_THRESHOLD) * 360, 360);
								pullIcon.style.transform = 'rotate(' + rotation + 'deg)';
								if (height >= PULL_THRESHOLD) {
										pullText.textContent = '¡Suelta para mezclar!';
										pullIcon.textContent = '🎲';
								} else {
										pullText.textContent = 'Desliza para mezclar';
										pullIcon.textContent = '↓';
								}
						}
				}

				function handleTouchEnd() {
						if (!isPulling) return;
						pullIndicator.classList.remove('pulling');
						const pullDistance = parseFloat(pullIndicator.style.height) || 0;
						if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
								isRefreshing = true;
								pullIndicator.classList.add('refreshing');
								pullIndicator.style.height = '';
								pullIcon.textContent = '🎲';
								pullIcon.style.transform = '';
								pullText.textContent = 'Mezclando...';
								state.random = true;
								state.search = '';
								search.value = '';
								load(false).finally(function() {
										setTimeout(function() {
												isRefreshing = false;
												pullIndicator.classList.remove('refreshing');
										}, 300);
								});
						} else {
								pullIndicator.style.height = '0';
								pullIcon.style.transform = '';
						}
						isPulling = false;
						pullStartY = 0;
						pullMoveY = 0;
				}

				content.addEventListener('touchstart', handleTouchStart, { passive: true });
				content.addEventListener('touchmove', handleTouchMove, { passive: false });
				content.addEventListener('touchend', handleTouchEnd, { passive: true });

				// Cargar series
				function load(append) {
						if (state.loading || (append && !state.hasMore)) return Promise.resolve();
						state.loading = true;
						if (!append) { grid.innerHTML = '<div class="loading">Cargando...</div>'; state.page = 0; state.hasMore = true; }

						let url = '/api/series?page=' + state.page + '&limit=48&random=' + state.random;
						if (state.search) url += '&q=' + encodeURIComponent(state.search);

						return fetchJSON(url).then(function(data) {
								if (!append) grid.innerHTML = '';
								if (!data.data.length && !append) { grid.innerHTML = '<div class="empty">Sin resultados</div>'; return; }

								data.data.forEach(function(s) {
										const card = document.createElement('div');
										card.className = 'card';
										let posterUrl = s.poster || '';
										card.innerHTML = 
												'<div class="card-img">' +
														'<canvas></canvas>' +
														'<img data-src="' + esc(posterUrl) + '" alt="">' +
												'</div>' +
												'<div class="card-info">' +
														'<div class="card-title">' + esc(s.name) + '</div>' +
														'<div class="card-meta">T' + s.seasons + ' · ' + s.count + '</div>' +
												'</div>';
										const canvas = card.querySelector('canvas');
										if (posterUrl) createThumb(canvas, posterUrl);
										if (observer) observer.observe(card);
										card.onclick = function() { openDetail(s.name); };
										grid.appendChild(card);
								});
								state.page++;
								state.hasMore = data.hasMore;
						}).catch(function() {
								if (!append) grid.innerHTML = '<div class="empty">Error</div>';
						}).finally(function() {
								state.loading = false;
						});
				}

				// Abrir detalle (con push al historial)
				function openDetail(name) {
						pushState('detail'); // Agregar al historial
						detailTitle.textContent = name;
						detail.classList.add('active');
						seasons.innerHTML = '<div class="loading"></div>';
						episodes.innerHTML = '';

						fetchJSON('/api/series/' + encodeURIComponent(name)).then(function(r) {
								state.currentSeries = r.data;
								const keys = Object.keys(r.data.seasons).sort((a,b) => a-b);
								state.currentSeason = keys[0];
								seasons.innerHTML = '';
								keys.forEach(function(k) {
										const btn = document.createElement('button');
										btn.className = 'season-btn' + (k === state.currentSeason ? ' active' : '');
										btn.textContent = 'T' + k;
										btn.onclick = function() {
												state.currentSeason = k;
												seasons.querySelectorAll('.season-btn').forEach(b => b.classList.toggle('active', b.textContent === 'T'+k));
												renderEps();
										};
										seasons.appendChild(btn);
								});
								renderEps();
						}).catch(function() { seasons.innerHTML = '<div class="empty">Error</div>'; });
				}

				function renderEps() {
						const eps = state.currentSeries?.seasons[state.currentSeason] || [];
						if (!eps.length) { episodes.innerHTML = '<div class="empty">Sin episodios</div>'; return; }
						episodes.innerHTML = '';
						eps.forEach(function(e) {
								const div = document.createElement('div');
								div.className = 'episode';
								div.innerHTML = '<div class="ep-num">' + e.ep + '</div><div><div class="ep-title">' + esc(e.title) + '</div><div class="ep-meta">T' + state.currentSeason + ' E' + e.ep + '</div></div>';
								div.onclick = function() { if (e.url) playVideo(e); };
								episodes.appendChild(div);
						});
				}

				// Reproducir video (con push al historial)
				function playVideo(e) {
						pushState('player'); // Agregar al historial
						let url = e.url;
						if (url.startsWith('http://')) url = '/video-proxy?url=' + encodeURIComponent(url);
						video.src = url;
						playerTitle.textContent = e.title;
						player.classList.add('active');
						video.play().catch(() => {});
				}

				function closeDetail() {
						detail.classList.remove('active');
						state.currentSeries = null;
						state.currentSeason = null;
						// Volver en historial si es necesario
						if (location.hash === '#detail') {
								history.back();
						}
				}

				function closePlayer() {
						video.pause();
						video.src = '';
						player.classList.remove('active');
						// Volver en historial si es necesario
						if (location.hash === '#player') {
								history.back();
						}
				}

				detailBack.onclick = function() { history.back(); };
				detailClose.onclick = function() { history.back(); };
				playerClose.onclick = function() { history.back(); };

				search.oninput = debounce(function() {
						state.search = search.value.trim();
						state.random = !state.search;
						load(false);
				}, 300);

				content.onscroll = function() {
						if (content.scrollTop + content.clientHeight >= content.scrollHeight - 400) load(true);
				};

				// Tecla Escape (para desktop)
				document.onkeydown = function(e) {
						if (e.key === 'Escape') {
								history.back();
						}
				};

				// Cargar inicial
				load(false);
		});
})();
</script>
</body>
</html>`;

app.get('/', (req, res) => {
		res.setHeader('Content-Type', 'text/html');
		res.send(HTML);
});

app.get('/health', (req, res) => {
		res.json({ status: 'ok', series: SERIES_LIST.length, episodes: TOTAL_EPISODES });
});

app.use((req, res) => {
		res.status(404).json({ status: 'error', message: 'Not found' });
});

app.listen(PORT, '0.0.0.0', () => {
		console.log('');
		console.log('══════════════════════════════════════');
		console.log('  🎬 STREAM SERIES');
		console.log('  🔗 http://localhost:' + PORT);
		console.log('  📊 ' + SERIES_LIST.length + ' series | ' + TOTAL_EPISODES + ' eps');
		console.log('  🎲 Pull down to shuffle!');
		console.log('  📱 Back button supported!');
		console.log('══════════════════════════════════════');
});
});
