import { RankingClient } from './sdk.js';
const $ = id => document.getElementById(id);
let client;
function currentClient() { const game = $('game').value.trim(); if (!client || client.game !== game) client = new RankingClient({ baseUrl: location.origin, game }); return client; }
async function run(event, fn) { event.preventDefault(); const button = event.submitter ?? event.currentTarget; button.disabled = true; try { $('result').textContent = JSON.stringify(await fn(), null, 2); } catch (e) { $('result').textContent = `${e.code ?? 'ERROR'}: ${e.message}`; } finally { button.disabled = false; } }
$('submit-form').addEventListener('submit', e => run(e, () => currentClient().submit($('board').value.trim(), { username: $('username').value, metrics: JSON.parse($('metrics').value), info: JSON.parse($('info').value) })));
$('my-rank').addEventListener('click', e => run(e, () => currentClient().me($('board').value.trim())));
$('top-rank').addEventListener('click', e => run(e, () => currentClient().top($('board').value.trim())));
$('snippet').textContent = `import { RankingClient } from '${location.origin}/sdk.js';

const ranking = new RankingClient({
  baseUrl: '${location.origin}',
  game: 'demo'
});

await ranking.submit('high-score', {
  username: '网页玩家',
  metrics: { score: 1200, duration: 60 },
  info: { level: 5, character: '法师' }
});

const { entries } = await ranking.top('high-score');
const { entry } = await ranking.me('high-score');`;
