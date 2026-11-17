/** Browser ESM SDK. Persist this player's token on the game's own origin. */
export class RankingClient {
  constructor({ baseUrl, game, storage }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    if (!/^https?:\/\//.test(this.baseUrl))
      throw new Error('baseUrl must be an absolute HTTP(S) URL');
    this.game = game;
    this.storageKey = `ranking:v1:${this.baseUrl}:${game}`;
    try {
      this.storage = storage === undefined ? globalThis.localStorage : storage;
    } catch {
      this.storage = null;
    }
    this.identity = null;
    this.pendingSession = null;
    try {
      this.identity = JSON.parse(this.storage?.getItem(this.storageKey) ?? 'null');
    } catch {
      /* storage unavailable */
    }
  }

  async request(path, { body, token, method = 'GET' } = {}) {
    const response = await fetch(
      `${this.baseUrl}/api/v1/games/${encodeURIComponent(this.game)}${path}`,
      {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.message ?? `HTTP ${response.status}`);
      error.code = data.code;
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async session() {
    if (
      typeof this.identity?.token === 'string' &&
      typeof this.identity?.playerId === 'string' &&
      this.identity?.expiresAt > Date.now() / 1000 + 60
    )
      return this.identity;
    if (!this.pendingSession) {
      this.pendingSession = this.request('/sessions', { method: 'POST' })
        .then((data) => {
          this.identity = data;
          try {
            this.storage?.setItem(this.storageKey, JSON.stringify(data));
          } catch {
            /* memory fallback */
          }
          return data;
        })
        .finally(() => {
          this.pendingSession = null;
        });
    }
    return this.pendingSession;
  }

  async submit(board, { username, metrics, info = {} }) {
    const { token } = await this.session();
    return this.request(`/boards/${encodeURIComponent(board)}/scores`, {
      method: 'POST',
      token,
      body: { username, metrics, info },
    });
  }

  async top(board, { limit = 20, offset = 0, authenticated = false } = {}) {
    const token = authenticated ? (await this.session()).token : undefined;
    return this.request(`/boards/${encodeURIComponent(board)}?limit=${limit}&offset=${offset}`, {
      token,
    });
  }

  async me(board) {
    const { token, playerId } = await this.session();
    return this.request(
      `/boards/${encodeURIComponent(board)}/players/${encodeURIComponent(playerId)}`,
      { token },
    );
  }
}
