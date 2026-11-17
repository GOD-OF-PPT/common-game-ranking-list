const $ = id => document.getElementById(id);
const state = { key: '', games: [], boards: [], board: null, offset: 0, total: 0, generation: 0 };
const element = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
function notice(message, error = false) { $('notice').textContent = message; $('notice').className = error ? 'error' : ''; $('notice').hidden = false; }
async function api(path, body, method = 'GET') {
  const res = await fetch(`/api/v1${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(state.key ? { Authorization: `Bearer ${state.key}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? '请求失败');
  return data;
}
function action(handler) { return async event => { event?.preventDefault(); const button = event?.submitter; if (button) button.disabled = true; try { await handler(event); } catch (e) { notice(e.message, true); } finally { if (button) button.disabled = false; } }; }
function empty(title, detail) { $('ranking-body').replaceChildren(); $('empty-state').hidden = false; $('empty-title').textContent = title; $('empty-detail').textContent = detail; }
async function loadGames(preferred) {
  const { games } = await api('/games'); state.games = games; $('game-count').textContent = games.length;
  $('game-select').replaceChildren(...games.map(g => { const option = element('option', g.name); option.value = g.slug; return option; }));
  if (preferred && games.some(g => g.slug === preferred)) $('game-select').value = preferred;
  if (!games.length) $('game-select').append(element('option', '尚未接入游戏'));
  await loadBoards();
}
async function loadBoards(preferred) {
  const generation = ++state.generation;
  const game = $('game-select').value;
  state.boards = []; state.board = null; state.offset = 0; state.total = 0;
  $('board-tabs').replaceChildren(); $('board-description').replaceChildren(); $('board-count').textContent = '0'; $('player-count').textContent = '0'; paging();
  empty('正在加载', '读取榜单数据…');
  if (!state.games.length) { empty('还没有接入游戏', '点击“创建游戏”，建立第一个游戏空间。'); return; }
  const { boards } = await api(`/games/${game}/boards`);
  if (generation !== state.generation) return;
  state.boards = boards; $('board-count').textContent = boards.length;
  if (!boards.length) { empty('还没有榜单', '点击“新建榜单”，配置游戏的排序依据。'); return; }
  for (const board of boards) { const tab = element('button', board.name, 'tab'); tab.type = 'button'; tab.dataset.slug = board.slug; tab.addEventListener('click', action(() => selectBoard(board))); $('board-tabs').append(tab); }
  await selectBoard(boards.find(b => b.slug === preferred) ?? boards[0]);
}
async function selectBoard(board) {
  state.board = board; state.offset = 0;
  for (const tab of $('board-tabs').children) { const selected = tab.dataset.slug === board.slug; tab.classList.toggle('selected', selected); tab.setAttribute('aria-pressed', String(selected)); }
  $('board-description').replaceChildren(...board.sortRules.map(r => element('span', `${r.field} ${r.order === 'desc' ? '↓ 降序' : '↑ 升序'}`, 'chip')), element('span', board.updateMode === 'best' ? '保留个人最好成绩' : '使用个人最新成绩', 'chip'), element('span', board.public ? '公开榜单' : '需玩家身份', 'chip'));
  await loadRanking();
}
function paging() { $('prev').disabled = !state.board || state.offset === 0; $('next').disabled = !state.board || state.offset + 20 >= state.total; $('page-info').textContent = state.total ? `显示 ${state.offset + 1}–${Math.min(state.offset + 20, state.total)} 条，共 ${state.total} 位玩家` : '共 0 位玩家'; }
async function loadRanking() {
  if (!state.board) return;
  const generation = ++state.generation;
  empty('正在加载', '读取玩家成绩…');
  const data = await api(`/games/${$('game-select').value}/boards/${state.board.slug}?limit=20&offset=${state.offset}`);
  if (generation !== state.generation) return;
  state.total = data.total; $('player-count').textContent = data.total;
  $('ranking-body').replaceChildren(); $('empty-state').hidden = !!data.entries.length;
  if (!data.entries.length) empty('等待第一位玩家', '成绩上报后，将自动出现在这里。可前往接入试验场体验。');
  for (const entry of data.entries) {
    const tr = element('tr'); const rank = element('td'); rank.append(element('span', String(entry.rank).padStart(2, '0'), `rank-badge${entry.rank <= 3 ? ' top' : ''}`));
    const player = element('td'); const playerWrap = element('div', undefined, 'player'); playerWrap.append(element('span', [...entry.username][0], 'avatar')); const identity = element('div', entry.username); identity.append(element('span', `${entry.playerId.slice(0, 15)}…`, 'player-id')); playerWrap.append(identity); player.append(playerWrap);
    const metrics = element('td', state.board.sortRules.map(r => `${entry.metrics[r.field].toLocaleString()} ${r.field}`).join(' / '), 'metric');
    const info = element('td'); const infoText = JSON.stringify(entry.info); const infoLabel = element('span', infoText === '{}' ? '—' : infoText, 'info-value'); infoLabel.title = infoText; info.append(infoLabel);
    tr.append(rank, player, metrics, info, element('td', new Date(entry.achievedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }))); $('ranking-body').append(tr);
  }
  paging();
}
$('admin-toggle').addEventListener('click', () => { $('admin-panel').hidden = !$('admin-panel').hidden; });
$('create-toggle').addEventListener('click', () => { $('create-panel').hidden = !$('create-panel').hidden; if (!state.key) $('admin-panel').hidden = false; });
$('board-toggle').addEventListener('click', () => { $('board-form').hidden = !$('board-form').hidden; if (!state.key) $('admin-panel').hidden = false; });
$('admin-form').addEventListener('submit', action(async () => { state.key = $('admin-key').value; $('admin-key').value = ''; try { await api('/admin/session'); } catch (error) { state.key = ''; throw error; } await loadBoards(); notice('管理身份已验证。密钥仅保留到本页关闭。'); }));
$('logout').addEventListener('click', action(async () => { state.key = ''; $('admin-key').value = ''; $('key-value').textContent = ''; $('new-key').hidden = true; await loadBoards(); notice('管理密钥已清除'); }));
$('game-form').addEventListener('submit', action(async event => {
  const form = new FormData(event.target); const result = await api('/admin/games', { slug: form.get('slug'), name: form.get('name'), allowGuest: true }, 'POST');
  $('new-key').hidden = false; $('key-value').textContent = result.apiKey; await loadGames(result.game.slug); notice('游戏已创建。接下来创建一个榜单。');
}));
$('board-form').addEventListener('submit', action(async event => {
  if (!state.games.length) throw new Error('请先创建游戏'); const form = new FormData(event.target);
  const result = await api(`/games/${$('game-select').value}/boards`, { slug: form.get('slug'), name: form.get('name'), updateMode: form.get('updateMode'), public: true, sortRules: JSON.parse(form.get('rules')) }, 'POST');
  $('board-form').hidden = true; await loadBoards(result.board.slug); notice('榜单已创建，可以开始接入游戏。');
}));
$('game-select').addEventListener('change', action(() => loadBoards()));
$('refresh').addEventListener('click', action(() => loadBoards(state.board?.slug)));
$('prev').addEventListener('click', action(async () => { state.offset = Math.max(0, state.offset - 20); await loadRanking(); }));
$('next').addEventListener('click', action(async () => { state.offset += 20; await loadRanking(); }));
fetch('/health').then(r => { $('health').textContent = r.ok ? '所有系统运行正常' : '数据库暂不可用'; }).catch(() => { $('health').textContent = '服务连接失败'; });
await action(() => loadGames())();
