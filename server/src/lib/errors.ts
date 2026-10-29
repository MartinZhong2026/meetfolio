export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message = '请求参数无效', code = 'bad_request') => new HttpError(400, code, message);
export const unauthorized = (message = '请先登录', code = 'unauthorized') => new HttpError(401, code, message);
export const forbidden = (message = '没有权限', code = 'forbidden') => new HttpError(403, code, message);
export const notFound = (message = '未找到', code = 'not_found') => new HttpError(404, code, message);
export const conflict = (message = '操作冲突', code = 'conflict') => new HttpError(409, code, message);
export const tooMany = (message = '请求过于频繁，请稍后再试', code = 'rate_limited') => new HttpError(429, code, message);
