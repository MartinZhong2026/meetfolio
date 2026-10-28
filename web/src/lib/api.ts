import type { AppConfig, Bundle, Gap, Meeting, MeetingType, Note, NoteCategory, Participant, Question, RefDoc, Segment, Summary, Usage, User } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

async function request<T>(method: string, url: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined && !(body instanceof FormData) && !(body instanceof ArrayBuffer) ? { 'Content-Type': 'application/json' } : undefined,
      body: body === undefined ? undefined : body instanceof FormData || body instanceof ArrayBuffer ? (body as BodyInit) : JSON.stringify(body),
      ...init,
    });
  } catch {
    throw new ApiError(0, 'network', '网络连接不可用，请检查网络后重试');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new CustomEvent('mf:unauthorized'));
    throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? '请求失败，请稍后重试');
  }
  return data as T;
}

const get = <T>(u: string) => request<T>('GET', u);
const post = <T>(u: string, b?: unknown) => request<T>('POST', u, b ?? {});
const put = <T>(u: string, b?: unknown) => request<T>('PUT', u, b ?? {});
const patch = <T>(u: string, b?: unknown) => request<T>('PATCH', u, b ?? {});
const del = <T>(u: string, b?: unknown) => request<T>('DELETE', u, b);

export interface MeetingInput {
  title: string;
  meetingDate?: string;
  type?: MeetingType;
  location?: string;
  organizer?: string;
  researchContext?: string;
  guideTopic?: string;
  participants?: Participant[];
  demo?: boolean;
}

export const api = {
  config: () => get<AppConfig>('/api/config'),
  me: () => get<{ user: User | null }>('/api/auth/me'),
  register: (b: { email: string; password: string; name?: string }) => post<{ user: User }>('/api/auth/register', b),
  login: (b: { email: string; password: string }) => post<{ user: User }>('/api/auth/login', b),
  logout: () => post<{ ok: true }>('/api/auth/logout'),
  forgot: (email: string) => post<{ ok: true }>('/api/auth/forgot', { email }),
  reset: (token: string, password: string) => post<{ ok: true }>('/api/auth/reset', { token, password }),
  updateName: (name: string) => patch<{ user: User }>('/api/account', { name }),
  changePassword: (currentPassword: string, newPassword: string) => post<{ ok: true }>('/api/account/password', { currentPassword, newPassword }),
  deleteAccount: (password: string) => del<{ ok: true }>('/api/account', { password }),
  usage: () => get<Usage>('/api/account/usage'),

  meetings: (q?: string) => get<{ meetings: Meeting[] }>(`/api/meetings${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  createMeeting: (b: MeetingInput) => post<{ meeting: Meeting }>('/api/meetings', b),
  bundle: (id: string) => get<Bundle>(`/api/meetings/${id}`),
  updateMeeting: (id: string, b: Partial<MeetingInput>) => patch<{ meeting: Meeting }>(`/api/meetings/${id}`, b),
  deleteMeeting: (id: string) => del<{ ok: true }>(`/api/meetings/${id}`),
  endMeeting: (id: string) => post<{ meeting: Meeting }>(`/api/meetings/${id}/end`),
  reopenMeeting: (id: string) => post<{ meeting: Meeting }>(`/api/meetings/${id}/reopen`),

  putNote: (mid: string, id: string, b: { category: NoteCategory; content: string; isImportant: boolean; timestampMs?: number | null }) => put<{ note: Note }>(`/api/meetings/${mid}/notes/${id}`, b),
  deleteNote: (mid: string, id: string) => del<{ ok: true }>(`/api/meetings/${mid}/notes/${id}`),

  putQuestion: (mid: string, id: string, b: { text: string; done?: boolean; isFollowup?: boolean }) => put<{ question: Question }>(`/api/meetings/${mid}/questions/${id}`, b),
  deleteQuestion: (mid: string, id: string) => del<{ ok: true }>(`/api/meetings/${mid}/questions/${id}`),
  importGuide: (mid: string, text: string, replace = false) => post<{ questions: Question[]; topic: string | null }>(`/api/meetings/${mid}/guide/import`, { text, replace }),

  uploadDoc: (mid: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ document: RefDoc }>('POST', `/api/meetings/${mid}/documents`, fd);
  },
  pasteDoc: (mid: string, title: string, text: string) => post<{ document: RefDoc; text: string }>(`/api/meetings/${mid}/documents/paste`, { title, text }),
  docText: (mid: string, id: string) => get<{ document: RefDoc; text: string }>(`/api/meetings/${mid}/documents/${id}`),
  updateDoc: (mid: string, id: string, b: { title?: string; text?: string }) => patch<{ document: RefDoc }>(`/api/meetings/${mid}/documents/${id}`, b),
  deleteDoc: (mid: string, id: string) => del<{ ok: true }>(`/api/meetings/${mid}/documents/${id}`),

  patchSegment: (mid: string, id: string, b: { editedText?: string | null; speakerLabel?: string | null; isImportant?: boolean }) => patch<{ segment: Segment }>(`/api/meetings/${mid}/segments/${id}`, b),
  addSegment: (mid: string, b: { startMs: number; text: string; speakerLabel?: string }) => post<{ segment: Segment }>(`/api/meetings/${mid}/segments`, b),
  deleteSegment: (mid: string, id: string) => del<{ ok: true }>(`/api/meetings/${mid}/segments/${id}`),

  gaps: (mid: string) => get<{ gaps: Gap[] }>(`/api/meetings/${mid}/gaps`),
  uploadGapAudio: (mid: string, gapId: string, fromMs: number, pcm: ArrayBuffer) =>
    request<{ chunkId: string }>('POST', `/api/meetings/${mid}/gaps/${gapId}/audio?fromMs=${Math.round(fromMs)}`, pcm, { headers: { 'Content-Type': 'application/octet-stream' } }),
  markGapUnrecoverable: (mid: string, gapId: string) => post<{ gap: Gap }>(`/api/meetings/${mid}/gaps/${gapId}/unrecoverable`),

  generateSummary: (mid: string, mode: 'standard' | 'quality' | 'interim') => post<{ summary: Summary }>(`/api/meetings/${mid}/summary`, { mode }),
  summaries: (mid: string) => get<{ summaries: Summary[] }>(`/api/meetings/${mid}/summaries`),
  saveSummary: (mid: string, sid: string, editedMd: string | null) => patch<{ summary: Summary }>(`/api/meetings/${mid}/summaries/${sid}`, { editedMd }),

  exportUrl: (mid: string, format: 'docx' | 'md' | 'txt', parts?: string[]) => `/api/meetings/${mid}/export?format=${format}${parts ? `&parts=${parts.join(',')}` : ''}`,
};
