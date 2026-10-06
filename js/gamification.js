/* Gamification — XP, níveis, conquistas, sequência, desafio diário e ranking.
   O RankingService usa dados simulados; para ligar um backend, troque apenas o corpo de list(). */

const Fmt = {
  duration(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return `${h}h ${pad2(m)}min`;
    if (m) return `${m}min ${pad2(s)}s`;
    return `${s}s`;
  },
  clock(sec) { sec = Math.max(0, Math.round(sec)); return `${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}`; },
  num(n) { return Math.round(n).toLocaleString('pt-BR'); },
  ago(ms) {
    const d = Math.max(0, Date.now() - ms), m = Math.round(d / 60000);
    if (m < 1) return 'agora';
    if (m < 60) return `há ${m} min`;
    const h = Math.round(m / 60);
    return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
  }
};

const PRACTICE_COMMANDS = ['init', 'status', 'add', 'commit', 'log', 'branch', 'checkout', 'switch', 'merge', 'diff', 'restore', 'reset', 'clone', 'remote', 'push', 'pull', 'fetch', 'show', 'rm'];

const Gamification = (() => {
  const TITLES = ['Git Curioso', 'Commit Rookie', 'Branch Walker', 'Git Explorer', 'Merge Master', 'Rebase Ranger', 'Git Ninja', 'Git Wizard', 'Lenda do Git'];

  const defaults = () => ({
    name: 'Aluno', xp: 0, completed: {}, achievements: {}, streak: 0, bestStreak: 0,
    daily: { date: '', done: false }, practiced: {},
    stats: { commands: 0, commits: 0, branches: 0, merges: 0, conflicts: 0, pushes: 0, resets: 0, seconds: 0 }
  });

  const ACHIEVEMENTS = [
    { id: 'first_commit', icon: '🏆', name: 'Primeiro Commit', desc: 'Faça seu primeiro commit.', test: s => s.stats.commits >= 1 },
    { id: 'branch_master', icon: '🌿', name: 'Mestre das Branches', desc: 'Crie 3 branches e faça 1 merge.', test: s => s.stats.branches >= 3 && s.stats.merges >= 1 },
    { id: 'lightning', icon: '⚡', name: 'Commit Relâmpago', desc: 'Conclua um desafio em menos de 45 segundos, sem ajuda.', test: (s, c) => !!c && !c.solution && c.time < 45 },
    { id: 'detective', icon: '🧠', name: 'Git Detective', desc: 'Use status, log, diff e show.', test: s => ['status', 'log', 'diff', 'show'].every(k => s.practiced[k]) },
    { id: 'streak5', icon: '✨', name: 'Pegando o ritmo', desc: '5 desafios consecutivos sem ver a solução.', test: s => s.streak >= 5 },
    { id: 'streak10', icon: '🔥', name: '10 Desafios Consecutivos', desc: '10 desafios seguidos sem ver a solução.', test: s => s.streak >= 10 },
    { id: 'conflict', icon: '💀', name: 'Sobreviveu ao Merge Conflict', desc: 'Resolva um conflito de merge e conclua o commit.', test: s => s.stats.conflicts >= 1 },
    { id: 'remote', icon: '☁️', name: 'Conectado à Nuvem', desc: 'Faça seu primeiro git push.', test: s => s.stats.pushes >= 1 },
    { id: 'time_travel', icon: '⏪', name: 'Viajante do Tempo', desc: 'Use git reset --hard.', test: s => s.stats.resets >= 1 },
    { id: 'no_hints', icon: '💎', name: 'Sem Dicas', desc: 'Conclua 3 desafios sem usar dicas.', test: s => Object.values(s.completed).filter(c => c.hints === 0 && !c.solution).length >= 3 },
    { id: 'explorer', icon: '🧭', name: 'Explorador de Comandos', desc: 'Pratique 12 comandos Git diferentes.', test: s => Object.keys(s.practiced).length >= 12 },
    { id: 'graduate', icon: '🎓', name: 'Formado em Iniciante', desc: 'Conclua todos os desafios iniciantes.', test: s => Challenges.list.filter(c => c.level === 'beginner').every(c => s.completed[c.id]) },
    { id: 'level5', icon: '🚀', name: 'Nível 5', desc: 'Alcance o nível 5.', test: s => levelInfo(s.xp).level >= 5 },
    { id: 'legend', icon: '👑', name: 'Lenda do Git', desc: 'Conclua todos os desafios.', test: s => Challenges.list.every(c => s.completed[c.id]) }
  ];

  function levelInfo(xp) {
    let level = 1, rest = xp;
    for (;;) {
      const need = 200 + 100 * (level - 1);
      if (rest < need) return { level, title: TITLES[Math.min(level - 1, TITLES.length - 1)], into: rest, need, pct: Math.round((rest / need) * 100) };
      rest -= need; level++;
    }
  }

  const G = {
    state: defaults(), onUnlock: null, onLevelUp: null,
    ACHIEVEMENTS, PRACTICE_COMMANDS, levelInfo,
    load() {
      const saved = Storage.get('progress', null), d = defaults();
      if (saved) { this.state = { ...d, ...saved, stats: { ...d.stats, ...saved.stats }, daily: { ...d.daily, ...saved.daily } }; }
      else this.state = d;
      return this.state;
    },
    save() { Storage.set('progress', this.state); },
    reset() { this.state = defaults(); this.save(); },
    setName(n) { this.state.name = (n || 'Aluno').trim().slice(0, 18) || 'Aluno'; this.save(); },
    level() { return levelInfo(this.state.xp); },

    grantXp(n) {
      const before = levelInfo(this.state.xp).level;
      this.state.xp = Math.max(0, this.state.xp + n);
      const after = levelInfo(this.state.xp);
      if (after.level > before && this.onLevelUp) this.onLevelUp(after);
    },

    tick(seconds) { this.state.stats.seconds += seconds; this.save(); },
    countCommand(sub) {
      this.state.stats.commands++;
      if (sub && PRACTICE_COMMANDS.includes(sub)) this.state.practiced[sub] = (this.state.practiced[sub] || 0) + 1;
      this.checkAchievements();
      this.save();
    },
    onEngineEvent(evt) {
      const st = this.state.stats;
      if (evt.type === 'commit') { st.commits++; if (evt.conflictResolved) st.conflicts++; }
      else if (evt.type === 'branch' && evt.created) st.branches++;
      else if (evt.type === 'merge' && !evt.conflict) st.merges++;
      else if (evt.type === 'push') st.pushes++;
      else if (evt.type === 'reset' && evt.mode === 'hard') st.resets++;
      this.checkAchievements();
      this.save();
    },

    checkAchievements(ctx) {
      const fresh = [];
      ACHIEVEMENTS.forEach(a => {
        if (this.state.achievements[a.id]) return;
        let ok = false;
        try { ok = a.test(this.state, ctx); } catch (e) { ok = false; }
        if (ok) { this.state.achievements[a.id] = Date.now(); fresh.push(a); }
      });
      fresh.forEach(a => { this.grantXp(25); if (this.onUnlock) this.onUnlock(a); });
      return fresh;
    },

    previewXp(ch, hints, solution) {
      if (solution) return Math.round(ch.xp * 0.25);
      return Math.max(Math.round(ch.xp * 0.4), ch.xp - hints * 10);
    },

    calcReward(ch, { time, cmds, hints, solution, daily }) {
      let xp = ch.xp; const notes = [];
      if (solution) { xp = Math.round(ch.xp * 0.25); notes.push({ t: 'Solução revelada', v: '25% do XP' }); }
      else {
        if (hints) { const pen = ch.xp - this.previewXp(ch, hints, false); xp -= pen; notes.push({ t: `Dicas usadas (${hints})`, v: `-${pen} XP` }); }
        if (time <= ch.par) { const b = Math.round(ch.xp * 0.2); xp += b; notes.push({ t: 'Bônus de velocidade', v: `+${b} XP` }); }
        if (daily) { const b = Math.round(xp * 0.5); xp += b; notes.push({ t: 'Desafio do dia', v: `+${b} XP` }); }
      }
      const score = Math.max(0, xp * 10 + Math.max(0, ch.par - time) * 3 - Math.max(0, cmds - ch.solution.length) * 15);
      return { xp, score, notes };
    },

    isDaily(ch) {
      const d = Challenges.daily();
      return d.challenge.id === ch.id && !(this.state.daily.date === d.key && this.state.daily.done);
    },

    /* Registra a conclusão. Retorna o resultado para o modal de sucesso. */
    completeChallenge(ch, run) {
      const prev = this.state.completed[ch.id];
      const levelBefore = this.level().level;
      const daily = this.isDaily(ch);
      const reward = this.calcReward(ch, { ...run, daily });
      const first = !prev;
      const xpGained = first ? reward.xp : 0;
      if (first) this.grantXp(xpGained);
      const rec = { time: run.time, cmds: run.cmds, hints: run.hints, solution: run.solution, score: reward.score, xp: first ? reward.xp : (prev.xp || 0), date: Date.now() };
      if (!prev || (rec.score > (prev.score || 0))) this.state.completed[ch.id] = { ...rec, xp: rec.xp };
      if (daily) { this.state.daily = { date: Challenges.daily().key, done: true }; }
      if (run.solution) this.state.streak = 0;
      else { this.state.streak++; this.state.bestStreak = Math.max(this.state.bestStreak, this.state.streak); }
      const unlocked = this.checkAchievements({ time: run.time, solution: run.solution, ch });
      this.save();
      return { ...reward, xpGained, first, unlocked, levelUp: this.level().level > levelBefore ? this.level() : null, daily };
    },

    totals() {
      const done = Object.keys(this.state.completed).length;
      return { done, total: Challenges.list.length };
    }
  };
  return G;
})();

/* Ranking simulado. Estrutura pronta para trocar por uma chamada de API:
   async list() { const r = await fetch('/api/ranking'); return r.json(); } */
const RankingService = {
  SIMULATED: [
    { name: 'Ana', xp: 2450 }, { name: 'João', xp: 2310 }, { name: 'Rafael', xp: 2190 }, { name: 'Bruno', xp: 1980 },
    { name: 'Maria', xp: 1870 }, { name: 'Lucas', xp: 1540 }, { name: 'Júlia', xp: 1320 }, { name: 'Pedro', xp: 980 },
    { name: 'Sofia', xp: 760 }, { name: 'Diego', xp: 540 }
  ],
  async list() {
    const me = { name: Gamification.state.name, xp: Gamification.state.xp, me: true };
    return [...this.SIMULATED.map(u => ({ ...u })), me].sort((a, b) => b.xp - a.xp || (a.me ? 1 : -1)).map((u, i) => ({ ...u, pos: i + 1 }));
  }
};
