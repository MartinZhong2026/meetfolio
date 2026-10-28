/**
 * Tracks live transcription connections on this server instance. One live session per meeting and per
 * user at a time. (Single-instance by design — see docs/architecture.md for scaling notes.)
 */
export interface LiveHandle {
  meetingId: string;
  userId: string;
  /** Gracefully finish: flush provider, persist everything. */
  stop(): Promise<void>;
  /** Terminate immediately with a reason shown to the client. */
  abort(reason: string): Promise<void>;
}

export class TranscriptionRegistry {
  private byMeeting = new Map<string, LiveHandle>();

  get(meetingId: string) {
    return this.byMeeting.get(meetingId);
  }

  activeForUser(userId: string): LiveHandle | undefined {
    for (const h of this.byMeeting.values()) if (h.userId === userId) return h;
    return undefined;
  }

  register(h: LiveHandle) {
    this.byMeeting.set(h.meetingId, h);
  }

  unregister(h: LiveHandle) {
    if (this.byMeeting.get(h.meetingId) === h) this.byMeeting.delete(h.meetingId);
  }

  async closeMeeting(meetingId: string, reason: string) {
    const h = this.byMeeting.get(meetingId);
    this.byMeeting.delete(meetingId);
    await h?.abort(reason);
  }

  async stopMeeting(meetingId: string) {
    const h = this.byMeeting.get(meetingId);
    if (h) await h.stop();
  }

  async stopAll() {
    await Promise.allSettled([...this.byMeeting.values()].map((h) => h.stop()));
  }

  size() {
    return this.byMeeting.size;
  }
}
