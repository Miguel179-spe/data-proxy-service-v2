const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;
let MOVIES = [];

try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, process.env.DATA_FILE || 'data.json'), 'utf8'));
    MOVIES = data.map((m, i) => ({ id: i, title: m.title || 'Sin título', poster: m.logo || '', url: m.url || '' }));
    console.log(`✓ ${MOVIES.length} películas`);
} catch (e) { console.error('Error:', e.message); }

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range,Accept-Ranges,Content-Length');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

app.get('/api/movies', (req, res) => {
    const { page = 0, limit = 200, q = '', random } = req.query;
    let list = q ? MOVIES.filter(m => m.title.toLowerCase().includes(q.toLowerCase())) : [...MOVIES];
    if (random === 'true') list.sort(() => Math.random() - 0.5);
    const start = page * limit;
    res.json({ total: list.length, hasMore: start + +limit < list.length, data: list.slice(start, start + +limit) });
});

app.get('/video-proxy', (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).end();
    let parsed;
    try { parsed = new URL(decodeURIComponent(url)); } catch { return res.status(400).end(); }
    const client = parsed.protocol === 'https:' ? https : http;
    const headers = { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*', 'Accept-Encoding': 'identity', 'Referer': parsed.origin + '/' };
    if (req.headers.range) headers['Range'] = req.headers.range;
    const proxyReq = client.request({ hostname: parsed.hostname, port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80), path: parsed.pathname + parsed.search, headers, timeout: 30000 }, proxyRes => {
        if ([301, 302, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
            proxyRes.destroy();
            return res.redirect(307, '/video-proxy?url=' + encodeURIComponent(proxyRes.headers.location));
        }
        const h = { 'Content-Type': proxyRes.headers['content-type'] || 'video/mp4', 'Accept-Ranges': 'bytes' };
        if (proxyRes.headers['content-length']) h['Content-Length'] = proxyRes.headers['content-length'];
        if (proxyRes.headers['content-range']) h['Content-Range'] = proxyRes.headers['content-range'];
        res.writeHead(proxyRes.statusCode, h);
        proxyRes.pipe(res);
        proxyRes.on('error', () => res.end());
    });
    proxyReq.on('error', () => !res.headersSent && res.status(502).end());
    proxyReq.on('timeout', () => { proxyReq.destroy(); !res.headersSent && res.status(504).end(); });
    req.on('close', () => proxyReq.destroy());
    proxyReq.end();
});

app.get('/', (req, res) => res.send(`<!DOCTYPE html><html lang="es"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Movies+</title><style>
*{margin:0;padding:0;box-sizing:border-box;user-select:none;-webkit-tap-highlight-color:transparent}
:root{--p:#f5c518;--bg:#0a0a0a;--s:#161616;--c:#1a1a1a;--b:#2a2a2a;--t:#e0e0e0;--t2:#888}
html,body{background:var(--bg);color:var(--t);font-family:system-ui,sans-serif;height:100%;overflow:hidden}
#app{height:100%;display:flex;flex-direction:column}
.hdr{display:flex;align-items:center;gap:10px;padding:12px;background:var(--s);border-bottom:1px solid var(--b)}
.logo{color:var(--p);font-weight:700;font-size:18px}
.srch{flex:1;background:var(--bg);border:2px solid var(--b);color:var(--t);padding:10px;border-radius:8px;font-size:16px;outline:none}
.srch:focus,.srch.f{border-color:var(--p)}
.btn{background:var(--c);border:2px solid var(--b);color:var(--t);padding:10px 16px;border-radius:8px;font-weight:600;cursor:pointer}
.btn:hover,.btn.f{background:var(--p);color:#000;border-color:var(--p)}
.stats{color:var(--t2);font-size:12px}
.main{flex:1;overflow-y:auto;padding:10px;-webkit-overflow-scrolling:touch}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px}
.card{position:relative;aspect-ratio:2/3;background:var(--c);border-radius:6px;overflow:hidden;border:2px solid transparent;cursor:pointer}
.card.f{border-color:var(--p);box-shadow:0 0 15px rgba(245,197,24,.3);z-index:10}
.card img{width:100%;height:100%;object-fit:cover;background:linear-gradient(45deg,#1a1a1a 25%,#222 25%,#222 50%,#1a1a1a 50%,#1a1a1a 75%,#222 75%,#222);background-size:20px 20px}
.card-t{position:absolute;bottom:0;left:0;right:0;padding:20px 6px 6px;background:linear-gradient(transparent,#000);font-size:11px;font-weight:600;opacity:0}
.card.f .card-t{opacity:1}
.player{position:fixed;inset:0;background:#000;z-index:200;display:none}
.player.open{display:flex;flex-direction:column}
video{flex:1;width:100%;background:#000}
.p-ui{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:space-between;opacity:1;transition:.2s;background:linear-gradient(#000a,transparent 15%,transparent 85%,#000a);pointer-events:none}
.p-ui>*{pointer-events:auto}.p-ui.hide{opacity:0}.p-ui.hide>*{pointer-events:none}
.p-top{padding:12px;padding-top:max(12px,env(safe-area-inset-top))}
.p-title{font-size:14px;font-weight:600}
.p-center{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:40px;font-weight:700;opacity:0;transition:.15s;pointer-events:none}
.p-center.show{opacity:1}
.p-bottom{padding:12px;padding-bottom:max(12px,env(safe-area-inset-bottom))}
.p-prog{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.p-time{font-size:12px;min-width:45px}
.p-bar{flex:1;height:5px;background:#444;border-radius:3px;position:relative;cursor:pointer}
.p-bar-fill{position:absolute;left:0;top:0;height:100%;background:var(--p);border-radius:3px}
.p-bar-buf{position:absolute;left:0;top:0;height:100%;background:#666;border-radius:3px;z-index:-1}
.p-ctrl{display:flex;justify-content:center;gap:10px}
.p-btn{width:44px;height:44px;background:rgba(255,255,255,.1);border:none;border-radius:50%;color:#fff;font-size:13px;font-weight:700;cursor:pointer}
.p-btn:hover,.p-btn:active,.p-btn.f{background:var(--p);color:#000}
.p-btn.main{width:52px;height:52px;font-size:18px}
.p-load,.p-err{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;display:none}
.p-load.show,.p-err.show{display:block}
.p-spin{width:36px;height:36px;border:3px solid #333;border-top-color:var(--p);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 10px}
.msg{text-align:center;padding:40px;color:var(--t2)}
.msg.load::after{content:'';display:block;width:20px;height:20px;margin:12px auto 0;border:2px solid #333;border-top-color:var(--p);border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body><div id="app">
<div class="hdr"><div class="logo">MOVIES+</div><input class="srch" id="srch" placeholder="Buscar..."><button class="btn" id="mix">🎲</button><span class="stats" id="stats"></span></div>
<div class="main" id="main"><div class="grid" id="grid"><div class="msg load">Cargando</div></div></div>
<div class="player" id="player">
<video id="vid" playsinline webkit-playsinline></video>
<div class="p-load" id="pLoad"><div class="p-spin"></div><div id="pLoadTxt">Cargando...</div></div>
<div class="p-err" id="pErr"><div>Error</div><div style="font-size:11px;color:#888;margin:8px 0" id="pErrTxt"></div><button class="btn" id="pRetry">Reintentar</button> <button class="btn" id="pBack">Volver</button></div>
<div class="p-center" id="pInd"></div>
<div class="p-ui" id="pUi">
<div class="p-top"><div class="p-title" id="pTitle"></div></div>
<div class="p-bottom">
<div class="p-prog"><span class="p-time" id="pCur">0:00</span><div class="p-bar" id="pBar"><div class="p-bar-buf" id="pBuf"></div><div class="p-bar-fill" id="pFill"></div></div><span class="p-time" id="pDur">0:00</span></div>
<div class="p-ctrl"><button class="p-btn" id="pRw">-10</button><button class="p-btn main" id="pPp">▶</button><button class="p-btn" id="pFw">+10</button></div>
</div></div></div></div>
<script>
(function(){
const $=id=>document.getElementById(id);
const el={grid:$('grid'),main:$('main'),srch:$('srch'),mix:$('mix'),stats:$('stats'),player:$('player'),vid:$('vid'),pUi:$('pUi'),pTitle:$('pTitle'),pLoad:$('pLoad'),pLoadTxt:$('pLoadTxt'),pErr:$('pErr'),pErrTxt:$('pErrTxt'),pInd:$('pInd'),pBar:$('pBar'),pFill:$('pFill'),pBuf:$('pBuf'),pCur:$('pCur'),pDur:$('pDur'),pRw:$('pRw'),pPp:$('pPp'),pFw:$('pFw'),pRetry:$('pRetry'),pBack:$('pBack')};
const S={
    view:'home',movies:[],focus:null,lastFocus:null,playing:false,retry:0,
    imgObserver:null,gridCols:0,currentIndex:0
};

history.replaceState({v:'home'},'','#home');
window.onpopstate=()=>{if(S.view==='player'){closeP();history.pushState({v:'home'},'','#home')}};

// ===== INICIALIZACIÓN =====
function init() {
    fetch('/api/movies?limit=200&random=true').then(r=>r.json()).then(d=>{
        el.stats.textContent=d.total+' películas';
        el.grid.innerHTML='';
        S.movies=d.data;
        d.data.forEach(m=>el.grid.appendChild(mkCard(m)));

        // Calcular columnas del grid
        calculateGridColumns();

        // Inicializar lazy loading
        initLazyLoading();

        // Enfocar primera card
        setTimeout(()=>{
            const cards = getCards();
            if(cards.length>0){
                setFocus(0);
            }
        }, 50);
    }).catch(()=>el.grid.innerHTML='<div class="msg">Error</div>');
}

// ===== LAZY LOADING OPTIMIZADO =====
function initLazyLoading() {
    if(S.imgObserver) S.imgObserver.disconnect();

    S.imgObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if(entry.isIntersecting){
                const img = entry.target;
                loadImage(img);
                S.imgObserver.unobserve(img);
            }
        });
    }, {
        rootMargin: '200px 0px', // Cargar antes de que entren al viewport
        threshold: 0.01
    });

    // Observar todas las imágenes
    document.querySelectorAll('.card img[data-src]').forEach(img => {
        S.imgObserver.observe(img);
    });
}

// Cargar imagen con prioridad
function loadImage(img) {
    if(!img.dataset.src) return;

    const src = img.dataset.src;
    const imgEl = new Image();

    imgEl.onload = () => {
        img.src = src;
        img.style.background = 'none'; // Quitar placeholder
    };

    imgEl.onerror = () => {
        // Usar placeholder de error
        img.src = 'data:image/svg+xml;base64,' + btoa(
            '<svg xmlns="http://www.w3.org/2000/svg" width="130" height="195" viewBox="0 0 130 195">' +
            '<rect width="130" height="195" fill="#1a1a1a"/>' +
            '<text x="65" y="95" font-family="Arial" font-size="12" fill="#888" text-anchor="middle">Sin imagen</text>' +
            '</svg>'
        );
        img.style.background = 'none';
    };

    imgEl.src = src;
}

// Pre-cargar imágenes adyacentes al elemento enfocado
function preloadAdjacentImages(index) {
    const cards = getCards();
    if(!cards.length) return;

    const indices = [
        index, // Elemento actual
        index - 1, // Izquierda
        index + 1, // Derecha
        index - S.gridCols, // Arriba
        index + S.gridCols // Abajo
    ];

    indices.forEach(i => {
        if(i >= 0 && i < cards.length) {
            const img = cards[i].querySelector('img[data-src]');
            if(img && img.dataset.src && !img.src) {
                loadImage(img);
            }
        }
    });
}

// ===== CÁLCULO DE COLUMNAS DEL GRID =====
function calculateGridColumns() {
    const grid = el.grid;
    if(!grid || !grid.children.length) {
        S.gridCols = 0;
        return;
    }

    const firstCard = grid.children[0];
    if(!firstCard) {
        S.gridCols = 0;
        return;
    }

    const cardStyle = window.getComputedStyle(firstCard);
    const gridStyle = window.getComputedStyle(grid);

    const cardWidth = firstCard.offsetWidth + 
                     parseInt(cardStyle.marginLeft || 0) + 
                     parseInt(cardStyle.marginRight || 0);

    const gridWidth = grid.offsetWidth - 
                     parseInt(gridStyle.paddingLeft || 0) - 
                     parseInt(gridStyle.paddingRight || 0);

    const gap = parseInt(gridStyle.gap || 0);

    if(cardWidth <= 0) {
        // Fallback: contar columnas visualmente
        const rect1 = firstCard.getBoundingClientRect();
        let cols = 1;

        for(let i = 1; i < grid.children.length; i++) {
            const rect2 = grid.children[i].getBoundingClientRect();
            if(Math.abs(rect2.top - rect1.top) < 10) {
                cols++;
            } else {
                break;
            }
        }

        S.gridCols = cols;
    } else {
        // Cálculo preciso
        S.gridCols = Math.floor((gridWidth + gap) / (cardWidth + gap));
    }

    // Mínimo 1 columna
    S.gridCols = Math.max(1, S.gridCols);
}

// Recalcular columnas cuando cambie el tamaño
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        calculateGridColumns();
    }, 100);
});

// ===== NAVEGACIÓN POR ÍNDICES (MÁS RÁPIDA) =====
function getCards() {
    return [...el.grid.querySelectorAll('.card')];
}

function setFocus(index) {
    const cards = getCards();
    if(index < 0 || index >= cards.length) return;

    // Remover focus anterior
    if(S.focus) S.focus.classList.remove('f');

    // Actualizar estado
    S.currentIndex = index;
    S.focus = cards[index];

    // Aplicar focus
    cards[index].classList.add('f');

    // Scroll instantáneo (sin animación)
    const card = cards[index];
    const mainRect = el.main.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();

    // Solo hacer scroll si el elemento no es visible
    if(cardRect.top < mainRect.top || cardRect.bottom > mainRect.bottom) {
        // Scroll instantáneo
        card.scrollIntoView({block: 'nearest', behavior: 'instant'});
    }

    // Pre-cargar imágenes adyacentes
    preloadAdjacentImages(index);
}

// Encontrar siguiente elemento basado en dirección
function findNextIndex(direction) {
    const cards = getCards();
    if(!cards.length) return -1;

    const total = cards.length;
    let newIndex = S.currentIndex;

    switch(direction) {
        case 'up':
            newIndex = Math.max(0, S.currentIndex - S.gridCols);
            break;
        case 'down':
            newIndex = Math.min(total - 1, S.currentIndex + S.gridCols);
            break;
        case 'left':
            // Si no es primera columna
            if(S.currentIndex % S.gridCols !== 0) {
                newIndex = S.currentIndex - 1;
            }
            break;
        case 'right':
            // Si no es última columna
            if((S.currentIndex + 1) % S.gridCols !== 0) {
                newIndex = Math.min(total - 1, S.currentIndex + 1);
            }
            break;
    }

    return newIndex !== S.currentIndex ? newIndex : -1;
}

// ===== MANEJO DE TECLADO OPTIMIZADO =====
document.onkeydown = e => {
    const k = e.key;

    // Prevenir comportamiento por defecto para teclas de navegación
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter',' ','Escape','Backspace'].includes(k)){
        e.preventDefault();
        e.stopPropagation();
    }

    if(S.view === 'player'){
        playerKey(k);
        return;
    }

    nav(k);
};

function nav(k) {
    const cards = getCards();
    if(!cards.length) return;

    // Recalcular columnas si es necesario
    if(S.gridCols === 0) calculateGridColumns();

    // Activar elemento seleccionado
    if(k === 'Enter' || k === ' ') {
        if(S.focus === el.srch){
            el.srch.focus();
            return;
        }
        if(S.focus === el.mix){
            loadMovies(true);
            return;
        }
        if(S.focus && S.focus.classList.contains('card')) {
            const idx = cards.indexOf(S.focus);
            if(idx >= 0 && S.movies[idx]) play(S.movies[idx]);
        }
        return;
    }

    // Escape para limpiar búsqueda
    if(k === 'Escape') {
        if(el.srch.value.trim()) {
            el.srch.value = '';
            loadMovies(false);
        }
        return;
    }

    // Navegación desde header
    const inHeader = S.focus === el.srch || S.focus === el.mix;
    const isCard = S.focus && S.focus.classList.contains('card');

    if(inHeader) {
        if(k === 'ArrowRight' && S.focus === el.srch) {
            el.mix.focus();
            el.mix.classList.add('f');
            el.srch.classList.remove('f');
            S.focus = el.mix;
        }
        else if(k === 'ArrowLeft' && S.focus === el.mix) {
            el.srch.focus();
            el.srch.classList.add('f');
            el.mix.classList.remove('f');
            S.focus = el.srch;
        }
        else if(k === 'ArrowDown') {
            setFocus(0);
        }
        return;
    }

    // Si no hay focus o focus inválido, enfocar primera card
    if(!isCard) {
        setFocus(0);
        return;
    }

    // Navegación en grid
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(k)) {
        const newIndex = findNextIndex(k.toLowerCase().replace('arrow', ''));
        if(newIndex >= 0) {
            setFocus(newIndex);
        }
    }
}

// ===== BÚSQUEDA Y CARGA DE PELÍCULAS =====
let searchTimer;
el.srch.oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadMovies(false), 300);
};

el.mix.onclick = () => loadMovies(true);

el.srch.addEventListener('focus', () => {
    el.srch.classList.add('f');
    if(S.focus && S.focus.classList) S.focus.classList.remove('f');
    S.focus = el.srch;
});

el.srch.addEventListener('blur', () => {
    el.srch.classList.remove('f');
});

function loadMovies(random) {
    el.grid.innerHTML = '<div class="msg load">Cargando</div>';
    const q = el.srch.value.trim();
    fetch('/api/movies?limit=200' + (q ? '&q=' + encodeURIComponent(q) : '') + (random ? '&random=true' : ''))
        .then(r => r.json())
        .then(d => {
            el.grid.innerHTML = '';
            S.movies = d.data;
            S.currentIndex = 0;

            // Crear cards
            d.data.forEach(m => el.grid.appendChild(mkCard(m)));

            // Recalcular columnas
            calculateGridColumns();

            // Reinicializar lazy loading
            setTimeout(() => {
                initLazyLoading();

                // Enfocar primera card
                const cards = getCards();
                if(cards.length > 0) {
                    setFocus(0);
                }
            }, 0);
        })
        .catch(() => el.grid.innerHTML = '<div class="msg">Error</div>');
}

function mkCard(m) {
    const d = document.createElement('div');
    d.className = 'card';
    d.tabIndex = -1;

    // Usar data-src para lazy loading
    const posterSrc = m.poster || '';
    d.innerHTML = '<img data-src="' + esc(posterSrc) + '" alt="' + esc(m.title) + '">' +
                  '<div class="card-t">' + esc(m.title) + '</div>';

    d.onclick = () => {
        const idx = [...el.grid.querySelectorAll('.card')].indexOf(d);
        if(idx >= 0 && S.movies[idx]) play(S.movies[idx]);
    };

    return d;
}

// ===== REPRODUCTOR (sin cambios) =====
function play(m) {
    S.lastFocus = S.focus;
    S.view = 'player';
    S.retry = 0;
    history.pushState({v:'player'},'','#player');
    el.pErr.classList.remove('show');
    el.pLoad.classList.add('show');
    el.pLoadTxt.textContent = 'Conectando...';
    el.pTitle.textContent = m.title;
    el.player.classList.add('open');
    el.vid.pause();
    el.vid.removeAttribute('src');
    el.vid.load();

    setTimeout(() => {
        let u = m.url;
        if(u.startsWith('http://') || location.protocol === 'https:') {
            u = '/video-proxy?url=' + encodeURIComponent(u);
        }
        el.vid.src = u;
        el.vid.play().catch(playErr);
        showUI();
    }, 50);
}

function closeP() {
    el.vid.pause();
    el.vid.removeAttribute('src');
    el.vid.load();
    el.player.classList.remove('open');
    S.view = 'home';

    setTimeout(() => {
        const cards = getCards();
        if(cards.length > 0) {
            // Restaurar focus a la última posición o primera
            const targetIndex = S.currentIndex >= 0 && S.currentIndex < cards.length ? S.currentIndex : 0;
            setFocus(targetIndex);
        }
    }, 50);
}

el.vid.onloadstart = () => {
    el.pLoad.classList.add('show');
    el.pErr.classList.remove('show');
    el.pLoadTxt.textContent = 'Conectando...';
};

el.vid.oncanplay = () => {
    el.pLoad.classList.remove('show');
    S.retry = 0;
};

el.vid.onwaiting = () => {
    el.pLoad.classList.add('show');
    el.pLoadTxt.textContent = 'Buffering...';
};

el.vid.onplaying = () => {
    el.pLoad.classList.remove('show');
    S.playing = true;
    el.pPp.textContent = '⏸';
};

el.vid.onpause = () => {
    S.playing = false;
    el.pPp.textContent = '▶';
};

el.vid.ontimeupdate = () => {
    if(!el.vid.duration) return;
    el.pFill.style.width = (el.vid.currentTime / el.vid.duration * 100) + '%';
    el.pCur.textContent = fmt(el.vid.currentTime);
};

el.vid.ondurationchange = () => el.pDur.textContent = fmt(el.vid.duration);

el.vid.onprogress = () => {
    try {
        if(el.vid.buffered.length) {
            el.pBuf.style.width = (el.vid.buffered.end(el.vid.buffered.length - 1) / el.vid.duration * 100) + '%';
        }
    } catch(e) {}
};

el.vid.onerror = () => {
    const err = el.vid.error;
    el.pErrTxt.textContent = err ? ['','Abortado','Red','Decode','No soportado'][err.code] || 'Error' : 'Error';
    if(err && err.code === 2 && S.retry < 2) {
        S.retry++;
        el.pLoadTxt.textContent = 'Reintentando...';
        setTimeout(retry, 1500);
    } else {
        el.pLoad.classList.remove('show');
        el.pErr.classList.add('show');
    }
};

el.vid.onended = () => {
    S.playing = false;
    el.pPp.textContent = '▶';
    showUI();
};

function playErr(e) {
    if(e.name === 'NotAllowedError') showUI();
    else if(e.name === 'NotSupportedError') {
        el.pErrTxt.textContent = 'No soportado';
        el.pErr.classList.add('show');
        el.pLoad.classList.remove('show');
    }
}

function retry() {
    el.pErr.classList.remove('show');
    el.pLoad.classList.add('show');
    const t = el.vid.currentTime || 0;
    el.vid.pause();
    el.vid.load();
    setTimeout(() => {
        el.vid.currentTime = t;
        el.vid.play().catch(playErr);
    }, 300);
}

function playerKey(k) {
    showUI();
    if(k === 'ArrowLeft') seek(-10);
    else if(k === 'ArrowRight') seek(10);
    else if(k === 'ArrowUp') vol(.1);
    else if(k === 'ArrowDown') vol(-.1);
    else if(k === 'Enter' || k === ' ') toggle();
    else if(k === 'Escape' || k === 'Backspace') history.back();
}

function toggle() {
    if(el.vid.paused) {
        el.vid.play().catch(playErr);
        showInd('▶');
    } else {
        el.vid.pause();
        showInd('⏸');
    }
}

function seek(s) {
    if(!el.vid.duration) return;
    el.vid.currentTime = Math.max(0, Math.min(el.vid.currentTime + s, el.vid.duration));
    showInd((s > 0 ? '+' : '') + s + 's');
}

function vol(d) {
    try {
        el.vid.volume = Math.max(0, Math.min(1, el.vid.volume + d));
    } catch(e) {}
}

let hideT, indT;
function showInd(t) {
    el.pInd.textContent = t;
    el.pInd.classList.add('show');
    clearTimeout(indT);
    indT = setTimeout(() => el.pInd.classList.remove('show'), 500);
}

function showUI() {
    el.pUi.classList.remove('hide');
    clearTimeout(hideT);
    hideT = setTimeout(() => {
        if(S.playing) el.pUi.classList.add('hide');
    }, 3000);
}

function fmt(s) {
    if(!s || !isFinite(s)) return '0:00';
    const h = ~~(s / 3600);
    const m = ~~(s % 3600 / 60);
    const ss = ~~(s % 60);
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0') : m + ':' + String(ss).padStart(2, '0');
}

// Eventos del reproductor
el.pPp.onclick = toggle;
el.pRw.onclick = () => seek(-10);
el.pFw.onclick = () => seek(10);
el.pBar.onclick = e => {
    const r = el.pBar.getBoundingClientRect();
    if(el.vid.duration) el.vid.currentTime = (e.clientX - r.left) / r.width * el.vid.duration;
};
el.pRetry.onclick = retry;
el.pBack.onclick = () => history.back();
el.player.onclick = e => {
    if(e.target === el.vid) {
        toggle();
        showUI();
    }
};
el.player.onmousemove = showUI;

let tx, ty;
el.vid.ontouchstart = e => {
    tx = e.touches[0].clientX;
    ty = e.touches[0].clientY;
};
el.vid.ontouchend = e => {
    const dx = e.changedTouches[0].clientX - tx;
    const dy = e.changedTouches[0].clientY - ty;
    if(Math.abs(dx) > 50 && Math.abs(dy) < 50) seek(dx > 0 ? 10 : -10);
    else showUI();
};
el.pBar.ontouchstart = el.pBar.ontouchmove = e => {
    e.preventDefault();
    const r = el.pBar.getBoundingClientRect();
    if(el.vid.duration) {
        el.vid.currentTime = Math.max(0, Math.min(1, (e.touches[0].clientX - r.left) / r.width)) * el.vid.duration;
    }
};

function esc(s) {
    return s ? String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]) : '';
}

// Iniciar aplicación
init();
})();
</script></body></html>`));

app.listen(PORT,'0.0.0.0',()=>console.log('🎬 Movies+ → Puerto '+PORT+' | '+MOVIES.length+' películas'));
