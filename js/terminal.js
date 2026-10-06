/* Terminal — interpreta o que o aluno digita (git + comandos básicos de shell),
   chama o Git Engine, desenha a saída colorida e ensina com mensagens educativas. */

const SHELL_COMMANDS = ['ls', 'cat', 'touch', 'mkdir', 'rm', 'echo', 'mv', 'cp', 'pwd', 'cd', 'clear', 'history', 'help', 'code', 'nano'];
const FILE_ARG_COMMANDS = ['add', 'restore', 'diff', 'rm', 'show', 'reset'];
const BRANCH_ARG_COMMANDS = ['checkout', 'switch', 'merge', 'branch', 'log', 'reset', 'diff', 'show'];

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
function closest(word, options, max = 2) {
  let best = null, bd = Infinity;
  options.forEach(o => { const d = levenshtein(word, o); if (d < bd) { bd = d; best = o; } });
  return bd <= Math.max(1, Math.min(max, Math.floor(word.length / 2))) ? best : null;
}

/* Explicações educativas exibidas na área de feedback depois de cada comando bem-sucedido. */
const EXPLAIN = {
  init: ['Repositório criado', 'O Git criou uma pasta oculta .git que guarda todo o histórico. Agora seus arquivos podem ser versionados — mas ainda nenhum foi adicionado.'],
  status: ['Seu ponto de situação', 'git status mostra o que está na Working Directory (vermelho), na Staging Area (verde) e em qual branch você está. Rode sempre que estiver em dúvida!'],
  add: ['Arquivos na Staging Area', 'git add copia a versão atual dos arquivos para a Staging Area, a "sala de espera" do próximo commit. Você só prepara — nada foi salvo no histórico ainda.'],
  commit: ['Commit criado', 'Um commit é uma foto permanente da Staging Area, com autor, data e mensagem. Ele aponta para o commit anterior, formando a história do projeto.'],
  log: ['Histórico', 'Cada bloco é um commit, do mais recente para o mais antigo. O hash identifica o commit; HEAD -> main mostra onde você está.'],
  branch: ['Branches', 'Branches são ponteiros leves para commits. A branch com * é a atual. Criar uma não muda seus arquivos: para ir até ela use git switch.'],
  checkout: ['Mudou de branch', 'Seus arquivos agora refletem o último commit da branch escolhida. Mudanças não commitadas viajam junto (se não houver conflito).'],
  switch: ['Mudou de branch', 'git switch é o comando moderno para trocar de branch (e -c cria uma nova). Seus arquivos agora refletem a branch escolhida.'],
  merge: ['Merge concluído', 'O merge juntou o histórico da outra branch com o da branch atual. Fast-forward = só andou o ponteiro; caso contrário o Git criou um commit de merge com dois pais.'],
  diff: ['Diferenças', 'Linhas com - (vermelho) saíram, linhas com + (verde) entraram. git diff compara o disco com a Staging; git diff --staged compara a Staging com o último commit.'],
  restore: ['Arquivo restaurado', 'git restore trouxe a versão salva de volta. Sem --staged ele sobrescreve o arquivo no disco; com --staged apenas tira da Staging Area.'],
  reset: ['Branch movida', 'git reset move a branch para outro commit. --soft mantém tudo staged, --mixed (padrão) mantém os arquivos no disco, --hard descarta também os arquivos.'],
  clone: ['Repositório clonado', 'git clone baixou arquivos + histórico e configurou o remoto "origin" com a branch main rastreando origin/main.'],
  remote: ['Remotos', 'Um remoto é um apelido (origin) para a URL de outra cópia do repositório, como o GitHub.'],
  push: ['Commits enviados', 'git push publicou seus commits no remoto. Agora origin/main aponta para o mesmo commit da sua main.'],
  pull: ['Repositório sincronizado', 'git pull = fetch (baixar commits novos) + merge (juntar na sua branch).'],
  fetch: ['Novidades baixadas', 'git fetch baixa commits do remoto sem mexer nos seus arquivos. Use git merge origin/main para integrá-los.'],
  show: ['Detalhes do commit', 'git show exibe a mensagem e as mudanças exatas introduzidas por um commit.'],
  rm: ['Arquivo removido', 'git rm apaga o arquivo e já registra a remoção na Staging Area. Com --cached ele só para de rastrear o arquivo.'],
  config: ['Configuração salva', 'O Git usa user.name e user.email para identificar o autor dos seus commits.']
};

function nextStep(engine) {
  if (!engine.repo) return 'Próximo passo: transforme a pasta em repositório com git init.';
  const st = engine.status(), r = engine.repo;
  if (st.conflicts.length) return `Próximo passo: resolva o conflito em ${st.conflicts[0]} (remova os marcadores), depois git add e git commit.`;
  if (st.staged.length) return 'Próximo passo: grave com git commit -m "mensagem".';
  if (st.unstaged.length) return `Próximo passo: git add ${st.unstaged[0].path} para preparar a mudança.`;
  if (st.untracked.length) return `Próximo passo: git add ${st.untracked[0]} para o Git passar a rastrear o arquivo.`;
  const ab = engine.aheadBehind();
  if (ab && ab.ahead) return 'Próximo passo: git push para enviar seus commits.';
  if (ab && ab.behind) return 'Próximo passo: git pull para trazer o que o time enviou.';
  if (!engine.headId()) return 'Crie ou edite um arquivo e faça o primeiro commit.';
  return 'Tudo limpo! Edite um arquivo no editor e continue o ciclo: add → commit.';
}

class GitTerminal {
  constructor(opts) {
    this.o = opts;
    this.out = opts.out; this.input = opts.input; this.promptEl = opts.promptEl;
    this.lines = []; this.history = []; this.hIdx = 0; this.busy = false; this.draft = '';
    this.input.addEventListener('keydown', e => this.onKey(e));
    this.out.parentElement.addEventListener('mousedown', e => {
      if (window.getSelection().toString()) return;
      setTimeout(() => { if (!window.getSelection().toString()) this.input.focus(); }, 0);
    });
  }

  get engine() { return this.o.getEngine(); }

  /* ---------- prompt ---------- */
  promptHTML(branchLabel) {
    const br = branchLabel ? ` <span class="p-branch">(${branchLabel})</span>` : '';
    return `<span class="p-user">aluno</span><span class="p-at">@</span><span class="p-host">git-playground</span><span class="p-sep">:</span><span class="p-path">~/meu-projeto</span>${br} <span class="p-dollar">$</span>`;
  }
  branchLabel() {
    const e = this.engine;
    if (!e.repo) return '';
    return e.repo.head + (e.state.merge ? '|MESCLANDO' : '');
  }
  updatePrompt() { this.promptEl.innerHTML = this.promptHTML(this.branchLabel()); }

  /* ---------- saída ---------- */
  renderLine(l, i = 0, animate = true) {
    const d = document.createElement('div');
    d.className = 'tl' + (l.c ? ' ' + l.c : '');
    if (animate) { d.classList.add('tl-in'); d.style.animationDelay = Math.min(i * 16, 420) + 'ms'; }
    if (l.c === 'cmdline') {
      d.innerHTML = this.promptHTML(l.br);
      const s = document.createElement('span'); s.className = 'p-cmd'; s.textContent = ' ' + l.t; d.appendChild(s);
    } else if (l.seg) {
      l.seg.forEach(p => { const s = document.createElement('span'); if (p.c) s.className = 's-' + p.c; s.textContent = p.t; d.appendChild(s); });
    } else d.textContent = l.t;
    return d;
  }
  print(lines, animate = true) {
    lines = Array.isArray(lines) ? lines : [lines];
    const frag = document.createDocumentFragment();
    lines.forEach((l, i) => { frag.appendChild(this.renderLine(l, i, animate && lines.length < 80)); this.lines.push(l); });
    this.out.appendChild(frag);
    if (this.lines.length > 400) {
      const drop = this.lines.length - 300;
      this.lines.splice(0, drop);
      for (let i = 0; i < drop && this.out.firstChild; i++) this.out.removeChild(this.out.firstChild);
    }
    this.scroll();
  }
  scroll() { this.out.scrollTop = this.out.scrollHeight; }
  clear() { this.out.innerHTML = ''; this.lines = []; }
  focus() { this.input.focus(); }

  welcome() {
    this.print([
      L('╔══════════════════════════════════════════╗', 'dim'),
      L('║   Git Playground — seu laboratório de Git ║', 'ok'),
      L('╚══════════════════════════════════════════╝', 'dim'),
      L('Digite comandos Git de verdade. Nada aqui pode quebrar seu computador.', 'dim'),
      L('Dicas: Tab completa • ↑/↓ histórico • "help" lista os comandos', 'dim'),
      L('')
    ], false);
  }

  serialize() { return { lines: this.lines.slice(-200), history: this.history.slice(-100) }; }
  restore(data) {
    this.clear();
    if (data && data.lines && data.lines.length) {
      const frag = document.createDocumentFragment();
      data.lines.forEach(l => { frag.appendChild(this.renderLine(l, 0, false)); this.lines.push(l); });
      this.out.appendChild(frag);
      this.history = data.history || [];
    } else { this.history = (data && data.history) || []; this.welcome(); }
    this.hIdx = this.history.length;
    this.updatePrompt(); this.scroll();
  }

  /* ---------- teclado ---------- */
  onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); const v = this.input.value; this.input.value = ''; this.submit(v); }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.hIdx === this.history.length) this.draft = this.input.value;
      if (this.hIdx > 0) { this.hIdx--; this.input.value = this.history[this.hIdx]; }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (this.hIdx < this.history.length) { this.hIdx++; this.input.value = this.hIdx === this.history.length ? this.draft : this.history[this.hIdx]; }
    } else if (e.key === 'Tab') { e.preventDefault(); this.autocomplete(); }
    else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); this.clear(); this.o.onClear && this.o.onClear(); }
    else if (e.key === 'c' && e.ctrlKey && !window.getSelection().toString()) {
      e.preventDefault(); this.print([{ c: 'cmdline', br: this.branchLabel(), t: this.input.value + '^C' }], false); this.input.value = '';
    }
  }

  autocomplete() {
    const val = this.input.value, parts = val.split(/\s+/), last = parts[parts.length - 1], e = this.engine;
    let cands = [];
    if (parts.length === 1) cands = ['git', ...SHELL_COMMANDS];
    else if (parts[0] === 'git' && parts.length === 2) cands = [...GIT_COMMAND_NAMES, 'help'];
    else if (parts[0] === 'git') {
      const sub = parts[1];
      if (last.startsWith('-')) {
        const flags = { commit: ['-m', '-am', '--amend'], log: ['--oneline', '--graph', '--all'], diff: ['--staged'], restore: ['--staged', '--source='], reset: ['--soft', '--mixed', '--hard'], push: ['-u', '--set-upstream'], status: ['-s'], branch: ['-d', '-D', '-a', '-m'], checkout: ['-b'], switch: ['-c'], merge: ['--no-ff', '--abort'], remote: ['-v'] }[sub] || [];
        cands = flags;
      } else {
        if (FILE_ARG_COMMANDS.includes(sub)) cands.push(...this.pathCandidates());
        if (BRANCH_ARG_COMMANDS.includes(sub) && e.repo) cands.push(...Object.keys(e.repo.branches), ...Object.keys(e.repo.tracking), 'HEAD', 'HEAD~1');
        if (sub === 'remote') cands.push('add', '-v', 'remove');
        if ((sub === 'push' || sub === 'pull' || sub === 'fetch') && e.repo) cands.push(...Object.keys(e.repo.remotes), ...Object.keys(e.repo.branches));
        if (sub === 'add') cands.push('.');
      }
    } else cands = this.pathCandidates();
    cands = [...new Set(cands)].filter(c => c.startsWith(last) && c !== last);
    if (!cands.length) return;
    const prefix = parts.slice(0, -1).join(' ') + (parts.length > 1 ? ' ' : '');
    if (cands.length === 1) { this.input.value = prefix + cands[0] + (cands[0].endsWith('/') || cands[0].endsWith('=') ? '' : ' '); return; }
    let common = cands[0];
    cands.forEach(c => { while (!c.startsWith(common)) common = common.slice(0, -1); });
    this.input.value = prefix + common;
    this.print([{ c: 'cmdline', br: this.branchLabel(), t: val }, L(cands.join('   '), 'dim')], false);
  }

  pathCandidates() {
    const e = this.engine;
    return [...Object.keys(e.files), ...e.allDirs().map(d => d + '/')];
  }

  /* ---------- execução ---------- */
  tokenize(str) {
    const toks = []; let cur = '', q = null, has = false;
    const push = () => { if (has) { toks.push({ v: cur }); cur = ''; has = false; } };
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (q) { if (ch === q) q = null; else cur += ch; continue; }
      if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
      if (/\s/.test(ch)) { push(); continue; }
      if (ch === '&' && str[i + 1] === '&') { push(); toks.push({ op: '&&' }); i++; continue; }
      if (ch === '>') { push(); if (str[i + 1] === '>') { toks.push({ op: '>>' }); i++; } else toks.push({ op: '>' }); continue; }
      cur += ch; has = true;
    }
    if (q) throw new GitError('aspas não foram fechadas', { hint: `Você abriu aspas (${q}) e esqueceu de fechar. Mensagens de commit ficam entre aspas: git commit -m "texto".` });
    push();
    return toks;
  }

  async submit(raw) {
    if (this.busy) return;
    const line = raw.trim();
    this.print([{ c: 'cmdline', br: this.branchLabel(), t: raw }], false);
    if (!line) return;
    if (this.history[this.history.length - 1] !== line) this.history.push(line);
    this.hIdx = this.history.length; this.draft = '';
    this.busy = true; this.input.disabled = true;
    const results = [];
    try {
      let toks;
      try { toks = this.tokenize(line); }
      catch (err) { this.print([L(err.message, 'err')]); results.push({ ok: false, error: err, line, sub: null }); toks = []; }
      const groups = [[]];
      toks.forEach(t => { if (t.op === '&&') groups.push([]); else groups[groups.length - 1].push(t); });
      for (const g of groups) {
        if (!g.length) continue;
        const res = await this.runGroup(g, line);
        results.push(res);
        if (!res.ok) break;
      }
    } finally {
      this.busy = false; this.input.disabled = false; this.input.focus();
      this.updatePrompt();
    }
    this.o.onRun({ line, results });
  }

  async runGroup(toks, line) {
    let redir = null; const words = [];
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].op === '>' || toks[i].op === '>>') { redir = { op: toks[i].op, target: toks[i + 1] && toks[i + 1].v }; i++; }
      else if (toks[i].v !== undefined) words.push(toks[i].v);
    }
    const cmd = words[0], args = words.slice(1);
    const res = { ok: true, kind: 'shell', sub: null, args, cmd, line };
    try {
      if (cmd === 'git') {
        res.kind = 'git';
        res.sub = args[0] || null;
        const lines = await this.runGit(args);
        res.lines = lines;
        if (lines.length) this.print(lines);
      } else {
        const lines = this.runShell(cmd, args, redir);
        res.lines = lines;
        if (lines.length) this.print(lines);
      }
    } catch (err) {
      res.ok = false;
      if (!(err instanceof GitError)) { console.error(err); err = new GitError('erro interno do simulador: ' + err.message); }
      res.error = err;
      this.print(err.message.split('\n').map(m => L(m, 'err')));
    }
    return res;
  }

  async runGit(args) {
    const e = this.engine, sub = args[0];
    if (!sub || sub === '--help' || sub === '-h' || sub === 'help') return this.gitHelp();
    if (sub === '--version' || sub === 'version') return [L('git version 2.43.0')];
    if (sub === 'clean' || GIT_UNSUPPORTED.includes(sub)) {
      throw new GitError(`O comando 'git ${sub}' existe no Git real, mas ainda não foi implementado neste simulador.`, {
        hint: 'Foque nos comandos disponíveis: ' + GIT_COMMAND_NAMES.join(', ') + '.'
      });
    }
    if (!e.commands[sub]) {
      const near = closest(sub, [...GIT_COMMAND_NAMES, ...GIT_UNSUPPORTED]);
      const msg = `git: '${sub}' não é um comando do git. Veja 'git --help'.` + (near ? `\n\nO comando mais similar é\n\t${near}` : '');
      throw new GitError(msg, {
        hint: near ? `Parece um erro de digitação. Você quis dizer "git ${near}"?` : 'Digite "git help" para ver os comandos disponíveis.',
        concept: 'Os comandos do Git são subcomandos: git <comando> [opções]. Um erro de digitação é o erro mais comum — acontece com todo mundo!'
      });
    }
    if (['push', 'pull', 'fetch', 'clone'].includes(sub)) await this.spinner(sub === 'clone' ? 'Clonando repositório...' : 'Conectando ao remoto...');
    return e.commands[sub](args.slice(1));
  }

  async spinner(text) {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const d = document.createElement('div'); d.className = 'tl dim';
    this.out.appendChild(d); this.scroll();
    let i = 0;
    const t = setInterval(() => { d.textContent = frames[i++ % frames.length] + ' ' + text; }, 70);
    await new Promise(r => setTimeout(r, 650));
    clearInterval(t); d.remove();
  }

  gitHelp() {
    return [
      L('uso: git <comando> [<argumentos>]', 'bold'), L(''),
      L('Comandos disponíveis neste playground:'),
      L('   init      Cria um repositório vazio'),
      L('   clone     Clona um repositório remoto'),
      L('   status    Mostra o estado dos arquivos'),
      L('   add       Coloca arquivos na Staging Area'),
      L('   commit    Grava as mudanças no histórico'),
      L('   log       Mostra o histórico de commits'),
      L('   show      Mostra um commit'),
      L('   diff      Mostra as diferenças'),
      L('   restore   Restaura arquivos / tira da Staging'),
      L('   reset     Move a branch para outro commit'),
      L('   branch    Lista, cria ou apaga branches'),
      L('   switch    Troca de branch'),
      L('   checkout  Troca de branch / restaura arquivos'),
      L('   merge     Junta o histórico de outra branch'),
      L('   remote    Gerencia repositórios remotos'),
      L('   push      Envia commits ao remoto'),
      L('   pull      Baixa e integra commits do remoto'),
      L('   fetch     Baixa commits sem integrar'),
      L('   rm        Remove arquivos'),
      L('')
    ];
  }

  /* ---------- shell mínimo ---------- */
  runShell(cmd, args, redir) {
    const e = this.engine, fsChanged = () => this.o.onFsChange && this.o.onFsChange();
    const noFile = (c, p) => new GitError(`${c}: ${p}: Arquivo ou diretório inexistente`, { hint: 'Confira o nome no Explorador ou com ls.' });
    const flags = args.filter(a => a.startsWith('-')), pos = args.filter(a => !a.startsWith('-'));
    switch (cmd) {
      case 'clear': this.clear(); this.o.onClear && this.o.onClear(); return [];
      case 'pwd': return [L('/home/aluno/meu-projeto')];
      case 'cd': return [L('No playground o terminal fica sempre na raiz do projeto (meu-projeto).', 'dim')];
      case 'history': return this.history.map((h, i) => L(`${String(i + 1).padStart(4)}  ${h}`));
      case 'help': return [L('Comandos de shell: ls, cat, touch, mkdir, rm, mv, cp, echo, code <arquivo>, clear, history', 'bold'), L('Comandos Git: digite "git help"'), L('Dica: echo "texto" > arquivo.txt cria/sobrescreve um arquivo; >> acrescenta.')];
      case 'ls': {
        const dir = pos[0] ? e.norm(pos[0]) : '';
        if (dir && !e.isDir(dir)) { if (e.isFile(dir)) return [L(dir)]; throw noFile('ls', pos[0]); }
        const prefix = dir ? dir + '/' : '', names = new Map();
        e.allDirs().forEach(d => { if (d.startsWith(prefix) && !d.slice(prefix.length).includes('/') && d !== dir) names.set(d.slice(prefix.length), 'dir'); });
        Object.keys(e.files).forEach(f => { if (f.startsWith(prefix) && !f.slice(prefix.length).includes('/')) names.set(f.slice(prefix.length), 'file'); });
        if (flags.some(f => f.includes('a')) && !dir && e.repo) names.set('.git', 'dir');
        const sorted = [...names.entries()].sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] === 'dir' ? -1 : 1));
        if (!sorted.length) return [];
        return [{ t: sorted.map(n => n[0]).join('  '), c: '', seg: sorted.map(([n, k], i) => ({ t: n + (k === 'dir' ? '/' : '') + (i < sorted.length - 1 ? '  ' : ''), c: k === 'dir' ? 'dir' : '' })) }];
      }
      case 'cat': {
        if (!pos.length) throw new GitError('cat: informe um arquivo', { hint: 'Ex.: cat index.html' });
        const out = [];
        pos.forEach(p => {
          if (e.isFile(p)) { const c = e.readFile(p); out.push(...splitLines(c).map(t => L(t))); }
          else if (e.isDir(p)) throw new GitError(`cat: ${p}: É um diretório`);
          else throw noFile('cat', p);
        });
        return out;
      }
      case 'touch': {
        if (!pos.length) throw new GitError('touch: operando de arquivo ausente', { hint: 'Ex.: touch novo.txt' });
        pos.forEach(p => { if (!e.isFile(p)) e.writeFile(p, ''); });
        fsChanged(); return [];
      }
      case 'mkdir': {
        if (!pos.length) throw new GitError('mkdir: operando ausente', { hint: 'Ex.: mkdir css' });
        pos.forEach(p => { if (e.isFile(p)) throw new GitError(`mkdir: não foi possível criar o diretório '${p}': Arquivo existe`); e.mkdir(p); });
        fsChanged(); return [];
      }
      case 'rm': {
        if (!pos.length) throw new GitError('rm: operando ausente', { hint: 'Ex.: rm arquivo.txt' });
        pos.forEach(p => {
          if (e.isFile(p)) e.deleteFile(p);
          else if (e.isDir(p)) { if (!flags.some(f => f.includes('r'))) throw new GitError(`rm: não foi possível remover '${p}': É um diretório`, { hint: 'Use rm -r para remover pastas.' }); e.deleteDir(p); }
          else if (!flags.some(f => f.includes('f'))) throw noFile('rm', p);
        });
        fsChanged(); return [];
      }
      case 'mv': case 'cp': {
        if (pos.length !== 2) throw new GitError(`${cmd}: uso: ${cmd} origem destino`);
        if (!e.isFile(pos[0])) throw noFile(cmd, pos[0]);
        e.writeFile(pos[1], e.readFile(pos[0]));
        if (cmd === 'mv') e.deleteFile(pos[0]);
        fsChanged(); return [];
      }
      case 'echo': {
        const text = pos.join(' ') + (flags.length && !pos.length ? '' : '');
        const full = args.join(' ');
        if (redir) {
          if (!redir.target) throw new GitError('bash: erro de sintaxe: esperado um nome de arquivo depois de ">"');
          const cur = e.isFile(redir.target) ? e.readFile(redir.target) : '';
          e.writeFile(redir.target, (redir.op === '>>' ? cur : '') + full + '\n');
          fsChanged(); return [];
        }
        return [L(full)];
      }
      case 'code': case 'nano': {
        if (!pos[0]) throw new GitError(`${cmd}: informe um arquivo`, { hint: `Ex.: ${cmd} index.html` });
        if (!e.isFile(pos[0])) { e.writeFile(pos[0], ''); fsChanged(); }
        this.o.onOpenFile && this.o.onOpenFile(e.norm(pos[0]));
        return [L(`Abrindo ${pos[0]} no editor ao lado →`, 'dim')];
      }
      default: {
        const near = closest(cmd, ['git', ...SHELL_COMMANDS], 2);
        throw new GitError(`bash: ${cmd}: comando não encontrado`, {
          hint: near ? `Você quis dizer "${near}"? ${near === 'git' ? 'Todo comando Git começa com a palavra git.' : ''}` : 'Comandos Git começam com "git". Digite "help" para ver o que está disponível.',
          concept: 'O terminal só conhece programas instalados. Aqui estão disponíveis o git e alguns comandos básicos de shell.'
        });
      }
    }
  }
}
