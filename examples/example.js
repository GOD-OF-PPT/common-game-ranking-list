const $ = (id) => document.getElementById(id);
let client;
async function ranking() {
  const baseUrl = $('base').value.replace(/\/$/, '');
  const game = $('game').value;
  if (!/^https?:\/\//.test(baseUrl)) throw new Error('请输入 HTTP(S) 服务地址');
  if (!client || client.baseUrl !== baseUrl || client.game !== game) {
    const { RankingClient } = await import(`${baseUrl}/sdk.js`);
    client = new RankingClient({ baseUrl, game });
  }
  return client;
}
async function run(event, action) {
  event.preventDefault();
  const button = event.submitter ?? event.currentTarget;
  button.disabled = true;
  try {
    $('result').textContent = JSON.stringify(await action(await ranking()), null, 2);
  } catch (error) {
    $('result').textContent = `${error.code ?? 'ERROR'}: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}
$('form').addEventListener('submit', (event) =>
  run(event, (c) =>
    c.submit($('board').value, {
      username: $('name').value,
      metrics: { score: Number($('score').value), duration: Number($('duration').value) },
      info: { source: 'cross-origin-example' },
    }),
  ),
);
$('me').addEventListener('click', (event) => run(event, (c) => c.me($('board').value)));
$('top').addEventListener('click', (event) => run(event, (c) => c.top($('board').value)));
