/* Git Engine — simulação interna do Git.
   Mantém arquivos, working directory, staging area, commits, branches, merge e um remoto simulado.
   Todo o estado é JSON puro (state), por isso pode ser salvo no localStorage sem conversão.
   Os comandos (engine.commands.<nome>(args)) devolvem linhas de saída [{t, c, seg?}]
   ou lançam GitError com explicação educativa (hint/concept). */

class GitError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.hint = opts.hint || '';
    this.concept = opts.concept || '';
  }
}

const L = (t, c = '') => ({ t, c });
const SEG = (...pairs) => ({ t: pairs.map(p => p[0]).join(''), c: '', seg: pairs.map(p => ({ t: p[0], c: p[1] || '' })) });
const splitLines = t => (t === '' || t == null ? [] : t.replace(/\n$/, '').split('\n'));
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const pad2 = n => String(n).padStart(2, '0');

function fmtDate(ms) {
  const d = new Date(ms);
  return `${DIAS[d.getDay()]} ${MESES[d.getMonth()]} ${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${d.getFullYear()} -0300`;
}

/* Hash de 40 caracteres hex (apenas visual, não é SHA-1 de verdade). */
function gitHash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57, res = '';
  for (let r = 0; r < 5; r++) {
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    res += (h1 >>> 0).toString(16).padStart(8, '0');
    str += r;
  }
  return res;
}

/* ---------- Algoritmos de diff / merge ---------- */
function lcs(a, b) {
  const n = a.length, m = b.length;
  if (n * m > 4000000) return [];
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const res = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { res.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return res;
}

function diffOps(aText, bText) {
  const a = splitLines(aText), b = splitLines(bText), ops = [];
  let i = 0, j = 0;
  for (const [pi, pj] of lcs(a, b)) {
    while (i < pi) ops.push({ t: '-', s: a[i++] });
    while (j < pj) ops.push({ t: '+', s: b[j++] });
    ops.push({ t: ' ', s: a[i] }); i++; j++;
  }
  while (i < a.length) ops.push({ t: '-', s: a[i++] });
  while (j < b.length) ops.push({ t: '+', s: b[j++] });
  return ops;
}

function diffHunks(ops, ctx = 3) {
  const idx = [];
  ops.forEach((o, k) => { if (o.t !== ' ') idx.push(k); });
  if (!idx.length) return [];
  const ranges = [];
  let s = Math.max(0, idx[0] - ctx), e = Math.min(ops.length - 1, idx[0] + ctx);
  for (let n = 1; n < idx.length; n++) {
    const k = idx[n];
    if (k - ctx <= e + 1) e = Math.min(ops.length - 1, k + ctx);
    else { ranges.push([s, e]); s = Math.max(0, k - ctx); e = Math.min(ops.length - 1, k + ctx); }
  }
  ranges.push([s, e]);
  return ranges.map(([s, e]) => {
    let ao = 1, bo = 1;
    for (let k = 0; k < s; k++) { if (ops[k].t !== '+') ao++; if (ops[k].t !== '-') bo++; }
    let ac = 0, bc = 0; const lines = [];
    for (let k = s; k <= e; k++) { const o = ops[k]; if (o.t !== '+') ac++; if (o.t !== '-') bc++; lines.push(o); }
    return { ao, ac, bo, bc, lines };
  });
}

/* Merge de três vias, linha a linha. Retorna {text, conflict}. */
function merge3(base, ours, theirs, label) {
  const B = base.split('\n'), O = ours.split('\n'), T = theirs.split('\n');
  const mo = new Array(B.length).fill(-1), mt = new Array(B.length).fill(-1);
  lcs(B, O).forEach(([i, j]) => { mo[i] = j; });
  lcs(B, T).forEach(([i, j]) => { mt[i] = j; });
  const out = []; let conflict = false, pb = -1, po = -1, pt = -1;
  const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
  const flush = (ib, io, it) => {
    const cb = B.slice(pb + 1, ib), co = O.slice(po + 1, io), ct = T.slice(pt + 1, it);
    if (same(co, ct)) out.push(...co);
    else if (same(cb, co)) out.push(...ct);
    else if (same(cb, ct)) out.push(...co);
    else { conflict = true; out.push('<<<<<<< HEAD', ...co, '=======', ...ct, '>>>>>>> ' + label); }
  };
  for (let i = 0; i < B.length; i++) {
    if (mo[i] >= 0 && mt[i] >= 0) { flush(i, mo[i], mt[i]); out.push(B[i]); pb = i; po = mo[i]; pt = mt[i]; }
  }
  flush(B.length, O.length, T.length);
  return { text: out.join('\n'), conflict };
}

const COMMON_CONCEPT = {
  repo: 'Um repositório Git é uma pasta que ganhou uma memória: o Git passa a guardar todas as versões dos seus arquivos. Tudo começa com git init.',
  staging: 'A Staging Area (ou index) é a "sala de espera" dos commits: você escolhe com git add quais mudanças entrarão no próximo commit.',
  branch: 'Uma branch é apenas um ponteiro móvel para um commit. Criar branches é barato e permite trabalhar em paralelo sem quebrar a main.'
};

class GitEngine {
  constructor(state) {
    this.state = state || GitEngine.blank();
    this.onEvent = null;
    this.commands = this._buildCommands();
  }

  static blank() {
    return {
      files: {}, dirs: [], repo: null, merge: null, servers: {}, seq: 0,
      clock: Date.now() - 3 * 3600 * 1000,
      user: { name: 'Aluno', email: 'aluno@gitplayground.dev' }
    };
  }

  emit(type, data = {}) { if (this.onEvent) this.onEvent({ type, ...data }); }
  get repo() { return this.state.repo; }
  get files() { return this.state.files; }

  /* ---------- Sistema de arquivos ---------- */
  norm(p) { return String(p).replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+/g, '/').replace(/\/$/, ''); }
  writeFile(p, c) {
    p = this.norm(p);
    this.state.files[p] = c;
    return p;
  }
  readFile(p) { return this.state.files[this.norm(p)]; }
  isFile(p) { return Object.prototype.hasOwnProperty.call(this.state.files, this.norm(p)); }
  allDirs() {
    const set = new Set(this.state.dirs);
    Object.keys(this.state.files).forEach(p => {
      const parts = p.split('/'); parts.pop();
      let cur = '';
      parts.forEach(seg => { cur = cur ? cur + '/' + seg : seg; set.add(cur); });
    });
    return [...set].sort();
  }
  isDir(p) { return this.allDirs().includes(this.norm(p)); }
  mkdir(p) {
    p = this.norm(p);
    if (!this.state.dirs.includes(p)) this.state.dirs.push(p);
  }
  deleteFile(p) { delete this.state.files[this.norm(p)]; }
  deleteDir(p) {
    p = this.norm(p);
    Object.keys(this.state.files).forEach(f => { if (f.startsWith(p + '/')) delete this.state.files[f]; });
    this.state.dirs = this.state.dirs.filter(d => d !== p && !d.startsWith(p + '/'));
  }

  /* ---------- Helpers do repositório ---------- */
  requireRepo() {
    if (!this.repo) {
      throw new GitError('fatal: não é um repositório git (ou qualquer um dos diretórios pais): .git', {
        hint: 'Esta pasta ainda não é um repositório. Rode "git init" para transformá-la em um.',
        concept: COMMON_CONCEPT.repo
      });
    }
    return this.repo;
  }
  headBranch() { return this.repo ? this.repo.head : null; }
  headId() { return this.repo ? (this.repo.branches[this.repo.head] || null) : null; }
  treeOf(id) { return id && this.repo.commits[id] ? this.repo.commits[id].tree : {}; }
  headTree() { return this.treeOf(this.headId()); }
  ancestors(id, store) {
    store = store || this.repo.commits;
    const seen = new Set(), st = [id];
    while (st.length) {
      const x = st.pop();
      if (!x || seen.has(x)) continue;
      seen.add(x);
      if (store[x]) st.push(...store[x].parents);
    }
    return seen;
  }
  isAncestor(a, b) { return this.ancestors(b).has(a); }
  mergeBase(a, b) {
    const A = this.ancestors(a);
    let best = null;
    this.ancestors(b).forEach(x => { if (A.has(x) && (!best || this.repo.commits[x].seq > this.repo.commits[best].seq)) best = x; });
    return best;
  }
  commitCount(id) { const h = id || this.headId(); return h ? this.ancestors(h).size : 0; }
  short(id) { return id ? id.slice(0, 7) : ''; }

  resolve(rev) {
    const r = this.requireRepo();
    const bad = () => new GitError(`fatal: argumento ambíguo '${rev}': revisão desconhecida ou caminho fora da árvore de trabalho.`, {
      hint: 'Use o nome de uma branch, HEAD, HEAD~1 ou os primeiros caracteres de um hash (veja git log --oneline).'
    });
    const base = rev.replace(/([~^]\d*)+$/, '');
    const suffix = rev.slice(base.length).match(/[~^]\d*/g) || [];
    let id = null;
    if (base === 'HEAD' || base === '@') id = this.headId();
    else if (r.branches[base]) id = r.branches[base];
    else if (r.tracking[base]) id = r.tracking[base];
    else if (base.length >= 4 && /^[0-9a-f]+$/.test(base)) {
      const m = Object.keys(r.commits).filter(k => k.startsWith(base));
      if (m.length === 1) id = m[0];
    }
    if (!id) throw bad();
    for (const sfx of suffix) {
      const n = sfx.length > 1 ? parseInt(sfx.slice(1), 10) : 1;
      const c = r.commits[id];
      if (sfx[0] === '~') {
        for (let i = 0; i < n; i++) {
          if (!id || !r.commits[id].parents[0]) throw new GitError(`fatal: revisão inválida '${rev}' (o histórico não é tão longo)`, { hint: 'Veja quantos commits existem com git log --oneline.' });
          id = r.commits[id].parents[0];
        }
      } else {
        id = c.parents[n - 1];
        if (!id) throw new GitError(`fatal: revisão inválida '${rev}'`);
      }
    }
    return id;
  }

  makeCommit(msg, parents, tree, store) {
    const s = this.state;
    s.seq++;
    s.clock += (4 + Math.floor(Math.random() * 40)) * 60000;
    const id = gitHash(msg + '|' + parents.join(',') + '|' + JSON.stringify(tree) + '|' + s.seq);
    (store || this.repo.commits)[id] = { id, msg, parents, tree: { ...tree }, author: { ...s.user }, date: s.clock, seq: s.seq };
    return id;
  }

  /* ---------- Estado / status ---------- */
  status() {
    const r = this.repo, head = this.headTree(), idx = r.index, wd = this.state.files;
    const conflicts = this.state.merge ? [...this.state.merge.conflicts] : [];
    const staged = [], unstaged = [], untracked = [];
    Object.keys(idx).sort().forEach(p => {
      if (conflicts.includes(p)) return;
      if (!(p in head)) staged.push({ path: p, kind: 'new file' });
      else if (head[p] !== idx[p]) staged.push({ path: p, kind: 'modified' });
    });
    Object.keys(head).sort().forEach(p => { if (!(p in idx) && !conflicts.includes(p)) staged.push({ path: p, kind: 'deleted' }); });
    Object.keys(idx).sort().forEach(p => {
      if (conflicts.includes(p)) return;
      if (!(p in wd)) unstaged.push({ path: p, kind: 'deleted' });
      else if (wd[p] !== idx[p]) unstaged.push({ path: p, kind: 'modified' });
    });
    Object.keys(wd).sort().forEach(p => { if (!(p in idx) && !conflicts.includes(p)) untracked.push(p); });
    staged.sort((a, b) => a.path.localeCompare(b.path));
    return { staged, unstaged, untracked, conflicts };
  }

  fileStates() {
    const out = {};
    if (!this.repo) return out;
    const st = this.status();
    st.staged.forEach(x => { out[x.path] = { ...(out[x.path] || {}), staged: x.kind }; });
    st.unstaged.forEach(x => { out[x.path] = { ...(out[x.path] || {}), unstaged: x.kind }; });
    st.untracked.forEach(p => { out[p] = { untracked: true }; });
    st.conflicts.forEach(p => { out[p] = { conflict: true }; });
    return out;
  }

  isClean() {
    if (!this.repo) return false;
    const s = this.status();
    return !s.staged.length && !s.unstaged.length && !s.untracked.length && !s.conflicts.length;
  }

  aheadBehind() {
    const r = this.repo, up = r && r.upstream[r.head];
    if (!up || !r.tracking[up]) return null;
    const h = this.headId(), t = r.tracking[up];
    const a = h ? this.ancestors(h) : new Set(), b = this.ancestors(t);
    let ahead = 0, behind = 0;
    a.forEach(x => { if (!b.has(x)) ahead++; });
    b.forEach(x => { if (!a.has(x)) behind++; });
    return { ref: up, ahead, behind };
  }

  refsAt() {
    const r = this.repo, map = {};
    if (!r) return map;
    const add = (id, ref) => { if (id) (map[id] = map[id] || []).push(ref); };
    Object.entries(r.branches).forEach(([b, id]) => add(id, { type: b === r.head ? 'head' : 'branch', name: b }));
    Object.entries(r.tracking).forEach(([n, id]) => add(id, { type: 'remote', name: n }));
    return map;
  }

  decorationSegs(id, refs) {
    const list = refs[id];
    if (!list) return [];
    const segs = [[' (', 'hash']];
    const ordered = [...list].sort((a, b) => (a.type === 'head' ? -1 : 0) - (b.type === 'head' ? -1 : 0));
    ordered.forEach((rf, i) => {
      if (i) segs.push([', ', 'hash']);
      if (rf.type === 'head') segs.push([`HEAD -> ${rf.name}`, 'dec-head']);
      else segs.push([rf.name, rf.type === 'remote' ? 'dec-rem' : 'dec-br']);
    });
    segs.push([')', 'hash']);
    return segs;
  }

  /* Dados para o gráfico de commits (lanes por branch). */
  graphData() {
    const r = this.repo;
    if (!r) return null;
    const reach = new Set();
    Object.values(r.branches).forEach(id => this.ancestors(id).forEach(x => reach.add(x)));
    Object.values(r.tracking).forEach(id => this.ancestors(id).forEach(x => reach.add(x)));
    const ids = [...reach].sort((a, b) => r.commits[a].seq - r.commits[b].seq);
    const lane = {};
    let next = 1;
    const names = Object.keys(r.branches);
    const trunk = names.includes('main') ? 'main' : names.includes('master') ? 'master' : (names.includes(r.head) ? r.head : names[0]);
    const order = [trunk, ...names.filter(n => n !== trunk).sort((a, b) => r.commits[r.branches[a]].seq - r.commits[r.branches[b]].seq)].filter(Boolean);
    order.forEach((b, i) => {
      let id = r.branches[b], ln = null;
      while (id && lane[id] === undefined) {
        if (ln === null) ln = i === 0 ? 0 : next++;
        lane[id] = ln;
        id = r.commits[id].parents[0];
      }
    });
    [...ids].reverse().forEach(start => {
      let id = start, ln = null;
      while (id && lane[id] === undefined && r.commits[id]) {
        if (ln === null) ln = next++;
        lane[id] = ln;
        id = r.commits[id].parents[0];
      }
    });
    const refs = this.refsAt();
    return {
      head: this.headId(), headBranch: r.head, lanes: next,
      nodes: ids.map((id, i) => ({ id, i, lane: lane[id] || 0, msg: r.commits[id].msg, parents: r.commits[id].parents, refs: refs[id] || [] }))
    };
  }

  commitInfo(id) {
    const r = this.repo, c = r.commits[id];
    const parentTree = c.parents.length ? r.commits[c.parents[0]].tree : {};
    const st = this.statLines(parentTree, c.tree);
    const branches = Object.keys(r.branches).filter(b => this.ancestors(r.branches[b]).has(id));
    return { ...c, files: st.rows, branches, diff: this.diffTreesLines(parentTree, c.tree) };
  }

  /* ---------- Formatadores ---------- */
  statLines(A, B) {
    const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort();
    let ins = 0, del = 0, files = 0;
    const rows = [], modes = [];
    for (const p of keys) {
      if (A[p] === B[p]) continue;
      files++;
      let a = 0, d = 0, kind = 'modificado';
      if (A[p] === undefined) { a = splitLines(B[p]).length; kind = 'novo'; modes.push(L(` criar modo 100644 ${p}`)); }
      else if (B[p] === undefined) { d = splitLines(A[p]).length; kind = 'removido'; modes.push(L(` excluir modo 100644 ${p}`)); }
      else diffOps(A[p], B[p]).forEach(o => { if (o.t === '+') a++; else if (o.t === '-') d++; });
      ins += a; del += d;
      rows.push({ path: p, add: a, del: d, kind });
    }
    return { files, ins, del, rows, modes };
  }

  statOutput(A, B, withModes = true) {
    const st = this.statLines(A, B), out = [];
    if (!st.files) return out;
    const w = Math.max(...st.rows.map(r => r.path.length));
    st.rows.forEach(r => out.push(SEG([` ${r.path.padEnd(w)} | ${String(r.add + r.del).padStart(3)} `], ['+'.repeat(Math.min(r.add, 20)), 'add'], ['-'.repeat(Math.min(r.del, 20)), 'del'])));
    let sum = ` ${plural(st.files, 'arquivo alterado', 'arquivos alterados')}`;
    if (st.ins) sum += `, ${plural(st.ins, 'inserção(+)', 'inserções(+)')}`;
    if (st.del) sum += `, ${plural(st.del, 'deleção(-)', 'deleções(-)')}`;
    out.push(L(sum));
    if (withModes) out.push(...st.modes);
    return out;
  }

  diffTreesLines(A, B, filter) {
    const lines = [];
    const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort();
    for (const p of keys) {
      if (filter && !filter(p)) continue;
      const a = A[p], b = B[p];
      if (a === b) continue;
      lines.push(L(`diff --git a/${p} b/${p}`, 'head'));
      if (a === undefined) lines.push(L('new file mode 100644', 'head'));
      else if (b === undefined) lines.push(L('deleted file mode 100644', 'head'));
      lines.push(L(`index ${gitHash(a || '').slice(0, 7)}..${gitHash(b || '').slice(0, 7)}${a !== undefined && b !== undefined ? ' 100644' : ''}`, 'head'));
      lines.push(L(`--- ${a === undefined ? '/dev/null' : 'a/' + p}`, 'head'));
      lines.push(L(`+++ ${b === undefined ? '/dev/null' : 'b/' + p}`, 'head'));
      for (const h of diffHunks(diffOps(a || '', b || ''))) {
        lines.push(L(`@@ -${h.ao},${h.ac} +${h.bo},${h.bc} @@`, 'hunk'));
        h.lines.forEach(o => lines.push(L(o.t + o.s, o.t === '+' ? 'add' : o.t === '-' ? 'del' : '')));
      }
    }
    return lines;
  }

  /* ---------- Operações de árvore ---------- */
  applyTree(cur, target) {
    const s = this.state, r = this.repo, oldIdx = r.index, newIdx = {};
    const keys = new Set([...Object.keys(cur), ...Object.keys(target), ...Object.keys(oldIdx)]);
    keys.forEach(p => {
      if (cur[p] === target[p]) { if (p in oldIdx) newIdx[p] = oldIdx[p]; return; }
      if (target[p] === undefined) delete s.files[p]; else { s.files[p] = target[p]; newIdx[p] = target[p]; }
    });
    r.index = newIdx;
  }

  hardTo(T) {
    const s = this.state, r = this.repo;
    new Set([...Object.keys(r.index), ...Object.keys(this.headTree())]).forEach(p => { if (!(p in T)) delete s.files[p]; });
    Object.entries(T).forEach(([p, c]) => { s.files[p] = c; });
    r.index = { ...T };
  }

  serverFor(url) {
    const s = this.state;
    if (!s.servers[url]) s.servers[url] = { commits: {}, branches: {} };
    return s.servers[url];
  }

  seedSample(url) {
    const s = this.state, t = new GitEngine(GitEngine.blank());
    t.state.seq = s.seq; t.state.clock = s.clock - 2 * 86400000;
    t.state.user = { name: 'Time Dev', email: 'time@exemplo.dev' };
    t.writeFile('README.md', '# Projeto do time\n\nRepositório de exemplo para praticar git clone.\n');
    t.writeFile('index.html', '<!DOCTYPE html>\n<html>\n<head><title>Projeto do time</title></head>\n<body>\n  <h1>Projeto do time</h1>\n</body>\n</html>\n');
    t.commands.init([]); t.commands.add(['.']); t.commands.commit(['-m', 'Commit inicial']);
    t.writeFile('style.css', 'body {\n  font-family: sans-serif;\n}\n');
    t.commands.add(['.']); t.commands.commit(['-m', 'Adiciona estilos']);
    t.writeFile('README.md', '# Projeto do time\n\nRepositório de exemplo para praticar git clone.\n\n## Como contribuir\nAbra uma branch e faça seu commit.\n');
    t.commands.add(['.']); t.commands.commit(['-m', 'Documenta como contribuir']);
    s.servers[url] = { commits: t.repo.commits, branches: { ...t.repo.branches } };
    s.seq = t.state.seq; s.clock = Math.max(s.clock, t.state.clock);
    return s.servers[url];
  }

  /* ---------- Merge ---------- */
  mergeInto(targetId, label, opts = {}) {
    const r = this.repo, s = this.state, head = this.headId();
    if (s.merge) throw new GitError('erro: Você não concluiu seu merge (MERGE_HEAD existe).', { hint: 'Resolva os conflitos, use git add nos arquivos e rode git commit. Ou desista com git merge --abort.' });
    if (head && (head === targetId || this.ancestors(head).has(targetId))) return [L('Já está atualizado.')];
    const headTree = this.headTree(), targetTree = this.treeOf(targetId);
    const canFF = !head || this.ancestors(targetId).has(head);
    const baseTree = canFF ? headTree : this.treeOf(this.mergeBase(head, targetId));
    const touched = [...new Set([...Object.keys(baseTree), ...Object.keys(targetTree)])].filter(p => baseTree[p] !== targetTree[p]);
    const dirty = touched.filter(p => s.files[p] !== headTree[p] || r.index[p] !== headTree[p]);
    if (dirty.length) {
      throw new GitError(`erro: Suas alterações locais nos seguintes arquivos serão sobrescritas pelo merge:\n\t${dirty.join('\n\t')}\nPor favor, faça commit das suas alterações ou stash antes de fazer o merge.\nAbortando`, {
        hint: 'Faça commit (ou descarte com git restore) as alterações desses arquivos antes de mesclar.'
      });
    }
    if (canFF && !opts.noff) {
      const out = [];
      if (head) out.push(L(`Atualizando ${this.short(head)}..${this.short(targetId)}`));
      out.push(L('Fast-forward', 'ok'));
      out.push(...this.statOutput(headTree, targetTree));
      this.applyTree(headTree, targetTree);
      r.branches[r.head] = targetId;
      this.emit('merge', { ff: true, label, files: touched });
      return out;
    }
    const baseId = this.mergeBase(head, targetId);
    const bT = this.treeOf(baseId);
    const keys = [...new Set([...Object.keys(bT), ...Object.keys(headTree), ...Object.keys(targetTree)])].sort();
    const conflicts = [], out = [];
    for (const p of keys) {
      const b = bT[p], o = headTree[p], t = targetTree[p];
      let res, conflicted = false;
      if (o === t) res = o;
      else if (b === o) res = t;
      else if (b === t) res = o;
      else if (o !== undefined && t !== undefined) {
        out.push(L(`Mesclagem automática de ${p}`));
        const m = merge3(b === undefined ? '' : b, o, t, label);
        res = m.text;
        if (m.conflict) { conflicted = true; out.push(L(`CONFLITO (conteúdo): conflito de merge em ${p}`, 'err')); }
      } else {
        res = o !== undefined ? o : t; conflicted = true;
        out.push(L(`CONFLITO (modificar/excluir): ${p} foi alterado em um ramo e excluído no outro.`, 'err'));
      }
      if (conflicted) conflicts.push(p);
      if (res === o && !conflicted) continue;
      if (res === undefined) { delete s.files[p]; delete r.index[p]; }
      else {
        s.files[p] = res;
        if (conflicted) { if (o === undefined) delete r.index[p]; else r.index[p] = o; }
        else r.index[p] = res;
      }
    }
    if (conflicts.length) {
      s.merge = { id: targetId, label, conflicts, hadConflicts: true };
      out.push(L('A mesclagem automática falhou; corrija os conflitos e faça o commit do resultado.', 'err'));
      this.emit('merge', { conflict: true, files: conflicts, label });
      return out;
    }
    const msg = `Merge branch '${label}'` + (r.head !== 'main' && r.head !== 'master' ? ` into ${r.head}` : '');
    const id = this.makeCommit(msg, [head, targetId], r.index);
    r.branches[r.head] = id;
    out.push(L("Merge feito pela estratégia 'ort'.", 'ok'));
    out.push(...this.statOutput(headTree, r.index));
    this.emit('merge', { ff: false, label, id });
    this.emit('commit', { id, msg, merge: true, files: touched });
    return out;
  }

  /* ---------- Troca de branch ---------- */
  validBranchName(name) { return /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(name) && !name.endsWith('/') && !name.includes('..'); }

  createBranch(name, startId) {
    const r = this.repo;
    if (!this.validBranchName(name)) throw new GitError(`fatal: '${name}' não é um nome de ramo válido.`, { hint: 'Use letras, números, hífen ou barra, sem espaços. Ex.: feature-login' });
    if (name in r.branches) throw new GitError(`fatal: um ramo chamado '${name}' já existe.`, { hint: `Para ir até ele use: git switch ${name}`, concept: COMMON_CONCEPT.branch });
    r.branches[name] = startId;
    this.emit('branch', { name, created: true });
  }

  switchTo(name) {
    const r = this.repo, s = this.state, target = r.branches[name];
    if (r.head === name) return [L(`Já está em '${name}'`)];
    if (s.merge) throw new GitError('erro: Você precisa resolver seu índice atual primeiro (há um merge em andamento).', { hint: 'Conclua o merge com git commit ou desista dele com git merge --abort.' });
    const cur = this.headTree(), tgt = this.treeOf(target), blocked = [];
    new Set([...Object.keys(cur), ...Object.keys(tgt)]).forEach(p => {
      if (cur[p] !== tgt[p] && (s.files[p] !== cur[p] || r.index[p] !== cur[p])) blocked.push(p);
    });
    if (blocked.length) {
      throw new GitError(`erro: Suas alterações locais nos seguintes arquivos serão sobrescritas pelo checkout:\n\t${blocked.join('\n\t')}\nPor favor, faça commit das suas alterações ou stash antes de trocar de ramo.\nAbortando`, {
        hint: 'Faça commit das alterações (git add + git commit) ou descarte-as com git restore <arquivo> antes de trocar de branch.',
        concept: 'O Git protege seu trabalho: se trocar de branch fosse apagar mudanças que ainda não foram salvas em um commit, ele se recusa a continuar.'
      });
    }
    this.applyTree(cur, tgt);
    const from = r.head;
    r.head = name;
    this.emit('checkout', { from, to: name });
    return [L(`Alternado para o ramo '${name}'`, 'ok')];
  }

  startBranchAndSwitch(name, startRef) {
    const r = this.repo;
    if (name in r.branches) {
      throw new GitError(`fatal: um ramo chamado '${name}' já existe.`, { hint: `Para apenas mudar para ele: git switch ${name}`, concept: COMMON_CONCEPT.branch });
    }
    if (!this.validBranchName(name)) throw new GitError(`fatal: '${name}' não é um nome de ramo válido.`, { hint: 'Use letras, números, hífen ou barra, sem espaços.' });
    const startId = startRef ? this.resolve(startRef) : this.headId();
    if (!startId) {
      const from = r.head; r.head = name;
      this.emit('checkout', { from, to: name });
      return [L(`Alternado para um novo ramo '${name}'`, 'ok')];
    }
    this.createBranch(name, startId);
    const cur = this.headTree(), tgt = this.treeOf(startId);
    if (startId !== this.headId()) this.applyTree(cur, tgt);
    const from = r.head; r.head = name;
    this.emit('checkout', { from, to: name });
    return [L(`Alternado para um novo ramo '${name}'`, 'ok')];
  }

  /* ---------- restore / reset helpers ---------- */
  restorePaths(paths, { staged = false, worktree = false, source = null } = {}) {
    const r = this.repo, s = this.state;
    const doIdx = staged, doWd = worktree || !staged;
    const srcTree = source ? this.treeOf(this.resolve(source)) : (staged ? this.headTree() : r.index);
    const known = new Set([...Object.keys(srcTree)]);
    if (staged || !source) Object.keys(r.index).forEach(p => known.add(p));
    if (!staged && source) Object.keys(r.index).forEach(p => known.add(p));
    const targets = new Set();
    for (const pat of paths) {
      const p = this.norm(pat);
      let hit = false;
      known.forEach(k => { if (pat === '.' || k === p || k.startsWith(p + '/')) { targets.add(k); hit = true; } });
      if (!hit) {
        throw new GitError(`erro: o caminho '${pat}' não correspondeu a nenhum arquivo conhecido pelo git`, {
          hint: s.files[p] !== undefined ? `'${pat}' é um arquivo novo (untracked). Não há versão anterior para restaurar. Use git add para rastreá-lo ou apague o arquivo.` : 'Confira o nome do arquivo com git status.',
          concept: 'git restore só consegue recuperar arquivos que o Git já conhece (rastreados).'
        });
      }
    }
    for (const p of targets) {
      if (s.merge && s.merge.conflicts.includes(p) && !source) throw new GitError(`erro: o caminho '${p}' não foi mesclado`, { hint: 'Resolva o conflito editando o arquivo e use git add.' });
    }
    targets.forEach(p => {
      const v = srcTree[p];
      if (doIdx) { if (v === undefined) delete r.index[p]; else r.index[p] = v; }
      if (doWd) { if (v === undefined) delete s.files[p]; else s.files[p] = v; }
    });
    this.emit(doIdx && !doWd ? 'unstage' : 'restore', { paths: [...targets] });
    return [...targets];
  }

  /* ---------- Comandos ---------- */
  _buildCommands() {
    const E = this;
    return {
      init: a => E.cmdInit(a), status: a => E.cmdStatus(a), add: a => E.cmdAdd(a), commit: a => E.cmdCommit(a),
      log: a => E.cmdLog(a), branch: a => E.cmdBranch(a), checkout: a => E.cmdCheckout(a), switch: a => E.cmdSwitch(a),
      merge: a => E.cmdMerge(a), diff: a => E.cmdDiff(a), restore: a => E.cmdRestore(a), reset: a => E.cmdReset(a),
      clone: a => E.cmdClone(a), remote: a => E.cmdRemote(a), push: a => E.cmdPush(a), pull: a => E.cmdPull(a),
      fetch: a => E.cmdFetch(a), show: a => E.cmdShow(a), rm: a => E.cmdRm(a), config: a => E.cmdConfig(a)
    };
  }

  cmdInit() {
    const s = this.state;
    if (s.repo) return [L('Reinicializado repositório Git existente em ~/meu-projeto/.git/')];
    s.repo = { head: 'main', branches: {}, commits: {}, index: {}, remotes: {}, tracking: {}, upstream: {} };
    this.emit('init');
    return [L('dica: usando "main" como nome do ramo inicial', 'dim'), L('Repositório Git vazio inicializado em ~/meu-projeto/.git/', 'ok')];
  }

  cmdStatus(args) {
    const r = this.requireRepo(), st = this.status(), out = [];
    if (args.includes('-s') || args.includes('--short')) {
      const m = {};
      st.staged.forEach(x => { m[x.path] = (x.kind === 'new file' ? 'A' : x.kind === 'deleted' ? 'D' : 'M') + ' '; });
      st.unstaged.forEach(x => { const c = x.kind === 'deleted' ? 'D' : 'M'; m[x.path] = (m[x.path] ? m[x.path][0] : ' ') + c; });
      st.conflicts.forEach(p => { m[p] = 'UU'; });
      Object.keys(m).sort().forEach(p => out.push(SEG([m[p] + ' ', m[p][1] !== ' ' ? 'del' : 'add'], [p])));
      st.untracked.forEach(p => out.push(SEG(['?? ', 'del'], [p])));
      return out;
    }
    out.push(L(`No ramo ${r.head}`));
    const ab = this.aheadBehind();
    if (ab) {
      if (!ab.ahead && !ab.behind) out.push(L(`Seu ramo está atualizado com '${ab.ref}'.`));
      else if (ab.ahead && !ab.behind) { out.push(L(`Seu ramo está à frente de '${ab.ref}' por ${plural(ab.ahead, 'commit', 'commits')}.`)); out.push(L('  (use "git push" para publicar seus commits locais)', 'dim')); }
      else if (!ab.ahead && ab.behind) { out.push(L(`Seu ramo está atrás de '${ab.ref}' por ${plural(ab.behind, 'commit', 'commits')}, e pode ser mesclado com fast-forward.`)); out.push(L('  (use "git pull" para atualizar seu ramo local)', 'dim')); }
      else out.push(L(`Seu ramo e '${ab.ref}' divergiram, e têm ${ab.ahead} e ${ab.behind} commits diferentes cada, respectivamente.`, 'warn'));
    }
    out.push(L(''));
    if (!this.headId()) { out.push(L('Ainda não há commits', 'bold')); out.push(L('')); }
    if (st.conflicts.length) {
      out.push(L('Você tem caminhos não mesclados.', 'warn'));
      out.push(L('  (corrija os conflitos e execute "git commit")', 'dim'));
      out.push(L('  (use "git merge --abort" para abortar o merge)', 'dim'));
      out.push(L(''));
      out.push(L('Caminhos não mesclados:'));
      out.push(L('  (use "git add <arquivo>..." para marcar a resolução)', 'dim'));
      st.conflicts.forEach(p => out.push(L(`\tambos modificados: ${p}`, 'del')));
      out.push(L(''));
    }
    if (st.staged.length) {
      out.push(L('Mudanças a serem commitadas:'));
      out.push(L(`  (use "git restore --staged <arquivo>..." para remover do stage)`, 'dim'));
      const lbl = { 'new file': 'novo arquivo:', modified: 'modificado:   ', deleted: 'removido:     ' };
      st.staged.forEach(x => out.push(L(`\t${lbl[x.kind]} ${x.path}`, 'add')));
      out.push(L(''));
    }
    if (st.unstaged.length) {
      out.push(L('Mudanças não staged para commit:'));
      out.push(L('  (use "git add <arquivo>..." para atualizar o que será submetido)', 'dim'));
      out.push(L('  (use "git restore <arquivo>..." para descartar as mudanças no diretório de trabalho)', 'dim'));
      st.unstaged.forEach(x => out.push(L(`\t${x.kind === 'deleted' ? 'removido:     ' : 'modificado:   '} ${x.path}`, 'del')));
      out.push(L(''));
    }
    if (st.untracked.length) {
      out.push(L('Arquivos não monitorados:'));
      out.push(L('  (use "git add <arquivo>..." para incluir o que será submetido)', 'dim'));
      st.untracked.forEach(p => out.push(L(`\t${p}`, 'del')));
      out.push(L(''));
    }
    if (!st.staged.length && !st.conflicts.length) {
      if (st.unstaged.length) out.push(L('nenhuma modificação adicionada ao commit (use "git add" e/ou "git commit -a")'));
      else if (st.untracked.length) out.push(L('nada adicionado ao commit, mas há arquivos não monitorados (use "git add" para monitorá-los)'));
      else out.push(L(this.headId() ? 'nada a submeter, diretório de trabalho limpo' : 'nada a submeter (crie/copie arquivos e use "git add" para monitorá-los)'));
    }
    return out;
  }

  cmdAdd(args) {
    const r = this.requireRepo(), s = this.state;
    if (!args.length) throw new GitError('Nada especificado, nada adicionado.', { hint: 'Diga o que adicionar: git add arquivo.txt ou git add . (tudo).', concept: COMMON_CONCEPT.staging });
    const pats = args.filter(a => !a.startsWith('-') || a === '.');
    if (args.includes('-A') || args.includes('--all')) pats.push('.');
    if (!pats.length) throw new GitError('Nada especificado, nada adicionado.', { hint: 'Use git add . para adicionar tudo.' });
    const known = new Set([...Object.keys(s.files), ...Object.keys(r.index)]);
    const targets = new Set();
    for (const pat of pats) {
      const p = this.norm(pat);
      let hit = false;
      known.forEach(k => { if (pat === '.' || pat === './' || k === p || k.startsWith(p + '/')) { targets.add(k); hit = true; } });
      if (!hit) {
        throw new GitError(`fatal: caminho '${pat}' não correspondeu a nenhum arquivo`, {
          hint: 'O Git só adiciona arquivos que existem. Confira o nome (e maiúsculas/minúsculas) no explorador ou com ls.',
          concept: COMMON_CONCEPT.staging
        });
      }
    }
    const changed = [], out = [];
    targets.forEach(t => {
      const before = r.index[t];
      if (t in s.files) r.index[t] = s.files[t]; else delete r.index[t];
      if (before !== r.index[t]) changed.push(t);
      if (s.merge && s.merge.conflicts.includes(t)) {
        s.merge.conflicts = s.merge.conflicts.filter(c => c !== t);
        if (/^(<{7}|={7}|>{7})/m.test(s.files[t] || '')) out.push(L(`aviso: ainda há marcadores de conflito (<<<<<<<, =======, >>>>>>>) em ${t}`, 'warn'));
      }
    });
    if (changed.length) this.emit('stage', { paths: changed });
    return out;
  }

  cmdCommit(args) {
    const r = this.requireRepo(), s = this.state;
    let msgs = [], all = false, amend = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-m' || a === '--message') { msgs.push(args[++i] || ''); }
      else if (a.startsWith('--message=')) msgs.push(a.slice(10));
      else if (a === '-am' || a === '-ma') { all = true; msgs.push(args[++i] || ''); }
      else if (a === '-a' || a === '--all') all = true;
      else if (a === '--amend') amend = true;
      else if (a.startsWith('-m') && a.length > 2) msgs.push(a.slice(2));
    }
    const msgGiven = msgs.length > 0;
    let msg = msgs.join('\n\n').trim();
    if (s.merge && s.merge.conflicts.length) {
      throw new GitError('erro: Não é possível fazer commit porque você tem arquivos não mesclados.', {
        hint: 'Abra os arquivos em conflito, escolha o código final removendo os marcadores <<<<<<<, ======= e >>>>>>>, rode git add <arquivo> e só então git commit.',
        concept: 'Um conflito acontece quando duas branches alteram a mesma região de um arquivo. O Git não sabe qual versão manter, então pede para você decidir.'
      });
    }
    if (all) {
      Object.keys(r.index).forEach(p => { if (p in s.files) r.index[p] = s.files[p]; else delete r.index[p]; });
    }
    const head = this.headTree(), headId = this.headId();
    const diffs = this.statLines(head, r.index);
    if (!diffs.files && !s.merge && !amend) {
      const st = this.status();
      if (st.unstaged.length || st.untracked.length) {
        throw new GitError(`No ramo ${r.head}\n${st.unstaged.length ? 'nenhuma modificação adicionada ao commit (use "git add" e/ou "git commit -a")' : 'nada adicionado ao commit, mas há arquivos não monitorados (use "git add" para monitorá-los)'}`, {
          hint: 'Seus arquivos mudaram, mas nada está na Staging Area. Use git add <arquivo> (ou git add .) antes de git commit.',
          concept: COMMON_CONCEPT.staging
        });
      }
      throw new GitError(`No ramo ${r.head}\nnada a submeter, diretório de trabalho limpo`, {
        hint: 'Não há nada novo para gravar. Edite um arquivo (ou crie um) e use git add antes de commitar.',
        concept: 'Um commit é uma "foto" do que está na Staging Area. Sem mudanças staged, não há foto para tirar.'
      });
    }
    if (!msg && amend && headId) msg = r.commits[headId].msg;
    if (!msg && s.merge && !msgGiven) msg = `Merge branch '${s.merge.label}'`;
    if (!msg) {
      throw new GitError('Abortando commit devido à mensagem de commit vazia.', {
        hint: 'Toda mudança precisa de uma mensagem. Use: git commit -m "descreva o que você fez". (Sem -m o Git abriria um editor de texto, que não existe aqui.)',
        concept: 'Mensagens de commit contam a história do projeto. Boas mensagens respondem: o que mudou e por quê?'
      });
    }
    let parents = headId ? [headId] : [];
    let rootTag = headId ? '' : '(root-commit) ';
    const mergeState = s.merge;
    if (mergeState) parents = [headId, mergeState.id];
    if (amend && headId) { parents = [...r.commits[headId].parents]; rootTag = parents.length ? '' : '(root-commit) '; }
    const id = this.makeCommit(msg, parents, r.index);
    const prevTree = amend && headId ? this.treeOf(parents[0]) : head;
    r.branches[r.head] = id;
    s.merge = null;
    const out = [SEG([`[${r.head} ${rootTag}${this.short(id)}] `, 'hash'], [msg.split('\n')[0]])];
    out.push(...this.statOutput(prevTree, r.index));
    this.emit('commit', { id, msg, merge: !!mergeState, conflictResolved: !!(mergeState && mergeState.hadConflicts), files: diffs.rows.map(x => x.path), amend });
    return out;
  }

  cmdLog(args) {
    const r = this.requireRepo();
    let oneline = false, graph = false, limit = Infinity, all = false, revArg = null;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--oneline') oneline = true;
      else if (a === '--graph') graph = true;
      else if (a === '--all') all = true;
      else if (a === '-n') limit = parseInt(args[++i], 10) || Infinity;
      else if (/^-\d+$/.test(a)) limit = parseInt(a.slice(1), 10);
      else if (a.startsWith('--max-count=')) limit = parseInt(a.slice(12), 10);
      else if (!a.startsWith('-')) revArg = a;
    }
    let starts;
    if (all) starts = [...Object.values(r.branches), ...Object.values(r.tracking)];
    else if (revArg) starts = [this.resolve(revArg)];
    else {
      if (!this.headId()) throw new GitError(`fatal: seu ramo atual '${r.head}' ainda não tem commits`, { hint: 'Faça o primeiro commit: git add . e depois git commit -m "mensagem".', concept: 'git log mostra a história do projeto: commits do mais recente para o mais antigo.' });
      starts = [this.headId()];
    }
    const set = new Set();
    starts.forEach(id => this.ancestors(id).forEach(x => set.add(x)));
    const list = [...set].sort((a, b) => r.commits[b].seq - r.commits[a].seq).slice(0, limit);
    const refs = this.refsAt(), out = [];
    list.forEach(id => {
      const c = r.commits[id], dec = this.decorationSegs(id, refs);
      if (oneline) {
        out.push(SEG([graph ? '* ' : ''], [this.short(id), 'hash'], ...dec, [' ' + c.msg.split('\n')[0]]));
      } else {
        out.push(SEG([graph ? '* ' : ''], ['commit ' + id, 'hash'], ...dec));
        if (c.parents.length > 1) out.push(L(`Merge: ${c.parents.map(p => this.short(p)).join(' ')}`));
        out.push(L(`Author: ${c.author.name} <${c.author.email}>`));
        out.push(L(`Date:   ${fmtDate(c.date)}`));
        out.push(L(''));
        c.msg.split('\n').forEach(m => out.push(L('    ' + m)));
        out.push(L(''));
      }
    });
    return out;
  }

  cmdShow(args) {
    const r = this.requireRepo();
    const id = args.filter(a => !a.startsWith('-'))[0] ? this.resolve(args.filter(a => !a.startsWith('-'))[0]) : this.headId();
    if (!id) throw new GitError(`fatal: seu ramo atual '${r.head}' ainda não tem commits`, { hint: 'Faça um commit primeiro.' });
    const c = r.commits[id], refs = this.refsAt();
    const out = [SEG(['commit ' + id, 'hash'], ...this.decorationSegs(id, refs))];
    if (c.parents.length > 1) out.push(L(`Merge: ${c.parents.map(p => this.short(p)).join(' ')}`));
    out.push(L(`Author: ${c.author.name} <${c.author.email}>`), L(`Date:   ${fmtDate(c.date)}`), L(''));
    c.msg.split('\n').forEach(m => out.push(L('    ' + m)));
    out.push(L(''));
    out.push(...this.diffTreesLines(c.parents.length ? r.commits[c.parents[0]].tree : {}, c.tree));
    return out;
  }

  cmdBranch(args) {
    const r = this.requireRepo();
    const flags = args.filter(a => a.startsWith('-')), pos = args.filter(a => !a.startsWith('-'));
    const del = flags.includes('-d') || flags.includes('-D') || flags.includes('--delete');
    const up = args.find(a => a.startsWith('--set-upstream-to=')), upIdx = args.indexOf('-u');
    if (up || upIdx >= 0) {
      const ref = up ? up.split('=')[1] : args[upIdx + 1];
      if (!r.tracking[ref]) throw new GitError(`fatal: ramo remoto '${ref}' não encontrado.`, { hint: 'Faça git fetch ou git push -u origin <ramo> primeiro.' });
      r.upstream[r.head] = ref;
      return [L(`ramo '${r.head}' configurado para rastrear '${ref}'.`, 'ok')];
    }
    if (flags.includes('--show-current')) return [L(r.head)];
    if (del) {
      if (!pos.length) throw new GitError('fatal: nome do ramo obrigatório', { hint: 'Ex.: git branch -d feature-login' });
      const out = [];
      for (const name of pos) {
        if (!(name in r.branches)) throw new GitError(`erro: ramo '${name}' não encontrado.`, { hint: 'Veja os ramos existentes com git branch.' });
        if (name === r.head) throw new GitError(`erro: Não é possível excluir o ramo '${name}' pois você está nele.`, { hint: 'Troque para outra branch antes (ex.: git switch main) e depois exclua.', concept: 'Você não pode apagar a branch em que está trabalhando agora.' });
        const id = r.branches[name];
        if (!flags.includes('-D') && !this.isAncestor(id, this.headId())) {
          throw new GitError(`erro: O ramo '${name}' não foi totalmente mesclado.\nSe você tem certeza que quer excluí-lo, execute 'git branch -D ${name}'.`, {
            hint: 'Essa branch tem commits que não estão na branch atual. Faça merge antes, ou use -D se quiser mesmo descartá-los.',
            concept: 'git branch -d é o modo seguro: só apaga branches cujo trabalho já foi incorporado.'
          });
        }
        delete r.branches[name];
        Object.keys(r.upstream).forEach(k => { if (k === name) delete r.upstream[k]; });
        out.push(L(`Ramo ${name} removido (era ${this.short(id)}).`, 'ok'));
        this.emit('branch', { name, deleted: true });
      }
      return out;
    }
    if (flags.includes('-m') || flags.includes('-M')) {
      const [a, b] = pos.length === 2 ? pos : [r.head, pos[0]];
      if (!b) throw new GitError('fatal: nome do ramo obrigatório', { hint: 'Ex.: git branch -m novo-nome' });
      if (!(a in r.branches) && a !== r.head) throw new GitError(`erro: ramo '${a}' não encontrado.`);
      if (b in r.branches) throw new GitError(`fatal: um ramo chamado '${b}' já existe.`);
      if (a in r.branches) { r.branches[b] = r.branches[a]; delete r.branches[a]; }
      if (r.head === a) r.head = b;
      this.emit('branch', { name: b, renamed: true });
      return [];
    }
    if (pos.length && !flags.includes('--list') && !flags.includes('-l')) {
      const start = pos[1] ? this.resolve(pos[1]) : this.headId();
      if (!start) {
        throw new GitError(`fatal: não é um nome de objeto válido: '${r.head}'.`, {
          hint: 'Uma branch aponta para um commit, mas ainda não existe nenhum. Faça o primeiro commit antes de criar branches.',
          concept: COMMON_CONCEPT.branch
        });
      }
      this.createBranch(pos[0], start);
      return [];
    }
    const out = [], verbose = flags.includes('-v') || flags.includes('-vv');
    Object.keys(r.branches).sort().forEach(b => {
      const cur = b === r.head, id = r.branches[b];
      out.push(SEG([cur ? '* ' + b : '  ' + b, cur ? 'ok' : ''], verbose ? [` ${this.short(id)} ${r.commits[id].msg}`, 'dim'] : ['']));
    });
    if (flags.includes('-a') || flags.includes('-r')) Object.keys(r.tracking).sort().forEach(n => out.push(L(`  remotes/${n}`, 'del')));
    if (!out.length) out.push(L(`(ainda não há ramos: '${r.head}' nascerá no primeiro commit)`, 'dim'));
    return out;
  }

  cmdCheckout(args) {
    const r = this.requireRepo(), s = this.state;
    const dd = args.indexOf('--');
    if (dd >= 0) {
      const rev = dd > 0 ? args[0] : null, paths = args.slice(dd + 1);
      if (!paths.length) throw new GitError('fatal: informe o(s) arquivo(s) a restaurar', { hint: 'Ex.: git checkout -- arquivo.txt (ou, mais moderno: git restore arquivo.txt)' });
      const done = this.restorePaths(paths, rev ? { source: rev, staged: true, worktree: true } : {});
      return [L(`Atualizado(s) ${plural(done.length, 'caminho', 'caminhos')} de ${rev ? this.short(this.resolve(rev)) : 'o índice'}`)];
    }
    const bi = args.findIndex(a => a === '-b' || a === '-B');
    if (bi >= 0) {
      const name = args[bi + 1];
      if (!name) throw new GitError('fatal: o nome do novo ramo é obrigatório', { hint: 'Ex.: git checkout -b minha-branch' });
      return this.startBranchAndSwitch(name, args[bi + 2]);
    }
    const target = args.find(a => !a.startsWith('-'));
    if (!target) throw new GitError('fatal: informe um ramo', { hint: 'Ex.: git checkout main  |  git checkout -b nova-branch' });
    if (target in r.branches || (!this.headId() && target === r.head)) return this.switchTo(target);
    const remote = Object.keys(r.tracking).find(k => k.endsWith('/' + target));
    if (remote) {
      this.createBranch(target, r.tracking[remote]);
      r.upstream[target] = remote;
      const out = this.switchTo(target);
      return [L(`ramo '${target}' configurado para rastrear '${remote}'.`, 'ok'), ...out];
    }
    if (target in s.files || target in r.index) {
      this.restorePaths([target], {});
      return [L(`Atualizado 1 caminho a partir do índice`)];
    }
    if (/^[0-9a-f]{4,40}$/.test(target) && Object.keys(r.commits).some(k => k.startsWith(target))) {
      throw new GitError(`Checkout direto de um commit (detached HEAD) ainda não é suportado no simulador.`, {
        hint: `Para olhar esse ponto da história crie uma branch nele: git branch teste ${target.slice(0, 7)}. Para desfazer commits use git reset.`,
        concept: 'No Git real, git checkout <hash> deixa você em "detached HEAD": HEAD aponta direto para um commit, não para uma branch.'
      });
    }
    throw new GitError(`erro: o caminho '${target}' não correspondeu a nenhum arquivo conhecido pelo git`, {
      hint: `Não existe branch nem arquivo chamado '${target}'. Branches existentes: ${Object.keys(r.branches).join(', ') || '(nenhuma)'}. Para criar uma nova use: git checkout -b ${target}`,
      concept: COMMON_CONCEPT.branch
    });
  }

  cmdSwitch(args) {
    const r = this.requireRepo();
    const ci = args.findIndex(a => a === '-c' || a === '--create' || a === '-C');
    if (ci >= 0) {
      const name = args[ci + 1];
      if (!name) throw new GitError('fatal: o nome do novo ramo é obrigatório', { hint: 'Ex.: git switch -c minha-branch' });
      return this.startBranchAndSwitch(name, args[ci + 2]);
    }
    const target = args.find(a => !a.startsWith('-'));
    if (!target) throw new GitError('fatal: faltou o nome do ramo', { hint: 'Ex.: git switch main  |  git switch -c nova-branch' });
    if (target in r.branches || (!this.headId() && target === r.head)) return this.switchTo(target);
    const remote = Object.keys(r.tracking).find(k => k.endsWith('/' + target));
    if (remote) {
      this.createBranch(target, r.tracking[remote]);
      r.upstream[target] = remote;
      return [L(`ramo '${target}' configurado para rastrear '${remote}'.`, 'ok'), ...this.switchTo(target)];
    }
    throw new GitError(`fatal: referência inválida: ${target}`, {
      hint: `A branch '${target}' não existe. Branches existentes: ${Object.keys(r.branches).join(', ') || '(nenhuma)'}. Para criá-la: git switch -c ${target}`,
      concept: COMMON_CONCEPT.branch
    });
  }

  cmdMerge(args) {
    const r = this.requireRepo(), s = this.state;
    if (args.includes('--abort')) {
      if (!s.merge) throw new GitError('fatal: Não há merge para abortar (MERGE_HEAD ausente).', { hint: 'Só dá para abortar enquanto um merge com conflitos está em andamento.' });
      this.hardTo(this.headTree());
      s.merge = null;
      return [L('Merge abortado. Tudo voltou ao estado anterior.', 'ok')];
    }
    const name = args.find(a => !a.startsWith('-'));
    if (!name) throw new GitError('fatal: nenhum ramo informado para mesclar', { hint: 'Ex.: git merge feature-login (você precisa estar na branch que vai RECEBER as mudanças).' });
    if (!this.headId()) throw new GitError('fatal: não é possível mesclar: o ramo atual ainda não tem commits', { hint: 'Faça um commit primeiro.' });
    let id = r.branches[name] || r.tracking[name];
    if (!id) throw new GitError(`merge: ${name} - não é algo que possamos mesclar`, { hint: `A branch '${name}' não existe. Veja as existentes com git branch.`, concept: 'git merge traz para a branch ATUAL as mudanças de outra branch.' });
    return this.mergeInto(id, name, { noff: args.includes('--no-ff') });
  }

  cmdDiff(args) {
    const r = this.requireRepo(), s = this.state;
    const staged = args.includes('--staged') || args.includes('--cached');
    const dd = args.indexOf('--');
    let revs = [], paths = [];
    args.forEach((a, i) => {
      if (a.startsWith('-')) return;
      if (dd >= 0 && i > dd) paths.push(a);
      else if (dd < 0 && (s.files[this.norm(a)] !== undefined || r.index[this.norm(a)] !== undefined || this.isDir(a))) paths.push(a);
      else revs.push(a);
    });
    const filter = paths.length ? (p => paths.some(x => p === this.norm(x) || p.startsWith(this.norm(x) + '/'))) : null;
    const wdTracked = idxLike => { const o = {}; Object.keys(idxLike).forEach(p => { if (p in s.files) o[p] = s.files[p]; }); return o; };
    let A, B;
    if (revs.length) {
      const split = revs[0].includes('..') ? revs[0].split('..') : revs;
      A = this.treeOf(this.resolve(split[0]));
      B = split[1] ? this.treeOf(this.resolve(split[1])) : (staged ? r.index : wdTracked(A));
    } else if (staged) { A = this.headTree(); B = r.index; }
    else { A = r.index; B = wdTracked(r.index); }
    return this.diffTreesLines(A, B, filter);
  }

  cmdRestore(args) {
    this.requireRepo();
    let staged = false, worktree = false, source = null; const paths = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--staged' || a === '-S') staged = true;
      else if (a === '--worktree' || a === '-W') worktree = true;
      else if (a === '--source' || a === '-s') source = args[++i];
      else if (a.startsWith('--source=')) source = a.slice(9);
      else if (a === '--') continue;
      else if (a.startsWith('-') && a !== '.') continue;
      else paths.push(a);
    }
    if (!paths.length) throw new GitError('fatal: você deve especificar o(s) caminho(s) para restaurar', { hint: 'Ex.: git restore arquivo.txt (descarta mudanças) ou git restore --staged arquivo.txt (tira da Staging).', concept: 'git restore desfaz mudanças em arquivos sem mexer no histórico.' });
    const done = this.restorePaths(paths, { staged, worktree, source });
    return [];
  }

  cmdReset(args) {
    const r = this.requireRepo(), s = this.state;
    let mode = null; const rest = [];
    for (const a of args) {
      if (a === '--soft') mode = 'soft'; else if (a === '--mixed') mode = 'mixed'; else if (a === '--hard') mode = 'hard'; else rest.push(a);
    }
    const dd = rest.indexOf('--');
    let rev = null, paths = [];
    if (dd >= 0) { paths = rest.slice(dd + 1); if (dd > 0) rev = rest[0]; }
    else if (rest.length) {
      try { this.resolve(rest[0]); rev = rest[0]; paths = rest.slice(1); }
      catch (e) {
        if (s.files[this.norm(rest[0])] !== undefined || r.index[this.norm(rest[0])] !== undefined || this.headTree()[this.norm(rest[0])] !== undefined) paths = rest;
        else throw e;
      }
    }
    if (paths.length) {
      if (mode === 'hard') throw new GitError('fatal: Não é possível fazer reset --hard com caminhos.', { hint: 'Para descartar mudanças de um arquivo use git restore arquivo.' });
      this.restorePaths(paths, { staged: true, source: rev });
      const diffs = this.status().unstaged;
      return diffs.length ? [L('Mudanças não staged após o reset:'), ...diffs.map(x => L(`${x.kind === 'deleted' ? 'D' : 'M'}\t${x.path}`))] : [];
    }
    if (!this.headId()) throw new GitError("fatal: argumento ambíguo 'HEAD': revisão desconhecida ou caminho fora da árvore de trabalho.", { hint: 'Ainda não existem commits para onde voltar.' });
    mode = mode || 'mixed';
    const target = rev ? this.resolve(rev) : this.headId(), tree = this.treeOf(target), out = [];
    if (mode === 'hard') { this.hardTo(tree); s.merge = null; }
    else if (mode === 'mixed') { r.index = { ...tree }; s.merge = null; }
    const old = this.headId();
    r.branches[r.head] = target;
    if (mode === 'hard') out.push(L(`HEAD agora está em ${this.short(target)} ${r.commits[target].msg.split('\n')[0]}`, 'ok'));
    else if (mode === 'mixed') {
      const d = this.status().unstaged;
      if (d.length) out.push(L('Mudanças não staged após o reset:'), ...d.map(x => L(`${x.kind === 'deleted' ? 'D' : 'M'}\t${x.path}`)));
    }
    this.emit('reset', { mode, from: old, to: target });
    return out;
  }

  cmdClone(args) {
    const s = this.state;
    const url = args.find(a => !a.startsWith('-'));
    if (!url) throw new GitError('fatal: Você deve especificar um repositório para clonar.', { hint: 'Ex.: git clone https://github.com/time/projeto.git' });
    if (s.repo || Object.keys(s.files).length) {
      throw new GitError("fatal: o caminho de destino '.' já existe e não é um diretório vazio.", {
        hint: 'No playground o clone ocupa a pasta do projeto. Use "Novo projeto vazio" no Explorador (botão ⋯) e clone de novo.',
        concept: 'git clone copia um repositório remoto inteiro (arquivos + todo o histórico) e já configura o remoto "origin".'
      });
    }
    let srv = s.servers[url];
    if (!srv || !Object.keys(srv.branches).length) srv = this.seedSample(url);
    const names = Object.keys(srv.branches), b = names.includes('main') ? 'main' : names[0];
    const commits = JSON.parse(JSON.stringify(srv.commits)), tree = commits[srv.branches[b]].tree;
    s.repo = { head: b, branches: { [b]: srv.branches[b] }, commits, index: { ...tree }, remotes: { origin: url }, tracking: {}, upstream: { [b]: 'origin/' + b } };
    names.forEach(n => { s.repo.tracking['origin/' + n] = srv.branches[n]; });
    s.files = { ...tree }; s.dirs = [];
    const name = url.split('/').pop().replace(/\.git$/, '') || 'projeto';
    const n = Object.keys(commits).length;
    this.emit('clone', { url });
    return [L(`Clonando em '${name}'...`), L(`remote: Enumerando objetos: ${n * 3}, concluído.`, 'dim'), L(`remote: Total ${n * 3} (delta 0), reutilizado 0 (delta 0)`, 'dim'),
      L(`Recebendo objetos: 100% (${n * 3}/${n * 3}), concluído.`), L('Clone concluído: arquivos e histórico agora estão no seu projeto.', 'ok')];
  }

  cmdRemote(args) {
    const r = this.requireRepo();
    const sub = args.find(a => !a.startsWith('-')), verbose = args.includes('-v') || args.includes('--verbose');
    if (!sub) {
      const names = Object.keys(r.remotes);
      if (!verbose) return names.map(n => L(n));
      const out = [];
      names.forEach(n => { out.push(L(`${n}\t${r.remotes[n]} (fetch)`)); out.push(L(`${n}\t${r.remotes[n]} (push)`)); });
      return out;
    }
    const pos = args.filter(a => !a.startsWith('-'));
    if (sub === 'add') {
      const [, name, url] = pos;
      if (!name || !url) throw new GitError('uso: git remote add <nome> <url>', { hint: 'Ex.: git remote add origin https://github.com/aluno/meu-projeto.git', concept: 'Um "remote" é um apelido para a URL de outra cópia do repositório (GitHub, por exemplo). O nome padrão é origin.' });
      if (r.remotes[name]) throw new GitError(`erro: o remoto ${name} já existe.`, { hint: 'Para trocar a URL: git remote remove ' + name + ' e adicione de novo.' });
      r.remotes[name] = url;
      this.serverFor(url);
      this.emit('remote', { name, url });
      return [];
    }
    if (sub === 'remove' || sub === 'rm') {
      if (!r.remotes[pos[1]]) throw new GitError(`erro: Remoto não encontrado: ${pos[1]}`);
      delete r.remotes[pos[1]];
      Object.keys(r.tracking).forEach(k => { if (k.startsWith(pos[1] + '/')) delete r.tracking[k]; });
      Object.keys(r.upstream).forEach(k => { if (r.upstream[k].startsWith(pos[1] + '/')) delete r.upstream[k]; });
      return [];
    }
    if (sub === 'get-url') {
      if (!r.remotes[pos[1]]) throw new GitError(`erro: Remoto não encontrado: ${pos[1]}`);
      return [L(r.remotes[pos[1]])];
    }
    throw new GitError(`erro: subcomando desconhecido: ${sub}`, { hint: 'Subcomandos: add, remove, get-url. Use git remote -v para listar.' });
  }

  cmdPush(args) {
    const r = this.requireRepo();
    let setU = false, force = false; const pos = [];
    args.forEach(a => {
      if (a === '-u' || a === '--set-upstream') setU = true;
      else if (a === '-f' || a === '--force') force = true;
      else if (!a.startsWith('-')) pos.push(a);
    });
    const upRemote = r.upstream[r.head] ? r.upstream[r.head].split('/')[0] : null;
    const remote = pos[0] || upRemote || 'origin';
    if (!Object.keys(r.remotes).length || !r.remotes[remote]) {
      throw new GitError(pos[0] ? `fatal: '${pos[0]}' não parece ser um repositório git\nfatal: Não foi possível ler do repositório remoto.` : 'fatal: Nenhum destino de push configurado.', {
        hint: 'Você ainda não conectou este projeto a um remoto. Use: git remote add origin <url>',
        concept: 'push envia seus commits para outro repositório (o remoto). Antes é preciso dizer onde ele está com git remote add.'
      });
    }
    let branch = pos[1] || r.head;
    if (branch === 'HEAD') branch = r.head;
    if (!pos.length && !r.upstream[r.head] && !setU) {
      throw new GitError(`fatal: O ramo atual ${r.head} não tem um ramo upstream.\nPara fazer push do ramo atual e definir o remoto como upstream, use\n\n    git push --set-upstream ${remote} ${r.head}`, {
        hint: `Primeira vez enviando esta branch? Use: git push -u ${remote} ${r.head}. O -u grava a ligação para os próximos "git push" e "git pull" simples.`,
        concept: 'Upstream é a branch remota que a sua branch local acompanha.'
      });
    }
    const id = r.branches[branch];
    if (!id) throw new GitError(`erro: o src refspec ${branch} não corresponde a nenhum`, { hint: 'Não existe commit/branch com esse nome para enviar. Faça um commit antes (git commit) e confira git branch.' });
    const url = r.remotes[remote], srv = this.serverFor(url), old = srv.branches[branch];
    const out = [];
    if (old && !force && old !== id && !this.ancestors(id).has(old)) {
      throw new GitError(`To ${url}\n ! [rejeitado]        ${branch} -> ${branch} (busca antes)\nerro: falhou ao enviar algumas referências para '${url}'\ndica: Atualizações foram rejeitadas porque o remoto contém trabalho que você\ndica: não tem localmente. Integre as mudanças remotas (ex.: 'git pull ...')\ndica: antes de fazer push novamente.`, {
        hint: 'Alguém (ou outra máquina) enviou commits antes de você. Rode git pull para trazê-los, resolva conflitos se houver e então git push.',
        concept: 'O Git não deixa você sobrescrever o histórico remoto. Primeiro integre o que está lá (pull), depois envie.'
      });
    }
    if (old === id) {
      out.push(L('Tudo atualizado'));
    } else {
      let n = 0;
      this.ancestors(id).forEach(x => { if (!srv.commits[x]) { srv.commits[x] = r.commits[x]; n++; } });
      srv.branches[branch] = id;
      r.tracking[`${remote}/${branch}`] = id;
      out.push(L(`Enumerando objetos: ${n * 3}, concluído.`, 'dim'), L(`Contagem de objetos: 100% (${n * 3}/${n * 3}), concluído.`, 'dim'), L(`Escrevendo objetos: 100% (${n * 3}/${n * 3}), ${n * 312} bytes | ${n * 312} bytes/s, concluído.`, 'dim'));
      out.push(L(`To ${url}`));
      out.push(L(old ? `   ${this.short(old)}..${this.short(id)}  ${branch} -> ${branch}` : ` * [novo ramo]      ${branch} -> ${branch}`, 'ok'));
      this.emit('push', { branch, remote, url, commits: n });
    }
    r.tracking[`${remote}/${branch}`] = id;
    if (setU) { r.upstream[branch] = `${remote}/${branch}`; out.push(L(`ramo '${branch}' configurado para rastrear '${remote}/${branch}'.`, 'ok')); }
    return out;
  }

  fetchFrom(remote) {
    const r = this.repo, url = r.remotes[remote], srv = this.serverFor(url), out = [];
    Object.entries(srv.commits).forEach(([id, c]) => { if (!r.commits[id]) r.commits[id] = JSON.parse(JSON.stringify(c)); });
    let first = true;
    Object.entries(srv.branches).forEach(([b, id]) => {
      const key = `${remote}/${b}`, old = r.tracking[key];
      if (old === id) return;
      if (first) { out.push(L(`De ${url}`)); first = false; }
      out.push(L(old ? `   ${this.short(old)}..${this.short(id)}  ${b.padEnd(10)} -> ${key}` : ` * [novo ramo]      ${b.padEnd(10)} -> ${key}`, 'ok'));
      r.tracking[key] = id;
    });
    if (!first) this.emit('fetch', { remote });
    return out;
  }

  cmdFetch(args) {
    const r = this.requireRepo();
    const remote = args.find(a => !a.startsWith('-')) || (r.upstream[r.head] ? r.upstream[r.head].split('/')[0] : 'origin');
    if (!r.remotes[remote]) throw new GitError(`fatal: '${remote}' não parece ser um repositório git`, { hint: 'Adicione um remoto primeiro: git remote add origin <url>' });
    return this.fetchFrom(remote);
  }

  cmdPull(args) {
    const r = this.requireRepo();
    if (args.includes('--rebase')) throw new GitError('git pull --rebase ainda não está disponível no simulador.', { hint: 'Use git pull (que faz fetch + merge).' });
    const pos = args.filter(a => !a.startsWith('-'));
    let remote, branch;
    if (pos.length) { remote = pos[0]; branch = pos[1] || r.head; }
    else if (r.upstream[r.head]) { const [rm, ...b] = r.upstream[r.head].split('/'); remote = rm; branch = b.join('/'); }
    else {
      throw new GitError(`Não há informações de rastreamento para o ramo atual.\nPor favor especifique com qual ramo você quer mesclar.\n\n    git pull <remoto> <ramo>\n\nSe desejar configurar informações de rastreamento para este ramo você pode fazer isso com:\n\n    git branch --set-upstream-to=origin/<ramo> ${r.head}`, {
        hint: `Sua branch não sabe de onde puxar. Tente: git pull origin ${r.head}  (ou ligue a branch ao remoto com git push -u origin ${r.head}).`,
        concept: 'git pull = git fetch (baixa os commits novos) + git merge (junta na sua branch atual).'
      });
    }
    if (!r.remotes[remote]) throw new GitError(`fatal: '${remote}' não parece ser um repositório git`, { hint: 'Adicione um remoto primeiro: git remote add origin <url>' });
    const out = this.fetchFrom(remote);
    const id = r.tracking[`${remote}/${branch}`];
    if (!id) throw new GitError(`fatal: Não foi possível encontrar a referência remota ${branch}`, { hint: `O remoto '${remote}' ainda não tem a branch '${branch}'. Envie com git push -u ${remote} ${branch}.` });
    const res = this.mergeInto(id, `${remote}/${branch}`);
    this.emit('pull', { remote, branch });
    return [...out, ...res];
  }

  cmdRm(args) {
    const r = this.requireRepo(), s = this.state;
    const cached = args.includes('--cached');
    const pos = args.filter(a => !a.startsWith('-'));
    if (!pos.length) throw new GitError('fatal: nenhum arquivo informado', { hint: 'Ex.: git rm arquivo.txt' });
    const out = [];
    pos.forEach(pat => {
      const p = this.norm(pat);
      const hit = Object.keys(r.index).filter(k => k === p || k.startsWith(p + '/'));
      if (!hit.length) throw new GitError(`fatal: o caminho '${pat}' não correspondeu a nenhum arquivo`, { hint: 'git rm só remove arquivos que o Git já rastreia.' });
      hit.forEach(k => { delete r.index[k]; if (!cached) delete s.files[k]; out.push(L(`rm '${k}'`)); });
    });
    this.emit('stage', { paths: pos, removed: true });
    return out;
  }

  cmdConfig(args) {
    const pos = args.filter(a => !a.startsWith('-')), s = this.state;
    if (args.includes('--list') || args.includes('-l')) return [L(`user.name=${s.user.name}`), L(`user.email=${s.user.email}`)];
    const [k, v] = pos;
    if (k === 'user.name') { if (v) s.user.name = v; else return [L(s.user.name)]; return []; }
    if (k === 'user.email') { if (v) s.user.email = v; else return [L(s.user.email)]; return []; }
    if (!k) throw new GitError('uso: git config [--global] <chave> <valor>', { hint: 'Ex.: git config --global user.name "Seu Nome"' });
    return [];
  }
}

const GIT_COMMAND_NAMES = ['init', 'status', 'add', 'commit', 'log', 'branch', 'checkout', 'switch', 'merge', 'diff', 'restore', 'reset', 'clone', 'remote', 'push', 'pull', 'fetch', 'show', 'rm', 'config'];
const GIT_UNSUPPORTED = ['stash', 'rebase', 'cherry-pick', 'revert', 'tag', 'blame', 'reflog', 'bisect', 'mv', 'clean', 'apply', 'worktree'];
