import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { meetings } from '../db/schema.js';
import type { AppContext } from './context.js';
import { notFound } from './errors.js';
import { requireUser } from '../plugins/auth.js';

const uuid = z.string().uuid();
export const isUuid = (s: unknown): s is string => uuid.safeParse(s).success;

/**
 * Loads a meeting the current user owns. Missing and foreign meetings are indistinguishable
 * (both 404), so ids of other users' records cannot be probed.
 */
export async function getOwnedMeeting(ctx: AppContext, req: FastifyRequest, meetingId: string) {
  const user = requireUser(req);
  if (!isUuid(meetingId)) throw notFound('会议不存在');
  const [m] = await ctx.db.select().from(meetings).where(and(eq(meetings.id, meetingId), eq(meetings.userId, user.id))).limit(1);
  if (!m) throw notFound('会议不存在');
  return m;
}

export async function getOwnedMeetingByUser(ctx: AppContext, userId: string, meetingId: string) {
  if (!isUuid(meetingId)) return null;
  const [m] = await ctx.db.select().from(meetings).where(and(eq(meetings.id, meetingId), eq(meetings.userId, userId))).limit(1);
  return m ?? null;
}
