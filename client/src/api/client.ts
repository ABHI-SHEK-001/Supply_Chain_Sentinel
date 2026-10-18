import type { ApiResponse } from '../types/api';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

interface RequestOptions {
  signal?: AbortSignal;
  timeout?: number;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const controller = new AbortController();
  const timeoutId = options?.timeout
    ? setTimeout(() => controller.abort(), options.timeout)
    : undefined;

  let combinedSignal: AbortSignal = controller.signal;
  if (options?.signal) {
    if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).any === 'function') {
      combinedSignal = (AbortSignal as any).any([controller.signal, options.signal]);
    } else {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }
  }

  try {
    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: combinedSignal,
    });

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      if (!res.ok) {
        throw new ApiClientError(res.status, 'NON_JSON_ERROR', `Server returned ${res.status}`);
      }
      return undefined as T;
    }

    const json = (await res.json()) as ApiResponse<T>;

    if (!res.ok || !json.success) {
      const err = 'error' in json ? json.error : { code: 'UNKNOWN', message: `HTTP ${res.status}` };
      throw new ApiClientError(res.status, err.code, err.message, err.details);
    }

    return json.data;
  } catch (err) {
    if (err instanceof ApiClientError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new NetworkError('Request was cancelled');
    }
    if (err instanceof TypeError) {
      throw new NetworkError(`Connection failed: ${err.message}`);
    }
    throw err;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export function get<T>(path: string, options?: RequestOptions): Promise<T> {
  return request<T>('GET', path, undefined, options);
}

export function post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
  return request<T>('POST', path, body, options);
}

export function getBaseUrl(): string {
  return BASE_URL;
}
