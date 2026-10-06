/* App — orquestra a interface: roteamento, explorador, editor, terminal, painéis do Git,
   desafios, dashboard e ranking. Conecta Git Engine, Terminal, Challenges e Gamification. */

(function () {
  'use strict';

  /* ================================================================
     Utilidades
  ================================================================ */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LANE_COLORS = ['#3ddc97', '#4cc9f0', '#a78bfa', '#ffc857', '#ff6b81', '#58a6ff'];

  function toast(msg, { type = 'info', icon = '', ms = 3600 } = {}) {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.innerHTML = `${icon ? `<span class="t-ic">${icon}</span>` : ''}<span>${msg}</span>`;
    $('#toasts').appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 320); }, ms);
  }

  let modalEl = null;
  function openModal(html, { cls = '', onClose = null } = {}) {
    closeModal();
    const ov = document.createElement('div');
    ov.className = 'modal-ov';
    ov.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
    $('#modal-root').appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('in'));
    ov.addEventListener('mousedown', e => { if (e.target === ov) closeModal(); });
    ov._onClose = onClose;
    modalEl = ov;
    const first = $('input, textarea', ov);
    if (first) setTimeout(() => first.focus(), 60);
    return ov;
  }
  function closeModal() {
    if (!modalEl) return;
    const m = modalEl; modalEl = null;
    m.classList.remove('in');
    setTimeout(() => m.remove(), 200);
    if (m._onClose) m._onClose();
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  function confirmModal({ title, text, ok = 'Confirmar', danger = false, onOk }) {
    const m = openModal(`<h3>${title}</h3><p class="muted">${text}</p><div class="modal-actions"><button class="btn ghost" data-x>Cancelar</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${ok}</button></div>`);
    $('[data-x]', m).onclick = closeModal;
    $('[data-ok]', m).onclick = () => { closeModal(); onOk(); };
  }
  function promptModal({ title, label, placeholder = '', ok = 'Criar', onSubmit }) {
    const m = openModal(`<h3>${title}</h3><label class="field"><span>${label}</span><input type="text" id="pm-input" placeholder="${esc(placeholder)}" spellcheck="false" autocomplete="off"></label><div class="modal-actions"><button class="btn ghost" data-x>Cancelar</button><button class="btn primary" data-ok>${ok}</button></div>`);
    const input = $('#pm-input', m);
    const go = () => { const v = input.value.trim(); if (!v) return; closeModal(); onSubmit(v); };
    $('[data-x]', m).onclick = closeModal;
    $('[data-ok]', m).onclick = go;
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }

  function confetti() {
    const fx = $('#fx'), colors = [...LANE_COLORS, '#ffffff'];
    for (let i = 0; i < 120; i++) {
      const p = document.createElement('i');
      p.className = 'cf';
      p.style.cssText = `left:${Math.random() * 100}vw;background:${colors[i % colors.length]};width:${6 + Math.random() * 6}px;height:${8 + Math.random() * 10}px;border-radius:${Math.random() > .5 ? '50%' : '2px'}`;
      fx.appendChild(p);
      p.animate([
        { transform: 'translateY(-10vh) rotate(0deg)', opacity: 1 },
        { transform: `translate(${(Math.random() - .5) * 240}px, 105vh) rotate(${Math.random() * 900}deg)`, opacity: 1 }
      ], { duration: 1800 + Math.random() * 1600, delay: Math.random() * 500, easing: 'cubic-bezier(.2,.6,.4,1)' }).onfinish = () => p.remove();
    }
  }

  /* Tooltips globais (data-tip) */
  (function tooltips() {
    const tip = document.createElement('div'); tip.id = 'tip'; document.body.appendChild(tip);
    document.addEventListener('mouseover', e => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (!t) { tip.classList.remove('show'); return; }
      tip.textContent = t.getAttribute('data-tip');
      tip.classList.add('show');
      const r = t.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 8;
      if (y < 6) y = r.bottom + 8;
      x = Math.max(6, Math.min(x, window.innerWidth - tw - 6));
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    });
    document.addEventListener('mousedown', () => tip.classList.remove('show'));
    window.addEventListener('scroll', () => tip.classList.remove('show'), true);
  })();

  /* ================================================================
     Estado da aplicação
  ================================================================ */
  const A = {
    engine: null, mode: 'free', ch: null, freeState: null, term: null,
    openFile: null, tabs: [], selected: null, collapsed: new Set(),
    view: 'home', fb: [], terms: { free: null, challenge: null },
    lastCommit: null, pendingEvents: [], lastInput: Date.now(), demoTimer: null
  };

  function defaultProject() {
    const e = new GitEngine(GitEngine.blank());
    Object.entries(Challenges.SITE).forEach(([k, v]) => e.writeFile(k, v));
    return e.state;
  }

  const firstFile = e => { const f = Object.keys(e.files).sort(); return f.includes('index.html') ? 'index.html' : f[0]; };

  function attachEngine(e) {
    A.engine = e;
    e.onEvent = evt => { A.pendingEvents.push(evt); Gamification.onEngineEvent(evt); };
  }

  let persistT = null;
  function persist(now = true) {
    const run = () => {
      const ws = { mode: A.mode, openFile: A.openFile, tabs: A.tabs, collapsed: [...A.collapsed], fb: A.fb.slice(0, 8) };
      if (A.mode === 'free') { ws.free = A.engine.state; A.freeState = A.engine.state; }
      else { ws.free = A.freeState; ws.challenge = { ...A.ch, state: A.engine.state }; }
      A.terms[A.mode] = A.term.serialize();
      ws.terms = A.terms;
      Storage.set('workspace', ws);
      Gamification.save();
    };
    if (now) { clearTimeout(persistT); run(); } else { clearTimeout(persistT); persistT = setTimeout(run, 300); }
  }

  /* ================================================================
     Roteamento
  ================================================================ */
  const VIEWS = ['home', 'play', 'challenges', 'dashboard', 'ranking'];
  function go(view) { if (location.hash !== '#/' + view) location.hash = '#/' + view; else showView(view); }
  function showView(view) {
    if (!VIEWS.includes(view)) view = 'home';
    A.view = view;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    $$('#nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === view));
    document.body.dataset.view = view;
    window.scrollTo(0, 0);
    if (view === 'home') startDemo(); else stopDemo();
    if (view === 'play') { renderAll(); setTimeout(() => A.term.focus(), 80); }
    if (view === 'challenges') renderChallenges();
    if (view === 'dashboard') renderDashboard();
    if (view === 'ranking') renderRanking();
  }
  window.addEventListener('hashchange', () => showView(location.hash.replace('#/', '')));

  /* ================================================================
     Cabeçalho (XP / nível)
  ================================================================ */
  function renderHeader() {
    const lv = Gamification.level(), s = Gamification.state;
    $('#hdr-level').textContent = `Nv ${lv.level} · ${lv.title}`;
    $('#hdr-xp').textContent = `${Fmt.num(lv.into)}/${Fmt.num(lv.need)} XP`;
    $('#hdr-bar').style.width = lv.pct + '%';
    $('#hdr-streak b').textContent = s.streak;
    $('#hdr-avatar').textContent = (s.name[0] || 'A').toUpperCase();
  }

  /* ================================================================
     Explorador
  ================================================================ */
  const EXT_ICON = { html: ['‹›', 'html'], htm: ['‹›', 'html'], css: ['#', 'css'], js: ['JS', 'js'], md: ['M↓', 'md'], json: ['{}', 'json'] };
  const fileIcon = n => { const x = EXT_ICON[(n.split('.').pop() || '').toLowerCase()] || ['≡', 'txt']; return `<i class="fi ${x[1]}">${x[0]}</i>`; };
  const baseName = p => p.split('/').pop();

  function badges(st) {
    if (!st) return '';
    let h = '';
    if (st.conflict) h += '<i class="bd c" data-tip="Conflito de merge: edite o arquivo, depois git add">!</i>';
    if (st.untracked) h += '<i class="bd u" data-tip="Novo arquivo — o Git ainda não rastreia (git add para incluir)">U</i>';
    if (st.staged) {
      const lbl = { 'new file': 'novo arquivo', modified: 'modificado', deleted: 'removido' }[st.staged];
      h += `<i class="bd s" data-tip="Na Staging Area (${lbl}) — pronto para o próximo commit">${st.staged === 'new file' ? 'A' : st.staged === 'deleted' ? 'D' : '●'}</i>`;
    }
    if (st.unstaged) h += `<i class="bd ${st.unstaged === 'deleted' ? 'd' : 'm'}" data-tip="${st.unstaged === 'deleted' ? 'Apagado no disco, ainda não staged' : 'Modificado — ainda fora da Staging Area'}">${st.unstaged === 'deleted' ? 'D' : 'M'}</i>`;
    return h;
  }

  function renderTree() {
    const e = A.engine, fs = e.fileStates();
    const files = Object.keys(e.files).map(p => ({ p, ghost: false }));
    if (e.repo) Object.keys(e.repo.index).forEach(p => { if (!(p in e.files)) files.push({ p, ghost: true }); });
    const dirs = new Set(e.allDirs());
    files.forEach(f => { const parts = f.p.split('/'); parts.pop(); let cur = ''; parts.forEach(s => { cur = cur ? cur + '/' + s : s; dirs.add(cur); }); });
    const parentOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
    let html = '';
    const walk = (prefix, depth) => {
      [...dirs].filter(d => parentOf(d) === prefix).sort().forEach(d => {
        const col = A.collapsed.has(d);
        html += `<div class="row dir${A.selected === d ? ' sel' : ''}" data-path="${esc(d)}" data-dir="1" style="--d:${depth}"><i class="chev">${col ? '▸' : '▾'}</i><i class="fi dir">📁</i><span class="nm">${esc(baseName(d))}</span></div>`;
        if (!col) walk(d, depth + 1);
      });
      files.filter(f => parentOf(f.p) === prefix).sort((a, b) => a.p.localeCompare(b.p)).forEach(f => {
        const st = fs[f.p] || null;
        let cls = '';
        if (st) cls = st.conflict ? 'st-c' : st.unstaged ? (st.unstaged === 'deleted' ? 'st-d' : 'st-m') : st.staged ? 'st-s' : st.untracked ? 'st-u' : '';
        if (f.ghost && !st) cls = 'st-d';
        html += `<div class="row file ${cls}${f.ghost ? ' ghost' : ''}${A.selected === f.p ? ' sel' : ''}${A.openFile === f.p ? ' open' : ''}" data-path="${esc(f.p)}" style="--d:${depth}"><i class="chev"></i>${fileIcon(f.p)}<span class="nm">${esc(baseName(f.p))}</span><span class="bds">${badges(st)}</span></div>`;
      });
    };
    walk('', 0);
    $('#tree').innerHTML = html || '<div class="empty-tree">Projeto vazio.<br>Crie um arquivo com ＋📄</div>';
    $('#proj-name').innerHTML = `📦 meu-projeto${e.repo ? ` <span class="gitmark" data-tip="Repositório Git ativo">⎇ ${esc(e.repo.head)}</span>` : ' <span class="nogit">sem git</span>'}`;
  }

  $('#tree').addEventListener('click', ev => {
    const row = ev.target.closest('.row');
    if (!row) return;
    const p = row.dataset.path;
    A.selected = p;
    if (row.dataset.dir) { if (A.collapsed.has(p)) A.collapsed.delete(p); else A.collapsed.add(p); renderTree(); }
    else if (!row.classList.contains('ghost')) openFile(p);
    else { renderTree(); toast('Este arquivo foi apagado do disco, mas o Git ainda o conhece. Recupere com <code>git restore ' + esc(p) + '</code>', { type: 'info', icon: '👻', ms: 5000 }); }
  });

  /* ---- criar / excluir ---- */
  function fsChanged(msg) { renderTree(); syncEditor(); renderGstate(); renderPipe(); evalChallenge(); persist(false); }
  $('#btn-newfile').onclick = () => promptModal({
    title: 'Novo arquivo', label: 'Nome do arquivo (pode incluir pasta, ex.: css/app.css)', placeholder: 'login.html',
    onSubmit: name => {
      const p = A.engine.norm(name);
      if (A.engine.isFile(p)) return toast('Esse arquivo já existe.', { type: 'err', icon: '⚠️' });
      if (A.engine.isDir(p)) return toast('Já existe uma pasta com esse nome.', { type: 'err', icon: '⚠️' });
      A.engine.writeFile(p, ''); openFile(p); fsChanged();
      toast(`Arquivo <b>${esc(p)}</b> criado. Olhe o Explorador: ele aparece como <b>U</b> (não rastreado).`, { type: 'ok', icon: '📄', ms: 4200 });
    }
  });
  $('#btn-newdir').onclick = () => promptModal({
    title: 'Nova pasta', label: 'Nome da pasta', placeholder: 'css',
    onSubmit: name => {
      if (A.engine.isFile(name)) return toast('Já existe um arquivo com esse nome.', { type: 'err', icon: '⚠️' });
      A.engine.mkdir(name); fsChanged();
      toast('Pasta criada. O Git só rastreia pastas que contenham arquivos.', { type: 'info', icon: '📁', ms: 4200 });
    }
  });
  $('#btn-delete').onclick = () => {
    const p = A.selected;
    if (!p || (!A.engine.isFile(p) && !A.engine.isDir(p))) return toast('Selecione um arquivo ou pasta no explorador primeiro.', { type: 'info', icon: 'ℹ️' });
    confirmModal({
      title: `Excluir "${esc(p)}"?`, danger: true, ok: 'Excluir',
      text: 'O arquivo será apagado do disco. Se ele já estiver em um commit, o Git ainda lembra dele e você poderá recuperá-lo com git restore.',
      onOk: () => {
        if (A.engine.isDir(p)) A.engine.deleteDir(p); else A.engine.deleteFile(p);
        A.selected = null; fsChanged();
      }
    });
  };
  $('#btn-project').onclick = () => {
    const inCh = A.mode === 'challenge';
    const m = openModal(`<h3>Projeto</h3><p class="muted">${inCh ? 'Você está em um desafio.' : 'Comece de novo quando quiser — seu progresso (XP) é mantido.'}</p>
      <div class="menu-list">
        ${inCh ? '<button class="menu-item" data-a="restart">🔁<div><b>Reiniciar desafio</b><small>Volta ao cenário inicial (o cronômetro continua).</small></div></button><button class="menu-item" data-a="exit">🚪<div><b>Sair do desafio</b><small>Volta ao modo livre com seu projeto.</small></div></button>'
          : '<button class="menu-item" data-a="sample">🧪<div><b>Reiniciar projeto de exemplo</b><small>Restaura index.html, style.css, script.js e README.md, sem Git.</small></div></button><button class="menu-item" data-a="empty">📭<div><b>Novo projeto vazio</b><small>Pasta sem arquivos — ideal para testar git clone.</small></div></button>'}
      </div>`);
    m.addEventListener('click', ev => {
      const b = ev.target.closest('[data-a]'); if (!b) return;
      closeModal();
      const a = b.dataset.a;
      if (a === 'sample' || a === 'empty') {
        const st = a === 'sample' ? defaultProject() : GitEngine.blank();
        attachEngine(new GitEngine(st)); A.freeState = st; resetWorkspaceUI(); A.term.restore(null);
        toast(a === 'sample' ? 'Projeto de exemplo restaurado.' : 'Projeto vazio criado.', { type: 'ok', icon: '📦' });
      } else if (a === 'restart') startChallenge(A.ch.id, true);
      else if (a === 'exit') exitChallenge();
    });
  };

  function resetWorkspaceUI() {
    A.tabs = []; A.openFile = null; A.selected = null; A.fb = [];
    const first = firstFile(A.engine);
    if (first) { A.tabs = [first]; A.openFile = first; }
    loadEditor(); renderAll(); persist();
  }

  /* ================================================================
     Editor
  ================================================================ */
  const HL = {
    html: [[/<!--[\s\S]*?-->/, 'cm'], [/"[^"\n]*"|'[^'\n]*'/, 'st'], [/<\/?[a-zA-Z][\w-]*|\/?>/, 'tg'], [/&\w+;/, 'nm']],
    css: [[/\/\*[\s\S]*?\*\//, 'cm'], [/"[^"\n]*"|'[^'\n]*'/, 'st'], [/#[0-9a-fA-F]{3,8}\b/, 'nm'], [/-?\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms)?\b/, 'nm'], [/[\w-]+(?=\s*:)/, 'pr'], [/[.#]?[a-zA-Z][\w-]*(?=\s*[{,])/, 'tg']],
    js: [[/\/\/.*|\/\*[\s\S]*?\*\//, 'cm'], [/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/, 'st'], [/\b(?:const|let|var|function|return|if|else|for|while|new|class|import|from|export|true|false|null|undefined|this|document|window|console)\b/, 'kw'], [/\b\d+(?:\.\d+)?\b/, 'nm']],
    md: [[/(?<![^\n])#{1,6} .*/, 'kw'], [/\*\*[^*\n]+\*\*/, 'st'], [/`[^`\n]+`/, 'nm'], [/(?<![^\n])[-*] /, 'tg']],
    json: [[/"(?:[^"\\\n]|\\.)*"(?=\s*:)/, 'pr'], [/"(?:[^"\\\n]|\\.)*"/, 'st'], [/\b(?:true|false|null)\b/, 'kw'], [/-?\d+(?:\.\d+)?/, 'nm']]
  };
  const CONFLICT_RULE = [/(?<![^\n])(?:<{7}.*|={7}|>{7}.*)/, 'conf'];
  const compiled = {};
  function langOf(p) { const x = (p || '').split('.').pop().toLowerCase(); return { html: 'html', htm: 'html', css: 'css', js: 'js', md: 'md', json: 'json' }[x] || 'txt'; }
  function highlight(text, lang) {
    let c = compiled[lang];
    if (!c) { const rules = [CONFLICT_RULE, ...(HL[lang] || [])]; c = compiled[lang] = { re: new RegExp(rules.map(r => '(' + r[0].source + ')').join('|'), 'g'), cls: rules.map(r => r[1]) }; }
    c.re.lastIndex = 0;
    let out = '', last = 0, m;
    while ((m = c.re.exec(text))) {
      if (!m[0]) { c.re.lastIndex++; continue; }
      out += esc(text.slice(last, m.index));
      let gi = 1; while (m[gi] === undefined) gi++;
      out += `<span class="tk-${c.cls[gi - 1]}">${esc(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    return out + esc(text.slice(last));
  }

  const ed = $('#editor');
  function loadEditor() {
    A.tabs = A.tabs.filter(t => A.engine.isFile(t));
    if (!A.openFile || !A.engine.isFile(A.openFile)) A.openFile = A.tabs[0] || null;
    const has = !!A.openFile;
    $('#editor-empty').style.display = has ? 'none' : 'flex';
    ed.disabled = !has;
    ed.value = has ? A.engine.readFile(A.openFile) : '';
    refreshEditorView(); renderTabs();
    $('#es-file').textContent = has ? A.openFile + ' · ' + ({ html: 'HTML', css: 'CSS', js: 'JavaScript', md: 'Markdown', json: 'JSON', txt: 'Texto' }[langOf(A.openFile)]) : '—';
  }
  function refreshEditorView() {
    const text = ed.value;
    $('#hl-code').innerHTML = highlight(text, langOf(A.openFile)) + '\n';
    const n = text.split('\n').length;
    let g = ''; for (let i = 1; i <= n; i++) g += i + '\n';
    $('#gutter-in').textContent = g;
    syncScroll();
  }
  function syncScroll() {
    const hl = $('#hl');
    hl.scrollTop = ed.scrollTop; hl.scrollLeft = ed.scrollLeft;
    $('#gutter-in').style.transform = `translateY(${-ed.scrollTop}px)`;
  }
  ed.addEventListener('scroll', syncScroll);
  let saveT = null;
  function setSave(state) {
    const s = $('#es-save');
    s.textContent = state === 'pending' ? '●  editando…' : '●  salvo';
    s.className = state === 'pending' ? 'pending' : '';
  }
  function afterEdit() {
    setSave('saved'); renderTree(); renderGstate(); renderPipe(); renderQuick(); evalChallenge(); persist(false);
  }
  ed.addEventListener('input', () => {
    if (!A.openFile) return;
    A.engine.writeFile(A.openFile, ed.value);
    refreshEditorView(); setSave('pending');
    clearTimeout(saveT); saveT = setTimeout(afterEdit, 350);
  });
  ed.addEventListener('keydown', e => {
    if (e.key === 'Tab') { e.preventDefault(); ed.setRangeText('  ', ed.selectionStart, ed.selectionEnd, 'end'); ed.dispatchEvent(new Event('input')); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); clearTimeout(saveT); afterEdit(); toast('Arquivo salvo no Working Directory', { type: 'ok', icon: '💾', ms: 1800 }); }
  });
  function syncEditor() {
    if (!A.openFile || !A.engine.isFile(A.openFile)) { loadEditor(); return; }
    const v = A.engine.readFile(A.openFile);
    if (ed.value !== v) { const st = ed.scrollTop; ed.value = v; ed.scrollTop = st; refreshEditorView(); }
    renderTabs();
  }
  function openFile(p) {
    p = A.engine.norm(p);
    if (!A.engine.isFile(p)) return;
    if (!A.tabs.includes(p)) A.tabs.push(p);
    A.openFile = p; A.selected = p;
    loadEditor(); renderTree(); persist(false);
  }
  function renderTabs() {
    const fs = A.engine.fileStates();
    $('#tabs').innerHTML = A.tabs.map(t => {
      const st = fs[t];
      const dot = st ? (st.conflict ? '<i class="td c"></i>' : st.unstaged ? '<i class="td m"></i>' : st.staged ? '<i class="td s"></i>' : st.untracked ? '<i class="td u"></i>' : '') : '';
      return `<div class="tab${t === A.openFile ? ' active' : ''}" data-p="${esc(t)}">${fileIcon(t)}<span>${esc(baseName(t))}</span>${dot}<button class="tab-x" data-x="${esc(t)}" aria-label="Fechar">×</button></div>`;
    }).join('') || '<div class="tab-empty">Nenhum arquivo aberto</div>';
  }
  $('#tabs').addEventListener('click', e => {
    const x = e.target.closest('.tab-x');
    if (x) { A.tabs = A.tabs.filter(t => t !== x.dataset.x); if (A.openFile === x.dataset.x) A.openFile = A.tabs[0] || null; loadEditor(); renderTree(); return; }
    const t = e.target.closest('.tab'); if (t) openFile(t.dataset.p);
  });

  /* ================================================================
     Painéis do Git (status, fluxo, grafo, histórico)
  ================================================================ */
  const chip = (t, c) => `<span class="chip ${c}" title="${esc(t)}">${esc(t.length > 18 ? t.slice(0, 17) + '…' : t)}</span>`;
  const chips = (list, cls, max = 6) => list.slice(0, max).map(t => chip(t, cls)).join('') + (list.length > max ? `<span class="chip more">+${list.length - max}</span>` : '');

  function renderGstate() {
    const e = A.engine, el = $('#gstate');
    if (!e.repo) {
      el.innerHTML = `<div class="panel-h"><span>⎇ ESTADO DO GIT</span></div><div class="gs-body"><div class="gs-off"><div class="gs-ic">🧊</div><b>Esta pasta ainda não é um repositório</b><p>O Git ainda não está registrando nada. Transforme a pasta em um repositório:</p><button class="btn primary sm" data-run="git init">▶ git init</button></div></div>`;
      return;
    }
    const st = e.status(), ab = e.aheadBehind(), n = e.commitCount();
    el.innerHTML = `<div class="panel-h"><span>⎇ ESTADO DO GIT</span><span class="live-pill"><i></i>ativo</span></div>
      <div class="gs-body">
        <div class="gs-branch"><span class="bpill">⎇ ${esc(e.repo.head)}</span>${e.state.merge ? '<span class="bpill warn">MESCLANDO</span>' : ''}${ab ? `<span class="ab" data-tip="vs ${esc(ab.ref)}">↑${ab.ahead} ↓${ab.behind}</span>` : ''}</div>
        <div class="gs-grid">
          <div><b class="c-green">${st.staged.length}</b><span>staged</span></div>
          <div><b class="c-yellow">${st.unstaged.length + st.conflicts.length}</b><span>modificados</span></div>
          <div><b class="c-blue">${st.untracked.length}</b><span>novos</span></div>
          <div><b>${n}</b><span>commits</span></div>
          <div><b>${Object.keys(e.repo.branches).length}</b><span>branches</span></div>
          <div><b>${Object.keys(e.repo.remotes).length}</b><span>remotos</span></div>
        </div>
        <div class="gs-next">💡 ${esc(nextStep(e))}</div>
      </div>`;
  }

  function renderPipe() {
    const e = A.engine, el = $('#pipe');
    if (!e.repo) {
      el.innerHTML = `<div class="pipe-off">Rode <code>git init</code> para ver o fluxo do Git ganhar vida.</div>`;
      return;
    }
    const st = e.status(), r = e.repo, id = e.headId(), last = id ? r.commits[id] : null;
    const wd = [...st.unstaged.map(x => ({ t: x.path, c: x.kind === 'deleted' ? 'd' : 'm' })), ...st.conflicts.map(p => ({ t: p, c: 'c' })), ...st.untracked.map(p => ({ t: p, c: 'u' }))];
    const wdHtml = wd.slice(0, 6).map(x => chip(x.t, x.c)).join('') + (wd.length > 6 ? `<span class="chip more">+${wd.length - 6}</span>` : '');
    const stHtml = chips(st.staged.map(x => x.path), 's');
    const others = Object.keys(r.branches).filter(b => b !== r.head);
    const url = Object.values(r.remotes)[0], ab = e.aheadBehind();
    const tr = r.tracking['origin/' + r.head];
    const remoteHtml = url
      ? `<span class="chip r">☁ ${esc(url.replace(/^https?:\/\//, '').replace(/\.git$/, ''))}</span>${tr ? `<span class="chip rh">origin/${esc(r.head)} ${e.short(tr)}</span>` : '<span class="muted sm">branch ainda não enviada</span>'}${ab ? `<span class="ab">${ab.ahead ? '↑' + ab.ahead + ' a enviar ' : ''}${ab.behind ? '↓' + ab.behind + ' a puxar' : ''}${!ab.ahead && !ab.behind ? '✓ sincronizado' : ''}</span>` : ''}`
      : '<span class="muted sm">sem remoto — <code>git remote add origin &lt;url&gt;</code></span>';
    const zone = (id, title, sub, body, n) => `<div class="pz" id="zone-${id}"><div class="pz-l"><b>${title}</b><small>${sub}</small></div><div class="pz-c">${body || '<span class="muted sm">vazio</span>'}</div>${n !== undefined ? `<div class="pz-n">${n}</div>` : ''}</div>`;
    const arrow = cmd => `<div class="pa"><span class="pa-ln"></span><code>${cmd}</code><span class="pa-ar">↓</span></div>`;
    el.innerHTML =
      zone('wd', 'WORKING DIRECTORY', 'arquivos no disco', wdHtml, wd.length) + arrow('git add') +
      zone('stage', 'STAGING AREA', 'pronto p/ commit', stHtml, st.staged.length) + arrow('git commit') +
      zone('commit', 'COMMIT', 'repositório local', last ? `<span class="chip h">${e.short(id)}</span><span class="cmsg">${esc(last.msg.split('\n')[0])}</span>` : '', e.commitCount()) + arrow('branch') +
      zone('branch', 'BRANCH', 'ponteiro atual', `<span class="chip b">⎇ ${esc(r.head)}</span>${others.slice(0, 3).map(b => `<span class="chip bo">${esc(b)}</span>`).join('')}${others.length > 3 ? `<span class="chip more">+${others.length - 3}</span>` : ''}`, Object.keys(r.branches).length) + arrow('git push / pull') +
      zone('remote', 'REMOTE', 'origin', remoteHtml);
  }

  function renderGraph() {
    const e = A.engine, el = $('#graph'), g = e.graphData();
    if (!g || !g.nodes.length) {
      el.innerHTML = `<div class="graph-empty"><svg width="150" height="46" viewBox="0 0 150 46"><circle cx="20" cy="23" r="7" fill="none" stroke="#33415a" stroke-dasharray="3 3"/><circle cx="75" cy="23" r="7" fill="none" stroke="#33415a" stroke-dasharray="3 3"/><circle cx="130" cy="23" r="7" fill="none" stroke="#33415a" stroke-dasharray="3 3"/><path d="M27 23h41M82 23h41" stroke="#33415a" stroke-dasharray="3 3"/></svg><p>${e.repo ? 'Faça seu primeiro commit para ver o grafo nascer.' : 'Inicialize um repositório e faça commits.'}</p></div>`;
      return;
    }
    const DX = 66, DY = 56, PX = 38, PY = 48;
    const pos = {}; g.nodes.forEach(n => { pos[n.id] = { x: PX + n.i * DX, y: PY + n.lane * DY }; });
    const W = PX * 2 + (g.nodes.length - 1) * DX, H = PY + (g.lanes - 1) * DY + 46;
    let edges = '', nodes = '', labels = '';
    g.nodes.forEach(n => {
      const c = pos[n.id];
      n.parents.forEach((p, k) => {
        const q = pos[p]; if (!q) return;
        const col = LANE_COLORS[(k === 0 ? n.lane : (g.nodes.find(x => x.id === p) || {}).lane || 0) % LANE_COLORS.length];
        const d = q.y === c.y ? `M${q.x} ${q.y}L${c.x} ${c.y}` : `M${q.x} ${q.y}C${q.x + DX * .6} ${q.y},${c.x - DX * .6} ${c.y},${c.x} ${c.y}`;
        edges += `<path class="edge" d="${d}" stroke="${col}" ${k > 0 ? 'stroke-dasharray="1 0"' : ''}/>`;
      });
    });
    g.nodes.forEach(n => {
      const c = pos[n.id], col = LANE_COLORS[n.lane % LANE_COLORS.length], isHead = n.id === g.head;
      nodes += `<g class="gnode${n.id === A.lastCommit ? ' pop' : ''}" data-id="${n.id}" tabindex="0"><title>${esc(e.short(n.id) + ' — ' + n.msg)}</title>${isHead ? `<circle class="headring" cx="${c.x}" cy="${c.y}" r="16"/>` : ''}<circle class="nd" cx="${c.x}" cy="${c.y}" r="10" fill="${col}"/>${n.parents.length > 1 ? `<circle cx="${c.x}" cy="${c.y}" r="4" fill="#0b0f17"/>` : ''}</g>`;
      labels += `<text class="hash" x="${c.x}" y="${c.y + 28}" text-anchor="middle">${e.short(n.id)}</text>`;
      n.refs.forEach((rf, k) => {
        const w = rf.name.length * 6.4 + (rf.type === 'head' ? 34 : 16), y = c.y - 30 - k * 20;
        const cls = rf.type === 'head' ? 'rp head' : rf.type === 'remote' ? 'rp rem' : 'rp';
        labels += `<g class="${cls}"><rect x="${c.x - w / 2}" y="${y - 12}" width="${w}" height="17" rx="8.5"/><text x="${c.x}" y="${y}" text-anchor="middle">${rf.type === 'head' ? 'HEAD → ' : ''}${esc(rf.name)}</text></g>`;
      });
    });
    el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${edges}${nodes}${labels}</svg>`;
    el.scrollLeft = el.scrollWidth;
  }
  $('#graph').addEventListener('click', ev => { const g = ev.target.closest('.gnode'); if (g) showCommit(g.dataset.id); });
  $('#graph').addEventListener('keydown', ev => { if (ev.key === 'Enter') { const g = ev.target.closest('.gnode'); if (g) showCommit(g.dataset.id); } });

  function renderHistory() {
    const e = A.engine, el = $('#hist'), g = e.graphData();
    if (!g || !g.nodes.length) { el.innerHTML = '<div class="hist-empty">Nenhum commit ainda.</div>'; $('#hist-count').textContent = ''; return; }
    const list = [...g.nodes].reverse().slice(0, 40);
    $('#hist-count').textContent = `${g.nodes.length} commit${g.nodes.length > 1 ? 's' : ''}`;
    el.innerHTML = list.map(n => {
      const c = e.repo.commits[n.id];
      const refs = n.refs.map(r => `<span class="rb ${r.type}">${r.type === 'head' ? 'HEAD → ' : ''}${esc(r.name)}</span>`).join('');
      return `<div class="hrow${n.id === A.lastCommit ? ' fresh' : ''}" data-id="${n.id}"><i class="hd" style="background:${LANE_COLORS[n.lane % LANE_COLORS.length]}"></i><code>${e.short(n.id)}</code><span class="hm">${esc(c.msg.split('\n')[0])}</span>${refs}<time>${Fmt.ago(c.date)}</time></div>`;
    }).join('');
  }
  $('#hist').addEventListener('click', ev => { const r = ev.target.closest('.hrow'); if (r) showCommit(r.dataset.id); });

  function showCommit(id) {
    const e = A.engine; if (!e.repo || !e.repo.commits[id]) return;
    const c = e.commitInfo(id);
    const files = c.files.map(f => `<div class="cf-row"><span class="k ${f.kind}">${f.kind}</span><code>${esc(f.path)}</code><span class="pl">+${f.add}</span><span class="mi">−${f.del}</span></div>`).join('') || '<p class="muted">Sem alterações de arquivos.</p>';
    const diff = c.diff.slice(0, 80).map(l => `<div class="tl ${l.c}">${esc(l.t) || '&nbsp;'}</div>`).join('');
    openModal(`<div class="cm-head"><span class="hashbig">${e.short(id)}</span><div><h3>${esc(c.msg.split('\n')[0])}</h3><p class="muted">${esc(c.author.name)} &lt;${esc(c.author.email)}&gt; · ${fmtDate(c.date)}</p></div></div>
      <div class="cm-grid">
        <div><small>HASH COMPLETO</small><code class="full">${id}</code></div>
        <div><small>BRANCH${c.branches.length > 1 ? 'ES' : ''}</small><div>${c.branches.map(b => `<span class="rb branch">${esc(b)}</span>`).join('') || '—'}</div></div>
        <div><small>PAI${c.parents.length > 1 ? 'S' : ''}</small><div>${c.parents.map(p => `<code>${e.short(p)}</code>`).join(' ') || '<span class="muted">commit raiz</span>'}</div></div>
      </div>
      <h4>Arquivos modificados</h4>${files}
      <h4>Alterações</h4><div class="term-mini">${diff || '<span class="muted">—</span>'}</div>
      <div class="modal-actions"><button class="btn primary" data-x>Fechar</button></div>`, { cls: 'wide' });
    $('[data-x]', modalEl).onclick = closeModal;
  }

  /* ---- feedback ---- */
  function pushFeedback(card) {
    A.fb.unshift({ ...card, t: Date.now() });
    A.fb = A.fb.slice(0, 8);
    renderFeedback(true);
  }
  function renderFeedback(anim) {
    const el = $('#fb-list');
    if (!A.fb.length) { el.innerHTML = '<div class="fb-empty">As mensagens de sucesso, erro e dicas aparecem aqui conforme você usa o terminal.</div>'; return; }
    const icon = { ok: '✅', err: '❌', tip: '💡', warn: '⚠️', info: 'ℹ️' };
    el.innerHTML = A.fb.map((f, i) => `<div class="fbc ${f.type}${i === 0 && anim ? ' fresh' : ''}${i > 0 ? ' old' : ''}"><div class="fb-ic">${icon[f.type] || 'ℹ️'}</div><div class="fb-tx"><b>${esc(f.title)}</b>${f.text ? `<p>${esc(f.text)}</p>` : ''}${f.concept ? `<p class="fb-concept">📚 ${esc(f.concept)}</p>` : ''}${f.next ? `<p class="fb-next">👉 ${esc(f.next)}</p>` : ''}</div></div>`).join('');
  }
  $('#btn-fb-clear').onclick = () => { A.fb = []; renderFeedback(); };

  function renderQuick() {
    const e = A.engine;
    let list;
    if (!e.repo) list = ['git init', 'ls', 'git help'];
    else {
      const st = e.status();
      list = ['git status'];
      if (st.unstaged.length || st.untracked.length) list.push('git add .');
      if (st.staged.length) list.push('git commit -m ""');
      if (st.conflicts.length) list.push('git merge --abort');
      list.push('git log --oneline', 'git branch', 'git diff');
      const ab = e.aheadBehind();
      if (Object.keys(e.repo.remotes).length) list.push(ab && ab.behind ? 'git pull' : 'git push');
    }
    $('#quick').innerHTML = '<span class="muted">atalhos:</span>' + [...new Set(list)].slice(0, 7).map(c => `<button class="qchip" data-cmd="${esc(c)}">${esc(c)}</button>`).join('');
  }
  document.addEventListener('click', ev => {
    const q = ev.target.closest('[data-cmd]');
    if (q) {
      const c = q.dataset.cmd;
      if (c.includes('""')) { A.term.input.value = c; A.term.focus(); const pos = c.indexOf('""') + 1; A.term.input.setSelectionRange(pos, pos); }
      else A.term.submit(c);
      return;
    }
    const r = ev.target.closest('[data-run]');
    if (r) A.term.submit(r.dataset.run);
  });

  function renderAll() {
    renderHeader(); renderTree(); renderTabs(); renderGstate(); renderPipe(); renderGraph(); renderHistory(); renderQuick(); renderChallengeCard(); renderFeedback();
    A.term.updatePrompt();
  }

  /* ================================================================
     Animações do fluxo Git
  ================================================================ */
  function fly(text, fromId, toId, cls) {
    const a = $('#zone-' + fromId), b = $('#zone-' + toId);
    if (!a || !b) return;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    if (!ra.width || !rb.width) return;
    const chipEl = document.createElement('div');
    chipEl.className = 'fly ' + cls; chipEl.textContent = text;
    $('#fx').appendChild(chipEl);
    const sx = ra.left + ra.width * .6, sy = ra.top + ra.height / 2, ex = rb.left + rb.width * .6, ey = rb.top + rb.height / 2;
    const T = (x, y, s) => `translate(${x}px,${y}px) translate(-50%,-50%) scale(${s})`;
    chipEl.animate([
      { transform: T(sx, sy, .7), opacity: 0 }, { transform: T(sx, sy, 1), opacity: 1, offset: .15 },
      { transform: T(ex, ey, 1), opacity: 1, offset: .85 }, { transform: T(ex, ey, .5), opacity: 0 }
    ], { duration: 950, easing: 'cubic-bezier(.45,.05,.25,1)' }).onfinish = () => chipEl.remove();
    setTimeout(() => { b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 1000); }, 700);
  }

  function playAnimations(events) {
    if (A.view !== 'play') return;
    let delay = 0;
    events.forEach(evt => {
      const d = delay; delay += 250;
      setTimeout(() => {
        if (evt.type === 'stage' && evt.paths) {
          evt.paths.slice(0, 3).forEach((p, i) => setTimeout(() => fly(baseName(p), 'wd', 'stage', 'f-add'), i * 140));
          evt.paths.forEach(p => { const r = $(`.row[data-path="${CSS.escape(p)}"]`); if (r) { r.classList.add('pulse'); setTimeout(() => r.classList.remove('pulse'), 1200); } });
        } else if (evt.type === 'unstage') fly('↩', 'stage', 'wd', 'f-back');
        else if (evt.type === 'commit') { fly('📸 ' + A.engine.short(evt.id), 'stage', 'commit', 'f-commit'); }
        else if (evt.type === 'push') fly('⬆ push', 'commit', 'remote', 'f-push');
        else if (evt.type === 'fetch' || evt.type === 'pull') fly('⬇ pull', 'remote', 'commit', 'f-pull');
        else if (evt.type === 'checkout' || evt.type === 'branch') { const z = $('#zone-branch'); if (z) { z.classList.add('flash'); setTimeout(() => z.classList.remove('flash'), 1000); } }
        else if (evt.type === 'merge' && !evt.conflict) fly('🔀 merge', 'branch', 'commit', 'f-merge');
        else if (evt.type === 'init') ['wd', 'stage', 'commit', 'branch', 'remote'].forEach((z, i) => setTimeout(() => { const el = $('#zone-' + z); if (el) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 800); } }, i * 120));
      }, d);
    });
  }

  /* ================================================================
     Terminal: integração
  ================================================================ */
  function afterRun({ line, results }) {
    A.lastInput = Date.now();
    const events = A.pendingEvents.splice(0);
    const commit = events.filter(x => x.type === 'commit').pop();
    if (commit) A.lastCommit = commit.id;
    results.forEach(r => Gamification.countCommand(r.ok && r.kind === 'git' ? r.sub : null));
    if (A.ch && !A.ch.done) A.ch.cmds.push(line);

    renderAll(); syncEditor();
    playAnimations(events);

    const last = results[results.length - 1];
    if (last) {
      if (!last.ok) {
        const err = last.error, first = err.message.split('\n')[0];
        pushFeedback({ type: 'err', title: first.length > 90 ? first.slice(0, 88) + '…' : first, text: err.hint, concept: err.concept });
        const t = $('.terminal'); t.classList.remove('shake'); void t.offsetWidth; t.classList.add('shake');
      } else if (last.kind === 'git' && EXPLAIN[last.sub]) {
        const [title, text] = EXPLAIN[last.sub];
        const conflictNow = A.engine.state.merge && A.engine.state.merge.conflicts.length;
        if (conflictNow && last.sub === 'merge') {
          pushFeedback({ type: 'warn', title: 'Conflito de merge!', text: `O Git não conseguiu juntar sozinho. Os arquivos em conflito (${A.engine.state.merge.conflicts.join(', ')}) ganharam marcadores <<<<<<<, ======= e >>>>>>> mostrando as duas versões.`, concept: 'Edite o arquivo, mantenha o código final, apague os marcadores, rode git add <arquivo> e depois git commit.', next: 'Abra o arquivo no editor (já abri para você).' });
          openFile(A.engine.state.merge.conflicts[0]);
        } else {
          let extra = '';
          if (last.sub === 'reset' && last.args.includes('--hard')) extra = ' Atenção: --hard descarta mudanças não commitadas.';
          pushFeedback({ type: 'ok', title, text: text + extra, next: nextStep(A.engine) });
        }
        const t = $('.terminal'); t.classList.remove('okpulse'); void t.offsetWidth; t.classList.add('okpulse');
        if (last.sub === 'init' && A.engine.repo && events.some(x => x.type === 'init')) toast('Repositório criado! Olhe o painel <b>Fluxo do Git</b> →', { type: 'ok', icon: '📦' });
        if (commit && !last.error) toast(`Commit <b>${A.engine.short(commit.id)}</b> criado`, { type: 'ok', icon: '📸', ms: 2400 });
      }
    }
    renderHeader();
    evalChallenge();
    persist();
  }

  /* ================================================================
     Desafios no playground
  ================================================================ */
  function challengeNumber(ch) { return String(Challenges.list.indexOf(ch) + 1).padStart(2, '0'); }

  function startChallenge(id, restart) {
    const ch = Challenges.byId(id); if (!ch) return;
    if (A.mode === 'free') { A.freeState = A.engine.state; A.terms.free = A.term.serialize(); }
    const b = Challenges.build(id);
    attachEngine(new GitEngine(b.state));
    const prevElapsed = restart && A.ch && A.ch.id === id ? A.ch.elapsed : 0;
    A.mode = 'challenge';
    A.ch = { id, base: b.base, elapsed: prevElapsed, cmds: [], hints: restart && A.ch ? A.ch.hints : 0, solution: restart && A.ch ? A.ch.solution : false, done: false };
    A.tabs = []; A.openFile = null; A.selected = null; A.fb = []; A.lastCommit = null; A.pendingEvents = [];
    const first = firstFile(A.engine);
    if (first) { A.tabs = [first]; A.openFile = first; }
    A.term.restore(null);
    A.term.print([L(`▶ Desafio ${challengeNumber(ch)} — ${ch.title}`, 'ok'), L(ch.story, 'dim'), L('Objetivos no painel à direita. Boa sorte!', 'dim'), L('')], false);
    loadEditor();
    go('play');
    renderAll(); persist();
    toast(`Desafio ${challengeNumber(ch)} iniciado: <b>${esc(ch.title)}</b>`, { type: 'info', icon: ch.icon });
  }

  function exitChallenge() {
    if (A.mode !== 'challenge') return;
    A.mode = 'free'; A.ch = null;
    attachEngine(new GitEngine(A.freeState || defaultProject()));
    A.term.restore(A.terms.free);
    A.fb = []; A.tabs = []; A.openFile = null; A.selected = null; A.pendingEvents = [];
    const first = firstFile(A.engine);
    if (first) { A.tabs = [first]; A.openFile = first; }
    loadEditor(); renderAll(); persist();
  }

  function evalChallenge() {
    if (A.mode !== 'challenge' || !A.ch) return;
    const ch = Challenges.byId(A.ch.id);
    A.ch.goalState = Challenges.evaluate(ch, A.engine, A.ch);
    renderChallengeCard();
    if (A.ch.goalState.every(Boolean) && !A.ch.done) { A.ch.done = true; finishChallenge(ch); }
  }

  function finishChallenge(ch) {
    const run = { time: A.ch.elapsed, cmds: A.ch.cmds.length, hints: A.ch.hints, solution: A.ch.solution };
    const res = Gamification.completeChallenge(ch, run);
    A.ch.result = { xp: res.xpGained, score: res.score, first: res.first };
    renderHeader(); renderChallengeCard(); persist();
    setTimeout(() => showSuccess(ch, run, res), 450);
  }

  function showSuccess(ch, run, res) {
    confetti();
    const idx = Challenges.list.indexOf(ch), next = Challenges.list.slice(idx + 1).find(c => !Gamification.state.completed[c.id]) || Challenges.list.find(c => !Gamification.state.completed[c.id]);
    const ach = res.unlocked.map(a => `<div class="ach-mini"><span>${a.icon}</span><div><b>${a.name}</b><small>${a.desc}</small></div></div>`).join('');
    const notes = res.notes.map(n => `<div class="note"><span>${n.t}</span><b>${n.v}</b></div>`).join('');
    const m = openModal(`<div class="success">
        <div class="burst">🎉</div>
        <h2>Desafio concluído!</h2>
        <p class="muted">${challengeNumber(ch)} — ${esc(ch.title)}</p>
        ${res.levelUp ? `<div class="levelup">⬆ NÍVEL ${res.levelUp.level} — ${res.levelUp.title}</div>` : ''}
        <div class="sx-grid">
          <div class="sx big"><small>XP RECEBIDO</small><b class="count" data-to="${res.xpGained}">0</b>${res.first ? '' : '<em>já recebido antes</em>'}</div>
          <div class="sx"><small>PONTUAÇÃO</small><b>${Fmt.num(res.score)}</b></div>
          <div class="sx"><small>TEMPO</small><b>${Fmt.duration(run.time)}</b></div>
          <div class="sx"><small>COMANDOS</small><b>${run.cmds}</b></div>
          <div class="sx"><small>DICAS</small><b>${run.hints}</b></div>
        </div>
        ${notes ? `<div class="notes">${notes}</div>` : ''}
        ${ach ? `<h4>Conquistas desbloqueadas</h4>${ach}` : ''}
        <div class="learned">📚 <b>O que você aprendeu:</b> ${esc(ch.concept)}</div>
        <div class="modal-actions">
          <button class="btn ghost" data-x>Continuar no playground</button>
          ${next ? `<button class="btn primary" data-next="${next.id}">Próximo desafio ➜</button>` : '<button class="btn primary" data-dash>Ver meu progresso</button>'}
        </div></div>`, { cls: 'wide success-modal' });
    $('[data-x]', m).onclick = closeModal;
    const nx = $('[data-next]', m); if (nx) nx.onclick = () => { closeModal(); startChallenge(nx.dataset.next); };
    const ds = $('[data-dash]', m); if (ds) ds.onclick = () => { closeModal(); go('dashboard'); };
    const cnt = $('.count', m), to = +cnt.dataset.to, t0 = performance.now();
    (function step(t) { const p = Math.min(1, (t - t0) / 900); cnt.textContent = '+' + Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); })(t0);
  }

  function renderChallengeCard() {
    const el = $('#challenge-card');
    if (A.mode !== 'challenge' || !A.ch) {
      el.innerHTML = `<div class="panel free-card"><div><b>🧪 Modo livre</b><p class="muted sm">Experimente à vontade. Quer um objetivo?</p></div><button class="btn primary sm" id="fc-go">Ver desafios</button></div>`;
      $('#fc-go').onclick = () => go('challenges');
      return;
    }
    const ch = Challenges.byId(A.ch.id), lv = Challenges.LEVELS[ch.level];
    const gs = A.ch.goalState || Challenges.evaluate(ch, A.engine, A.ch);
    const done = A.ch.done, hints = A.ch.hints;
    const hintHtml = ch.hints.slice(0, hints).map((h, i) => `<div class="hint"><b>Dica ${i + 1}</b>${esc(h)}</div>`).join('');
    const sol = A.ch.solution ? `<div class="solution"><b>Solução possível</b>${ch.solution.map(s => `<code>${esc(s)}</code>`).join('')}</div>` : '';
    const potential = Gamification.previewXp(ch, hints, A.ch.solution);
    el.innerHTML = `<div class="panel challenge ${ch.level}${done ? ' done' : ''}">
      <div class="ch-h"><span class="lvl-badge" style="--c:${lv.color}">${lv.icon} ${lv.name}</span><span class="ch-xp" data-tip="XP se concluir agora (dicas reduzem)">${done ? '✓ concluído' : '+' + potential + ' XP'}</span></div>
      <h3>${ch.icon} Desafio ${challengeNumber(ch)} — ${esc(ch.title)}</h3>
      <p class="story">${esc(ch.story)}</p>
      <ul class="goals">${ch.goals.map((g, i) => `<li class="${gs[i] ? 'ok' : ''}"><i>${gs[i] ? '✓' : ''}</i>${esc(g.label)}</li>`).join('')}</ul>
      <div class="ch-meta"><span>⏱ <b id="ch-timer">${Fmt.clock(A.ch.elapsed)}</b></span><span>⌨ <b>${A.ch.cmds.length}</b> cmds</span><span>💡 <b>${hints}</b>/${ch.hints.length}</span><span data-tip="Tempo de referência para o bônus de velocidade">🎯 ${Fmt.clock(ch.par)}</span></div>
      ${hintHtml}${sol}
      <div class="ch-actions">
        ${done ? `<button class="btn primary sm" id="ch-next">Próximo desafio ➜</button><button class="btn ghost sm" id="ch-exit">Modo livre</button>`
          : `${hints < ch.hints.length ? `<button class="btn warn sm" id="ch-hint">💡 Dica <small>−10 XP</small></button>` : (!A.ch.solution ? `<button class="btn ghost sm" id="ch-sol">🔓 Ver solução</button>` : '')}<button class="btn ghost sm" id="ch-restart">↺ Reiniciar</button><button class="btn ghost sm" id="ch-exit">Sair</button>`}
      </div></div>`;
    const on = (id, fn) => { const b = $('#' + id, el); if (b) b.onclick = fn; };
    on('ch-hint', () => { A.ch.hints++; renderChallengeCard(); persist(); toast('Dica revelada (−10 XP no resultado final)', { type: 'info', icon: '💡', ms: 2200 }); });
    on('ch-sol', () => confirmModal({ title: 'Revelar a solução?', text: 'Você receberá só 25% do XP e sua sequência de desafios será zerada. Tem certeza?', ok: 'Mostrar solução', danger: true, onOk: () => { A.ch.solution = true; renderChallengeCard(); persist(); } }));
    on('ch-restart', () => startChallenge(A.ch.id, true));
    on('ch-exit', exitChallenge);
    on('ch-next', () => { const n = Challenges.list.slice(Challenges.list.indexOf(ch) + 1)[0]; if (n) startChallenge(n.id); else go('challenges'); });
  }

  /* ================================================================
     Lista de desafios
  ================================================================ */
  function renderChallenges() {
    const S = Gamification.state, tot = Gamification.totals(), d = Challenges.daily();
    const nextRec = Challenges.list.find(c => !S.completed[c.id]);
    const dailyDone = S.daily.date === d.key && S.daily.done;
    $('#daily').innerHTML = `<div class="daily"><div class="d-ic">⭐</div><div class="d-tx"><small>DESAFIO DO DIA · +50% XP</small><h3>${d.challenge.icon} ${esc(d.challenge.title)}</h3><p>${esc(d.challenge.story)}</p></div>${dailyDone ? '<span class="done-pill">✓ concluído hoje</span>' : `<button class="btn primary" data-start="${d.challenge.id}">Aceitar desafio</button>`}</div>
      <div class="overall"><div class="ov-t"><b>${tot.done}/${tot.total}</b> desafios concluídos</div><div class="bar lg"><i style="width:${Math.round(tot.done / tot.total * 100)}%"></i></div></div>`;
    $('#challenge-list').innerHTML = Object.entries(Challenges.LEVELS).map(([key, lv]) => {
      const items = Challenges.list.filter(c => c.level === key), done = items.filter(c => S.completed[c.id]).length;
      return `<div class="lvl-sec"><div class="lvl-h" style="--c:${lv.color}"><h2>${lv.icon} ${lv.name}</h2><span>${done}/${items.length}</span><div class="bar"><i style="width:${done / items.length * 100}%"></i></div></div>
        <div class="cgrid">${items.map(c => {
          const rec = S.completed[c.id], isNext = nextRec && nextRec.id === c.id;
          return `<article class="ccard${rec ? ' done' : ''}${isNext ? ' rec' : ''}" style="--c:${lv.color}">
            ${isNext ? '<span class="ribbon">Recomendado</span>' : ''}
            <div class="cc-top"><span class="cc-n">${challengeNumber(c)}</span><span class="cc-ic">${c.icon}</span>${rec ? '<span class="cc-ok">✓</span>' : ''}</div>
            <h3>${esc(c.title)}</h3><p>${esc(c.story.length > 130 ? c.story.slice(0, 127) + '…' : c.story)}</p>
            <div class="cc-meta"><span>+${c.xp} XP</span><span>⏱ ${Fmt.clock(c.par)}</span>${rec ? `<span class="best">melhor ${Fmt.duration(rec.time)}</span>` : ''}</div>
            <button class="btn ${rec ? 'ghost' : 'primary'} sm" data-start="${c.id}">${rec ? '↺ Refazer' : '▶ Iniciar'}</button></article>`;
        }).join('')}</div></div>`;
    }).join('');
  }
  $('#view-challenges').addEventListener('click', e => { const b = e.target.closest('[data-start]'); if (b) startChallenge(b.dataset.start); });
  $('#btn-free').onclick = () => { if (A.mode === 'challenge') exitChallenge(); go('play'); };

  /* ================================================================
     Dashboard
  ================================================================ */
  function renderDashboard() {
    const S = Gamification.state, lv = Gamification.level(), tot = Gamification.totals(), st = S.stats;
    const segs = 24, fill = Math.round(lv.pct / 100 * segs);
    const bar = '█'.repeat(fill) + '░'.repeat(segs - fill);
    const card = (ic, v, l, c = '') => `<div class="stat ${c}"><div class="s-ic">${ic}</div><b>${v}</b><span>${l}</span></div>`;
    const lvRows = Object.entries(Challenges.LEVELS).map(([k, l]) => { const it = Challenges.list.filter(c => c.level === k), dn = it.filter(c => S.completed[c.id]).length; return `<div class="lp"><span style="color:${l.color}">${l.icon} ${l.name}</span><div class="bar"><i style="width:${dn / it.length * 100}%;background:${l.color}"></i></div><b>${dn}/${it.length}</b></div>`; }).join('');
    $('#dashboard').innerHTML = `
      <div class="page-head"><div><h1>Meu progresso</h1><p class="muted">Tudo que você já praticou, salvo neste navegador.</p></div></div>
      <div class="profile">
        <div class="pf-av">${esc((S.name[0] || 'A').toUpperCase())}</div>
        <div class="pf-info">
          <div class="pf-name"><h2>${esc(S.name)}</h2><button class="btn ghost sm" id="btn-rename">✎ Editar nome</button></div>
          <div class="pf-lv"><small>NÍVEL ${lv.level}</small><b>${lv.title}</b></div>
          <div class="xpbar" aria-label="XP"><code>${bar}</code><span>${Fmt.num(lv.into)} / ${Fmt.num(lv.need)} XP</span></div>
        </div>
        <div class="pf-streak"><div>🔥</div><b>${S.streak}</b><span>seguidos</span></div>
      </div>
      <div class="stats">
        ${card('🧩', `${tot.done}/${tot.total}`, 'Desafios concluídos', 'g')}${card('⭐', Fmt.num(S.xp), 'XP total', 'y')}${card('🎖', lv.level, 'Nível', 'p')}
        ${card('📸', Fmt.num(st.commits), 'Commits realizados')}${card('🌿', Fmt.num(st.branches), 'Branches criadas')}${card('⏱', Fmt.duration(st.seconds), 'Tempo praticando')}
        ${card('⌨️', Fmt.num(st.commands), 'Comandos executados')}${card('🔀', Fmt.num(st.merges), 'Merges')}${card('💀', Fmt.num(st.conflicts), 'Conflitos resolvidos')}
      </div>
      <div class="two">
        <div class="panel pad"><h3>Progresso por nível</h3>${lvRows}</div>
        <div class="panel pad"><h3>Comandos Git praticados</h3><div class="cmd-grid">${PRACTICE_COMMANDS.map(c => `<span class="cmd${S.practiced[c] ? ' on' : ''}" data-tip="${S.practiced[c] ? 'Usado ' + S.practiced[c] + 'x' : 'Ainda não praticado'}">${S.practiced[c] ? '✓' : '○'} git ${c}</span>`).join('')}</div></div>
      </div>
      <div class="panel pad"><h3>Conquistas <small class="muted">${Object.keys(S.achievements).length}/${Gamification.ACHIEVEMENTS.length}</small></h3>
        <div class="ach-grid">${Gamification.ACHIEVEMENTS.map(a => { const on = S.achievements[a.id]; return `<div class="ach${on ? ' on' : ''}"><div class="a-ic">${on ? a.icon : '🔒'}</div><div><b>${a.name}</b><small>${a.desc}</small></div></div>`; }).join('')}</div></div>
      <div class="danger-zone"><div><b>Zona de perigo</b><p class="muted sm">Apaga XP, conquistas, desafios concluídos e o projeto salvo neste navegador.</p></div><button class="btn danger sm" id="btn-reset-all">Reiniciar tudo</button></div>`;
    $('#btn-rename').onclick = () => promptModal({ title: 'Seu nome no ranking', label: 'Nome (até 18 caracteres)', placeholder: S.name, ok: 'Salvar', onSubmit: n => { Gamification.setName(n); renderHeader(); renderDashboard(); } });
    $('#btn-reset-all').onclick = () => confirmModal({ title: 'Reiniciar tudo?', danger: true, ok: 'Apagar tudo', text: 'Esta ação remove todo o progresso e o estado do sandbox deste navegador. Não dá para desfazer (e nem o git reflog salva você aqui 😉).', onOk: () => { Storage.clearAll(); location.hash = '#/home'; location.reload(); } });
  }

  /* ================================================================
     Ranking
  ================================================================ */
  async function renderRanking() {
    const list = await RankingService.list(), top = list[0].xp || 1, me = list.find(u => u.me);
    const above = list[me.pos - 2];
    const medal = ['🥇', '🥈', '🥉'];
    const lvt = xp => Gamification.levelInfo(xp);
    $('#ranking').innerHTML = `<div class="page-head"><div><h1>🏆 Ranking</h1><p class="muted">Dados simulados — pronto para conectar a uma API (veja <code>RankingService.list()</code>).</p></div></div>
      <div class="podium">${[1, 0, 2].map(i => { const u = list[i]; return `<div class="pod p${i + 1}${u.me ? ' me' : ''}"><div class="pod-m">${medal[i]}</div><div class="pod-av">${esc(u.name[0])}</div><b>${esc(u.name)}</b><span>${Fmt.num(u.xp)} XP</span><div class="pod-b"><i>${i + 1}º</i></div></div>`; }).join('')}</div>
      ${above ? `<div class="chase">🎯 Faltam <b>${Fmt.num(above.xp - me.xp + 1)} XP</b> para ultrapassar <b>${esc(above.name)}</b>. Você está em <b>${me.pos}º</b>!</div>` : '<div class="chase">👑 Você lidera o ranking!</div>'}
      <div class="panel rank">${list.map(u => `<div class="rrow${u.me ? ' me' : ''}"><span class="rp">${u.pos <= 3 ? medal[u.pos - 1] : u.pos + 'º'}</span><span class="ra">${esc(u.name[0])}</span><div class="rn"><b>${esc(u.name)}${u.me ? ' <em>você</em>' : ''}</b><small>Nv ${lvt(u.xp).level} · ${lvt(u.xp).title}</small></div><div class="bar"><i style="width:${Math.max(2, u.xp / top * 100)}%"></i></div><span class="rx">${Fmt.num(u.xp)} XP</span></div>`).join('')}</div>`;
  }

  /* ================================================================
     Home: demo animada
  ================================================================ */
  const DEMO = [
    { cmd: 'git init', out: [['Repositório Git vazio inicializado em ~/meu-projeto/.git/', 'ok']], nodes: 0 },
    { cmd: 'git add .', out: [], nodes: 0 },
    { cmd: 'git commit -m "Primeiro commit"', out: [['[main (root-commit) 3fa9c21] Primeiro commit', 'hash'], [' 4 arquivos alterados, 21 inserções(+)', '']], nodes: 1 },
    { cmd: 'git switch -c feature-login', out: [["Alternado para um novo ramo 'feature-login'", 'ok']], nodes: 1 },
    { cmd: 'git commit -am "Cria tela de login"', out: [['[feature-login b81d07e] Cria tela de login', 'hash']], nodes: 2 },
    { cmd: 'git switch main && git merge feature-login', out: [['Fast-forward', 'ok'], ['🎉 Desafio concluído! +120 XP', 'ok']], nodes: 3 }
  ];
  function demoGraph(n) {
    const pts = [[30, 38], [90, 38], [150, 38]];
    let s = '<svg viewBox="0 0 190 80" width="100%" height="80">';
    if (n >= 2) s += '<path d="M30 38L90 38" stroke="#3ddc97" stroke-width="3"/>';
    if (n >= 3) s += '<path d="M90 38L150 38" stroke="#3ddc97" stroke-width="3"/>';
    for (let i = 0; i < Math.min(n, 3); i++) s += `<circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="9" fill="${i === 1 && n < 3 ? '#4cc9f0' : '#3ddc97'}" class="dpop"/>`;
    if (n >= 1) s += `<text x="${pts[Math.min(n, 3) - 1][0]}" y="16" text-anchor="middle" fill="#3ddc97" font-size="10" font-family="monospace">main</text>`;
    return s + '</svg>';
  }
  function startDemo() {
    stopDemo();
    const term = $('#demo-term'), gr = $('#demo-graph');
    if (!term) return;
    let step = 0, alive = true;
    A.demoTimer = { stop: () => { alive = false; } };
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    (async function loop() {
      term.innerHTML = ''; gr.innerHTML = demoGraph(0);
      while (alive) {
        const s = DEMO[step % DEMO.length];
        if (step % DEMO.length === 0) { term.innerHTML = ''; gr.innerHTML = demoGraph(0); }
        const line = document.createElement('div'); line.className = 'dl';
        line.innerHTML = '<span class="p-user">aluno</span><span class="p-at">@</span><span class="p-host">git</span> <span class="p-dollar">$</span> <span class="dc"></span><i class="caret"></i>';
        term.appendChild(line);
        const dc = $('.dc', line);
        for (const ch of s.cmd) { if (!alive) return; dc.textContent += ch; await sleep(34); }
        $('.caret', line).remove();
        await sleep(260);
        s.out.forEach(([t, c]) => { const o = document.createElement('div'); o.className = 'dl ' + c; o.textContent = t; term.appendChild(o); });
        gr.innerHTML = demoGraph(s.nodes);
        term.scrollTop = term.scrollHeight;
        await sleep(1250); step++;
      }
    })();
  }
  function stopDemo() { if (A.demoTimer) { A.demoTimer.stop(); A.demoTimer = null; } }

  /* ================================================================
     Eventos globais
  ================================================================ */
  function firstOrNextChallenge() { return Challenges.list.find(c => !Gamification.state.completed[c.id]) || Challenges.list[0]; }
  $('#cta-challenge').onclick = $('#cta-challenge2').onclick = () => startChallenge(firstOrNextChallenge().id);
  $('#cta-play').onclick = () => { go('play'); };
  $('#player').onclick = () => go('dashboard');
  $('#hs-ch').textContent = Challenges.list.length;
  $('#btn-term-clear').onclick = () => { A.term.clear(); A.term.focus(); persist(false); };
  $('#btn-term-help').onclick = () => {
    const rows = [['git init', 'Cria o repositório'], ['git status', 'Vê o estado dos arquivos'], ['git add . | arquivo', 'Coloca na Staging Area'], ['git commit -m "msg"', 'Grava um commit'], ['git log --oneline', 'Histórico'], ['git branch [nome]', 'Lista / cria branch'], ['git switch [-c] nome', 'Troca (e cria) branch'], ['git merge nome', 'Junta uma branch'], ['git diff [--staged]', 'Mostra diferenças'], ['git restore [--staged] arq', 'Desfaz mudanças'], ['git reset [--soft|--hard] HEAD~1', 'Volta commits'], ['git remote add origin url', 'Conecta ao remoto'], ['git push -u origin main', 'Envia commits'], ['git pull', 'Baixa e integra'], ['git clone url', 'Clona (projeto vazio)'], ['echo "x" > arq | touch | cat | ls', 'Atalhos de shell']];
    const m = openModal(`<h3>Comandos disponíveis</h3><div class="cheat">${rows.map(r => `<div><code>${esc(r[0])}</code><span>${r[1]}</span></div>`).join('')}</div><p class="muted sm">Dica: use Tab para completar, ↑/↓ para o histórico e <code>&amp;&amp;</code> para encadear comandos.</p><div class="modal-actions"><button class="btn primary" data-x>Entendi</button></div>`, { cls: 'wide' });
    $('[data-x]', m).onclick = closeModal;
  };
  ['keydown', 'mousedown', 'mousemove'].forEach(t => document.addEventListener(t, () => { A.lastInput = Date.now(); }, { passive: true }));
  Gamification.onUnlock = a => { toast(`Conquista desbloqueada: <b>${a.name}</b> (+25 XP)`, { type: 'ach', icon: a.icon, ms: 5000 }); renderHeader(); };
  Gamification.onLevelUp = lv => { toast(`⬆ Nível ${lv.level}: <b>${lv.title}</b>!`, { type: 'ach', icon: '🚀', ms: 5000 }); };

  /* relógio: tempo praticado e cronômetro do desafio */
  let tickN = 0;
  setInterval(() => {
    if (document.visibilityState !== 'visible' || A.view !== 'play' || Date.now() - A.lastInput > 90000) return;
    Gamification.state.stats.seconds++;
    if (A.mode === 'challenge' && A.ch && !A.ch.done) {
      A.ch.elapsed++;
      const t = $('#ch-timer'); if (t) t.textContent = Fmt.clock(A.ch.elapsed);
    }
    if (++tickN % 10 === 0) persist();
  }, 1000);
  window.addEventListener('beforeunload', () => { try { persist(); } catch (e) { /* ignore */ } });

  /* ================================================================
     Boot
  ================================================================ */
  function boot() {
    Gamification.load();
    A.term = new GitTerminal({
      out: $('#term-out'), input: $('#term-input'), promptEl: $('#term-prompt'),
      getEngine: () => A.engine, onRun: afterRun, onFsChange: () => { renderTree(); syncEditor(); },
      onOpenFile: p => { openFile(p); }, onClear: () => persist(false)
    });
    const ws = Storage.get('workspace', null);
    if (ws && ws.mode === 'challenge' && ws.challenge && Challenges.byId(ws.challenge.id)) {
      const { state, ...meta } = ws.challenge;
      A.freeState = ws.free || defaultProject();
      A.mode = 'challenge'; A.ch = meta;
      attachEngine(new GitEngine(state));
    } else {
      const st = (ws && ws.free) || defaultProject();
      A.freeState = st; attachEngine(new GitEngine(st));
    }
    if (ws) {
      A.terms = ws.terms || A.terms; A.tabs = ws.tabs || []; A.openFile = ws.openFile || null;
      A.collapsed = new Set(ws.collapsed || []); A.fb = ws.fb || [];
    }
    if (!A.tabs.length) { const f = firstFile(A.engine); if (f) { A.tabs = [f]; A.openFile = f; } }
    A.term.restore(A.terms[A.mode]);
    A.selected = A.openFile;
    loadEditor();
    renderHeader();
    A.pendingEvents = [];
    if (A.mode === 'challenge') A.ch.goalState = Challenges.evaluate(Challenges.byId(A.ch.id), A.engine, A.ch);
    showView(location.hash.replace('#/', '') || 'home');
    try { if (!location.hash) history.replaceState(null, '', '#/home'); } catch (e) { /* iframe sandbox */ }
  }
  boot();
})();
