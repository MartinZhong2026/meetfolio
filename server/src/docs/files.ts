import type { AppContext } from '../lib/context.js';

export const docKey = (userId: string, meetingId: string, docId: string, ext: string) => `u/${userId}/m/${meetingId}/${docId}${ext}`;

export async function removeMeetingFiles(ctx: AppContext, userId: string, meetingId: string) {
  try {
    await ctx.storage.deletePrefix(`u/${userId}/m/${meetingId}/`);
  } catch (err) {
    ctx.logger.error({ err: (err as Error).message, meetingId }, 'failed to delete stored files');
  }
}

export async function removeAllUserFiles(ctx: AppContext, userId: string) {
  try {
    await ctx.storage.deletePrefix(`u/${userId}/`);
  } catch (err) {
    ctx.logger.error({ err: (err as Error).message }, 'failed to delete user files');
  }
}
