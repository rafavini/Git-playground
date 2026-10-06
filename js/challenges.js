/* Challenges — desafios Git em forma de puzzles.
   Cada desafio monta um cenário (setup), define objetivos verificáveis (goals),
   dicas progressivas (hints) e uma solução de referência (solution). */

const Challenges = (() => {
  const LEVELS = {
    beginner: { name: 'Iniciante', icon: '🟢', color: '#3ddc97' },
    intermediate: { name: 'Intermediário', icon: '🔵', color: '#4cc9f0' },
    advanced: { name: 'Avançado', icon: '🟣', color: '#a78bfa' },
    special: { name: 'Especial', icon: '🔴', color: '#ff6b81' }
  };

  const SITE = {
    'index.html': '<!DOCTYPE html>\n<html lang="pt-BR">\n<head>\n  <meta charset="UTF-8">\n  <title>Meu Site</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>Olá, mundo!</h1>\n  <p>Meu primeiro site.</p>\n  <script src="script.js"></script>\n</body>\n</html>\n',
    'style.css': 'body {\n  font-family: sans-serif;\n  background: #0d1117;\n  color: #e6edf3;\n}\n\nh1 {\n  color: #58a6ff;\n}\n',
    'script.js': "console.log('Olá, Git!');\n",
    'README.md': '# Meu Site\n\nProjeto de estudo de Git.\n'
  };

  /* ---------- helpers de cenário ---------- */
  const G = (e, sub, ...args) => e.commands[sub](args);
  const setFiles = (e, o) => Object.entries(o).forEach(([k, v]) => e.writeFile(k, v));
  const commitAll = (e, msg) => { G(e, 'add', '.'); G(e, 'commit', '-m', msg); };
  const edit = (e, p, fn) => e.writeFile(p, fn(e.readFile(p)));
  const build = fn => { const e = new GitEngine(GitEngine.blank()); fn(e); e.onEvent = null; return e; };
  const baseRepo = (e, extra) => { setFiles(e, { ...SITE, ...(extra || {}) }); G(e, 'init'); commitAll(e, 'Primeiro commit'); };
  const hasMarkers = e => Object.values(e.files).some(c => /^(<{7}|={7}|>{7})/m.test(c));
  const R = e => e.repo;
  const mainTip = e => e.repo && e.repo.branches.main;
  const SERVER = 'https://github.com/aluno/meu-projeto.git';

  const list = [
    /* ================= INICIANTE ================= */
    {
      id: 'c01', level: 'beginner', icon: '🌱', title: 'Primeiro commit', xp: 100, par: 90,
      story: 'Você acabou de criar um projeto e precisa transformá-lo em um repositório Git. Inicialize o repositório, adicione os arquivos e faça seu primeiro commit.',
      setup: e => setFiles(e, SITE),
      goals: [
        { label: 'Inicializar o repositório', check: e => !!R(e) },
        { label: 'Colocar todos os arquivos na Staging Area', check: e => !!R(e) && Object.keys(SITE).every(f => f in R(e).index) },
        { label: 'Criar o primeiro commit', check: e => !!e.headId() }
      ],
      hints: [
        'A pasta ainda não é um repositório. Existe um comando que começa com "init".',
        'Depois de inicializar, envie os arquivos para a Staging Area. O ponto (.) significa "tudo aqui".',
        'O comando que grava o commit precisa de uma mensagem. Use a opção -m seguida do texto entre aspas.'
      ],
      solution: ['git init', 'git add .', 'git commit -m "Primeiro commit"'],
      concept: 'O ciclo básico do Git: Working Directory → git add → Staging Area → git commit → Repositório. Agora você já domina as três etapas!'
    },
    {
      id: 'c02', level: 'beginner', icon: '🔎', title: 'Investigue o estado', xp: 110, par: 120,
      story: 'Você editou o index.html e também criou um arquivo de rascunho (notes.txt). Só a mudança do index.html deve entrar no histórico. Descubra o estado do projeto, e commite apenas o que importa.',
      setup: e => { baseRepo(e); edit(e, 'index.html', c => c.replace('Olá, mundo!', 'Bem-vindo ao meu site!')); e.writeFile('notes.txt', 'lembrar de comprar café\n'); },
      goals: [
        { label: 'Consultar o estado com git status', check: (e, x) => x.used(/^git status/) },
        { label: 'Commitar a mudança do index.html', check: (e, x) => e.commitCount() > x.base.commits && e.headTree()['index.html'] === e.files['index.html'] && e.headTree()['index.html'] !== x.base.tree['index.html'] },
        { label: 'Deixar notes.txt fora do commit', check: (e, x) => e.commitCount() > x.base.commits && !('notes.txt' in e.headTree()) }
      ],
      hints: [
        'Existe um comando que mostra o estado atual dos arquivos: working directory e staging area.',
        'git add aceita o nome de um arquivo específico. Você não precisa usar "." sempre.',
        'Adicione somente o index.html e então faça o commit com uma mensagem.'
      ],
      solution: ['git status', 'git add index.html', 'git commit -m "Atualiza título"'],
      concept: 'A Staging Area permite escolher exatamente o que entra em cada commit. Commits pequenos e focados deixam o histórico claro.'
    },
    {
      id: 'c03', level: 'beginner', icon: '✌️', title: 'Um commit por assunto', xp: 120, par: 150,
      story: 'Você mexeu no estilo (style.css) e no comportamento (script.js). Boas práticas: um commit por assunto. Registre as duas mudanças em DOIS commits separados.',
      setup: e => {
        baseRepo(e);
        edit(e, 'style.css', c => c + '\nbutton {\n  border-radius: 8px;\n}\n');
        edit(e, 'script.js', c => c + "document.title = 'Meu Site';\n");
      },
      goals: [
        { label: 'Criar dois novos commits', check: (e, x) => e.commitCount() >= x.base.commits + 2 },
        { label: 'Cada commit altera um arquivo diferente', check: (e, x) => {
          if (e.commitCount() < x.base.commits + 2) return false;
          const h = e.headId(), p = e.repo.commits[h].parents[0];
          const a = e.commitInfo(h).files.map(f => f.path), b = e.commitInfo(p).files.map(f => f.path);
          return a.length === 1 && b.length === 1 && a[0] !== b[0];
        } },
        { label: 'Diretório de trabalho limpo', check: (e, x) => e.commitCount() > x.base.commits && e.isClean() }
      ],
      hints: [
        'Faça o primeiro commit só com um dos arquivos (staging seletiva).',
        'Depois do primeiro commit, o outro arquivo ainda aparece como modificado em git status.',
        'git add style.css → git commit → git add script.js → git commit.'
      ],
      solution: ['git add style.css', 'git commit -m "Estiliza botões"', 'git add script.js', 'git commit -m "Define título via JS"'],
      concept: 'Commits atômicos (um assunto por commit) facilitam revisar, desfazer e entender a história do projeto.'
    },
    {
      id: 'c04', level: 'beginner', icon: '📜', title: 'Detetive do histórico', xp: 130, par: 150,
      story: 'Seu chefe quer saber qual foi a mensagem do PRIMEIRO commit deste projeto. Descubra no histórico e escreva a mensagem no arquivo resposta.txt (use o editor ou o comando echo).',
      setup: e => {
        const m = ['Estrutura inicial do site', 'Adiciona estilos', 'Cria menu de navegação', 'Corrige bug no menu', 'Atualiza README'];
        setFiles(e, SITE); G(e, 'init');
        m.forEach((msg, i) => { e.writeFile('historico.txt', `versão ${i + 1}\n`); commitAll(e, msg); });
        e.deleteFile('historico.txt'); commitAll(e, 'Remove arquivo temporário');
      },
      goals: [
        { label: 'Consultar o histórico com git log', check: (e, x) => x.used(/^git log/) },
        { label: 'Criar resposta.txt com a mensagem do primeiro commit', check: e => (e.files['resposta.txt'] || '').toLowerCase().includes('estrutura inicial do site') }
      ],
      hints: [
        'O comando que lista os commits do mais novo ao mais antigo começa com "log".',
        'Se o histórico for longo, git log --oneline mostra uma linha por commit.',
        'O primeiro commit é o ÚLTIMO da lista. Depois: echo "mensagem" > resposta.txt'
      ],
      solution: ['git log --oneline', 'echo "Estrutura inicial do site" > resposta.txt'],
      concept: 'git log é a máquina do tempo: autor, data e mensagem de cada commit. Quanto melhores as mensagens, mais útil ela é.'
    },
    {
      id: 'c05', level: 'beginner', icon: '⚡', title: 'O atalho do -am', xp: 120, par: 90,
      story: 'Você corrigiu um erro de digitação no README.md e no style.css (arquivos que o Git já conhece). Faça o commit das duas mudanças em UM único comando, sem usar git add.',
      setup: e => { baseRepo(e); edit(e, 'README.md', c => c.replace('estudo', 'aprendizado')); edit(e, 'style.css', c => c.replace('sans-serif', 'system-ui, sans-serif')); },
      goals: [
        { label: 'Usar git commit com a opção -a (ou -am)', check: (e, x) => x.used(/^git commit\b.*\s-[a-z]*a[a-z]*(\s|$)/) },
        { label: 'Criar o novo commit com as duas mudanças', check: (e, x) => e.commitCount() > x.base.commits && e.isClean() }
      ],
      hints: [
        'git commit tem uma opção que "faz o add" dos arquivos já rastreados antes de commitar.',
        'A opção é -a (de "all"). Ela pode ser combinada com -m: -am.',
        'git commit -am "mensagem". Atenção: arquivos novos (untracked) NÃO entram com -a.'
      ],
      solution: ['git commit -am "Corrige textos e fonte"'],
      concept: 'git commit -am = add dos arquivos rastreados + commit. Rápido, mas não inclui arquivos novos.'
    },

    /* ================= INTERMEDIÁRIO ================= */
    {
      id: 'c06', level: 'intermediate', icon: '🌿', title: 'Nova linha do tempo', xp: 180, par: 150,
      story: 'Você vai começar a feature de login. Nunca mexa direto na main! Crie a branch feature-login, vá para ela e faça pelo menos um commit lá (crie um arquivo login.html, por exemplo).',
      setup: e => { baseRepo(e); edit(e, 'README.md', c => c + '\nVeja o roadmap.\n'); commitAll(e, 'Atualiza README'); },
      goals: [
        { label: 'Criar a branch feature-login', check: e => !!R(e) && 'feature-login' in R(e).branches },
        { label: 'Estar na branch feature-login', check: e => !!R(e) && R(e).head === 'feature-login' },
        { label: 'Fazer um commit que exista só nela', check: e => !!R(e) && R(e).branches['feature-login'] && R(e).branches['feature-login'] !== mainTip(e) && e.isAncestor(mainTip(e), R(e).branches['feature-login']) }
      ],
      hints: [
        'Uma branch é um ponteiro para um commit. Existe git branch <nome> e também um atalho que cria e já troca.',
        'git switch -c <nome> cria a branch e muda para ela ao mesmo tempo.',
        'Depois de trocar: crie/edite um arquivo (git status mostra), git add e git commit.'
      ],
      solution: ['git switch -c feature-login', 'echo "<h1>Login</h1>" > login.html', 'git add login.html', 'git commit -m "Cria tela de login"'],
      concept: 'Branches permitem trabalhar em paralelo. A main continua estável enquanto você experimenta na sua branch.'
    },
    {
      id: 'c07', level: 'intermediate', icon: '🔀', title: 'Una os caminhos', xp: 200, par: 150,
      story: 'A branch feature-footer já tem o rodapé pronto, e enquanto isso a main recebeu uma atualização do README. Traga o rodapé para a main com um merge.',
      setup: e => {
        baseRepo(e); G(e, 'switch', '-c', 'feature-footer');
        e.writeFile('footer.html', '<footer>© 2025 Meu Site</footer>\n'); commitAll(e, 'Adiciona rodapé');
        G(e, 'switch', 'main'); edit(e, 'README.md', c => c + '\n## Roadmap\n- Rodapé\n'); commitAll(e, 'Atualiza README');
      },
      goals: [
        { label: 'Estar na branch main', check: (e, x) => !!R(e) && R(e).head === 'main' && x.used(/^git merge/) },
        { label: 'Incorporar feature-footer na main', check: e => !!R(e) && R(e).branches['feature-footer'] && e.isAncestor(R(e).branches['feature-footer'], mainTip(e)) },
        { label: 'footer.html presente na main', check: e => !!R(e) && 'footer.html' in e.treeOf(mainTip(e)) }
      ],
      hints: [
        'O merge acontece na branch que RECEBE as mudanças. Em qual branch você precisa estar?',
        'Confirme com git branch (a atual tem *). Depois use git merge com o nome da outra branch.',
        'git merge feature-footer, estando na main.'
      ],
      solution: ['git switch main', 'git merge feature-footer'],
      concept: 'git merge traz o trabalho de outra branch para a atual. Como os dois lados evoluíram, o Git criou um commit de merge com dois pais.'
    },
    {
      id: 'c08', level: 'intermediate', icon: '🧯', title: 'Alteração acidental', xp: 190, par: 150,
      story: 'Você bagunçou o style.css sem querer, mas no script.js há trabalho valioso que NÃO pode ser perdido. Veja o que mudou e recupere somente a versão anterior do style.css.',
      setup: e => {
        baseRepo(e);
        e.writeFile('style.css', 'body { colorrr red !!!\n  background: ??\n');
        edit(e, 'script.js', c => c + "function saudar(nome) {\n  return 'Olá, ' + nome;\n}\n");
      },
      goals: [
        { label: 'Ver as diferenças com git diff', check: (e, x) => x.used(/^git diff/) },
        { label: 'style.css voltou à versão do último commit', check: e => !!R(e) && e.files['style.css'] === e.headTree()['style.css'] },
        { label: 'script.js continua com as suas alterações', check: (e, x) => !!R(e) && e.files['style.css'] === e.headTree()['style.css'] && e.files['script.js'] !== e.headTree()['script.js'] }
      ],
      hints: [
        'git diff mostra linha por linha o que mudou desde o último commit (em vermelho/verde).',
        'Existe um comando moderno que "restaura" arquivos do diretório de trabalho para a última versão salva.',
        'git restore recebe o nome do arquivo. Passe só style.css para não perder o script.js.'
      ],
      solution: ['git diff', 'git restore style.css'],
      concept: 'git restore <arquivo> descarta mudanças não commitadas daquele arquivo. Cuidado: o que não foi commitado não tem volta.'
    },
    {
      id: 'c09', level: 'intermediate', icon: '🕵️', title: 'Staging errado', xp: 200, par: 180,
      story: 'Você rodou "git add ." sem olhar e agora o secret.txt (com uma chave de API!) está na Staging Area. Tire-o de lá SEM apagar o arquivo e faça o commit só com o que deve ser publicado.',
      setup: e => {
        baseRepo(e);
        edit(e, 'index.html', c => c.replace('Meu primeiro site.', 'Meu site com novidades.'));
        e.writeFile('secret.txt', 'API_KEY=sk_live_123456\n'); G(e, 'add', '.');
      },
      goals: [
        { label: 'Remover secret.txt da Staging Area', check: e => !!R(e) && !('secret.txt' in R(e).index) },
        { label: 'Manter o arquivo secret.txt no disco', check: e => !!R(e) && 'secret.txt' in e.files && !('secret.txt' in R(e).index) },
        { label: 'Commitar só o index.html', check: (e, x) => e.commitCount() > x.base.commits && !('secret.txt' in e.headTree()) && e.headTree()['index.html'] !== x.base.tree['index.html'] }
      ],
      hints: [
        'Use git status: ele mostra com qual comando tirar um arquivo da Staging Area.',
        'git restore --staged <arquivo> tira o arquivo da Staging mas mantém o conteúdo no disco.',
        'Depois de desfazer o stage do secret.txt, é só git commit com mensagem.'
      ],
      solution: ['git restore --staged secret.txt', 'git commit -m "Atualiza texto do site"'],
      concept: 'git restore --staged é o "desfazer" do git add. Nunca commite segredos: depois de enviados ao remoto, é muito difícil removê-los.'
    },

    /* ================= AVANÇADO ================= */
    {
      id: 'c10', level: 'advanced', icon: '💥', title: 'Conflito de merge', xp: 300, par: 240,
      story: 'Duas pessoas mudaram o título do index.html em branches diferentes. Faça o merge da feature-title na main, resolva o conflito (o título final deve ser da sua escolha) e conclua o merge com um commit.',
      setup: e => {
        baseRepo(e); G(e, 'switch', '-c', 'feature-title');
        edit(e, 'index.html', c => c.replace('<h1>Olá, mundo!</h1>', '<h1>Olá, visitante!</h1>')); commitAll(e, 'Título da feature');
        G(e, 'switch', 'main');
        edit(e, 'index.html', c => c.replace('<h1>Olá, mundo!</h1>', '<h1>Bem-vindo ao meu site!</h1>')); commitAll(e, 'Título da main');
      },
      goals: [
        { label: 'Iniciar o merge da feature-title', check: (e, x) => x.used(/^git merge\s+feature-title/) },
        { label: 'Resolver o conflito (sem marcadores <<<<<<<)', check: (e, x) => x.used(/^git merge/) && !!R(e) && !e.state.merge && !hasMarkers(e) },
        { label: 'Concluir o merge com um commit', check: e => !!e.headId() && e.repo.commits[e.headId()].parents.length === 2 }
      ],
      hints: [
        'Faça o merge normalmente. O Git vai avisar que não conseguiu juntar sozinho.',
        'Abra index.html no editor: o Git marcou as duas versões entre <<<<<<<, ======= e >>>>>>>. Deixe só a linha final e apague os marcadores.',
        'Depois de editar: git add index.html e git commit -m "Resolve conflito".'
      ],
      solution: ['git merge feature-title', '(edite index.html e remova os marcadores)', 'git add index.html', 'git commit -m "Resolve conflito do título"'],
      concept: 'Conflitos são normais! O Git só pede ajuda quando duas branches mudam o mesmo trecho. Você decide o resultado final.'
    },
    {
      id: 'c11', level: 'advanced', icon: '⏪', title: 'Volte no tempo', xp: 280, par: 150,
      story: 'Seu último commit ("Oops: apaguei tudo") esvaziou o index.html. Desfaça esse commit por completo, voltando o projeto ao estado anterior.',
      setup: e => {
        baseRepo(e);
        edit(e, 'index.html', c => c.replace('<p>Meu primeiro site.</p>', '<p>Meu primeiro site.</p>\n  <p>Nova seção sobre mim.</p>')); commitAll(e, 'Adiciona seção sobre');
        e.writeFile('index.html', ''); commitAll(e, 'Oops: apaguei tudo');
      },
      goals: [
        { label: 'Descartar o commit "Oops"', check: e => !!e.headId() && e.repo.commits[e.headId()].msg !== 'Oops: apaguei tudo' },
        { label: 'Voltar ao commit "Adiciona seção sobre"', check: e => !!e.headId() && e.repo.commits[e.headId()].msg === 'Adiciona seção sobre' },
        { label: 'index.html recuperado no disco', check: e => (e.files['index.html'] || '').includes('Nova seção') }
      ],
      hints: [
        'Use git log --oneline para ver a história. Você quer mover a branch para o commit anterior.',
        'git reset move a branch para trás. Existem três modos: --soft, --mixed e --hard (que também restaura os arquivos).',
        'HEAD~1 significa "um commit antes do atual".'
      ],
      solution: ['git log --oneline', 'git reset --hard HEAD~1'],
      concept: 'git reset --hard move a branch E sobrescreve seus arquivos. Poderoso e perigoso: use apenas em commits que ainda não foram enviados ao remoto.'
    },
    {
      id: 'c12', level: 'advanced', icon: '☁️', title: 'Conecte ao remoto', xp: 280, par: 180,
      story: 'Seu projeto só existe no seu computador. Conecte-o ao repositório remoto https://github.com/aluno/meu-projeto.git (com o nome origin) e envie a branch main.',
      setup: e => { baseRepo(e); edit(e, 'README.md', c => c + '\nEm breve no GitHub!\n'); commitAll(e, 'Atualiza README'); },
      goals: [
        { label: 'Adicionar o remoto origin', check: e => !!R(e) && R(e).remotes.origin === SERVER },
        { label: 'Enviar a main com git push', check: e => !!R(e) && !!e.state.servers[SERVER] && e.state.servers[SERVER].branches.main === e.headId() },
        { label: 'Deixar a main rastreando origin/main (-u)', check: e => !!R(e) && R(e).upstream.main === 'origin/main' }
      ],
      hints: [
        'Um "remote" é um apelido para a URL do repositório remoto. O nome convencional é origin.',
        'git remote add <nome> <url>. Confira depois com git remote -v.',
        'git push -u origin main envia a branch e liga a main local à origin/main.'
      ],
      solution: ['git remote add origin https://github.com/aluno/meu-projeto.git', 'git push -u origin main'],
      concept: 'push publica seus commits no remoto. O -u grava a ligação (upstream) para que "git push" e "git pull" simples funcionem depois.'
    },
    {
      id: 'c13', level: 'advanced', icon: '🔄', title: 'Sincronize com o time', xp: 300, par: 120,
      story: 'Marina enviou um commit novo para o remoto enquanto você trabalhava. Traga as mudanças dela para o seu projeto.',
      setup: e => {
        baseRepo(e); G(e, 'remote', 'add', 'origin', SERVER); G(e, 'push', '-u', 'origin', 'main');
        const e2 = new GitEngine(JSON.parse(JSON.stringify(e.state)));
        e2.state.user = { name: 'Marina', email: 'marina@time.dev' };
        e2.writeFile('colega.txt', 'Oi do time! — Marina\n'); commitAll(e2, 'Adiciona arquivo da Marina'); G(e2, 'push');
        e.state.servers = e2.state.servers; e.state.seq = e2.state.seq; e.state.clock = e2.state.clock;
      },
      goals: [
        { label: 'Trazer as novidades do remoto (pull/fetch)', check: (e, x) => x.used(/^git (pull|fetch)/) },
        { label: 'Atualizar a main local com a origin/main', check: e => !!R(e) && e.headId() === e.state.servers[SERVER].branches.main },
        { label: 'colega.txt no seu projeto', check: e => 'colega.txt' in e.files }
      ],
      hints: [
        'O remoto tem commits que você ainda não tem. Existe um comando que baixa E integra.',
        'git pull = git fetch + git merge. Como a main já rastreia origin/main, basta o comando simples.',
        'Rode git pull e confira com git log --oneline.'
      ],
      solution: ['git pull'],
      concept: 'Trabalho em equipe: sempre puxe antes de enviar. Se o remoto tem commits novos, o push seria rejeitado.'
    },

    /* ================= ESPECIAIS ================= */
    {
      id: 'c14', level: 'special', icon: '🚨', title: 'A main andou sem você', xp: 450, par: 240,
      story: 'Você está na branch feature-login, mas a main recebeu um hotfix importante. Incorpore as alterações da main na sua branch sem perder o seu commit de login.',
      setup: e => {
        baseRepo(e); G(e, 'switch', '-c', 'feature-login');
        e.writeFile('login.html', '<form>\n  <input type="email">\n</form>\n'); commitAll(e, 'Cria página de login');
        G(e, 'switch', 'main'); edit(e, 'README.md', c => c + '\nHotfix: instruções corrigidas.\n'); commitAll(e, 'Hotfix: corrige README');
        G(e, 'switch', 'feature-login');
      },
      goals: [
        { label: 'Incorporar a main na feature-login', check: e => !!R(e) && R(e).branches['feature-login'] && e.isAncestor(mainTip(e), R(e).branches['feature-login']) },
        { label: 'Continuar na feature-login com o login.html intacto', check: e => !!R(e) && R(e).head === 'feature-login' && 'login.html' in e.files && e.isAncestor(mainTip(e), R(e).branches['feature-login']) },
        { label: 'Hotfix presente no README da sua branch', check: e => (e.files['README.md'] || '').includes('Hotfix') }
      ],
      hints: [
        'Quem RECEBE as mudanças é a branch em que você está. Qual branch precisa receber o hotfix?',
        'Você já está na feature-login: faça o merge DA main para dentro dela.',
        'git merge main (estando na feature-login).'
      ],
      solution: ['git merge main'],
      concept: 'Manter sua feature atualizada com a main evita grandes conflitos no final. É a rotina diária de times que usam branches.'
    },
    {
      id: 'c15', level: 'special', icon: '🧩', title: 'O arquivo que sumiu', xp: 500, par: 300,
      story: 'O commit "Limpeza geral" apagou o config.json sem querer. Recupere o arquivo da versão anterior SEM desfazer a limpeza do README, e registre a recuperação em um novo commit.',
      setup: e => {
        baseRepo(e, { 'config.json': '{\n  "api": "https://api.exemplo.dev",\n  "debug": true\n}\n' });
        e.deleteFile('config.json'); edit(e, 'README.md', c => c + '\nLimpeza geral do projeto.\n'); commitAll(e, 'Limpeza geral');
      },
      goals: [
        { label: 'Recuperar config.json no disco', check: e => (e.files['config.json'] || '').includes('api') },
        { label: 'Sem desfazer a limpeza (README continua limpo)', check: e => (e.files['config.json'] || '').includes('api') && (e.files['README.md'] || '').includes('Limpeza geral') },
        { label: 'Registrar a recuperação em um novo commit', check: (e, x) => e.commitCount() > x.base.commits && 'config.json' in e.headTree() }
      ],
      hints: [
        'Um reset desfaria a limpeza inteira. Você quer trazer UM arquivo de um commit antigo.',
        'git restore tem a opção --source para escolher de qual commit buscar o arquivo. HEAD~1 é o commit anterior.',
        'git restore --source=HEAD~1 config.json. Depois: git add e git commit.'
      ],
      solution: ['git restore --source=HEAD~1 config.json', 'git add config.json', 'git commit -m "Recupera config.json"'],
      concept: 'No Git quase nada se perde: versões antigas continuam no histórico e você pode buscá-las arquivo por arquivo.'
    }
  ];

  const byId = id => list.find(c => c.id === id);

  return {
    LEVELS, SITE, list, byId,
    /* Cria o estado inicial (engine.state) de um desafio. */
    build(id) {
      const ch = byId(id), e = build(ch.setup);
      return { state: e.state, base: { commits: e.commitCount(), tree: e.repo ? { ...e.headTree() } : {} } };
    },
    makeCtx(meta) {
      const cmds = meta.cmds || [];
      return { cmds, base: meta.base, used: re => cmds.some(c => re.test(c)) };
    },
    evaluate(ch, engine, meta) {
      const ctx = this.makeCtx(meta);
      return ch.goals.map(g => { try { return !!g.check(engine, ctx); } catch (err) { return false; } });
    },
    daily() {
      const d = new Date(), key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const n = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
      return { key, challenge: list[n % list.length] };
    }
  };
})();
