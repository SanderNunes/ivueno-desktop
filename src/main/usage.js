/**
 * Tells the server that a meeting was started (an id and a time, nothing else) so the monthly limit survives a
 * reinstall. If there is no internet the report waits in a small encrypted queue and is sent later; the server
 * ignores repeats, so replaying is always safe. The app still enforces the limit on this PC from its own count.
 */
const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

class UsageReporter {
  constructor({ api, secure, now = () => new Date() }) {
    this.api = api;
    this.secure = secure;
    this.now = now;
    this.flushing = null;
  }

  pending() { return this.secure.get('pendingUsage') || []; }

  /** Queue a meeting and try to send everything waiting. Never throws. */
  async report(meeting) {
    const queue = this.pending();
    if (!queue.some((q) => q.client_id === meeting.id)) {
      queue.push({ client_id: meeting.id, started_at: meeting.startedAt || this.now().toISOString() });
      this.secure.set('pendingUsage', queue);
    }
    return this.flush();
  }

  async flush() {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      let queue = this.pending();
      for (const item of [...queue]) {
        try {
          const res = await this.api.reportMeeting(item);
          queue = queue.filter((q) => q.client_id !== item.client_id);
          this.secure.set('pendingUsage', queue);
          this.secure.set('serverUsage', { month: monthKey(this.now()), used: res.used });
        } catch (err) {
          if (err.code === 'offline' || err.status >= 500) break;                 // try again later, keep the queue
          queue = queue.filter((q) => q.client_id !== item.client_id);            // refused for good (bad data): drop it
          this.secure.set('pendingUsage', queue);
        }
      }
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  /** The server's count for this month as last heard (0 if unknown or from an earlier month). */
  serverUsed() {
    const u = this.secure.get('serverUsage');
    return u && u.month === monthKey(this.now()) ? u.used : 0;
  }
}

module.exports = { UsageReporter, monthKey };
