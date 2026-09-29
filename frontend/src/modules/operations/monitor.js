/* One connection and one fallback poll per management page, with lifecycle cleanup. */
(function (root) {
  class Monitor {
    constructor(api, onData, onStatus) {
      this.api = api; this.onData = onData; this.onStatus = onStatus;
      this.socket = null; this.closed = true; this.seq = -1; this.delay = 1000;
      this.live = false;
      this.polling = false; this.retry = null; this.timer = null;
      this.online = () => { if (!this.closed) { clearTimeout(this.retry); this.connect(); } };
    }
    start() {
      if (!this.closed) return;
      this.closed = false;
      root.addEventListener('online', this.online);
      this.poll(); this.connect();
      this.timer = setInterval(() => {
        if (!this.live || !this.socket || this.socket.readyState !== 1 || Date.now() - this.lastMessage > 45000) {
          if (this.socket?.readyState === 1) this.socket.close();
          this.onStatus('polling'); this.poll();
        }
      }, 3000);
    }
    apply(frame) {
      if (!frame || typeof frame.seq !== 'number' || frame.seq < this.seq) return;
      this.seq = frame.seq;
      this.onData(frame.data);
    }
    async poll() {
      if (this.polling || this.closed) return;
      this.polling = true;
      try { const frame = await this.api.get('/api/monitor/snapshot'); if (!this.closed) this.apply(frame); }
      catch (error) { if (!this.closed) this.onStatus('error', error.message); }
      finally { this.polling = false; }
    }
    connect() {
      if (this.closed || this.socket && [0, 1].includes(this.socket.readyState)) return;
      this.onStatus('connecting');
      this.live = false;
      const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/monitor`);
      this.socket = socket; this.lastMessage = Date.now();
      socket.onopen = () => {
        socket.send(JSON.stringify({ token: localStorage.getItem('token') || '' }));
        this.lastMessage = Date.now();
      };
      socket.onmessage = event => {
        if (this.closed || socket !== this.socket) return;
        try {
          const frame = JSON.parse(event.data);
          this.lastMessage = Date.now();
          if (frame.type === 'ping') { socket.send(JSON.stringify({ type: 'pong' })); return; }
          if (frame.type === 'pong') return;
          this.live = true; this.delay = 1000; this.onStatus('open'); this.apply(frame);
        } catch (_) { this.onStatus('error', '实时消息格式异常'); }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (this.closed || socket !== this.socket) return;
        this.socket = null; this.live = false; this.onStatus('polling'); this.poll();
        this.retry = setTimeout(() => this.connect(), this.delay);
        this.delay = Math.min(8000, this.delay * 2);
      };
    }
    stop() {
      this.closed = true; clearInterval(this.timer); clearTimeout(this.retry);
      root.removeEventListener('online', this.online);
      if (this.socket) { this.socket.onclose = null; this.socket.close(); this.socket = null; }
    }
  }
  root.OperationsMonitor = Monitor;
  if (typeof module !== 'undefined') module.exports = Monitor;
})(typeof window !== 'undefined' ? window : globalThis);
