export interface DocumentInfo {
  content: string;
  sha256: string;
  lines: number;
}

export interface Comment {
  id: string;
  startLine: number;
  endLine: number;
  quote: string;
  comment: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CommentsFile {
  version: 1;
  document: { sha256: string; lines: number };
  status: "open" | "done";
  comments: Comment[];
}

export type NewComment = Pick<Comment, "startLine" | "endLine" | "quote" | "comment">;

const TOKEN_KEY = "llm-comment-token";

/** Takes the token from the URL fragment, then removes it from the address bar. */
function readToken(): string | null {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get("token");
  if (fromHash) {
    sessionStorage.setItem(TOKEN_KEY, fromHash);
    history.replaceState(null, "", location.pathname);
    return fromHash;
  }
  return sessionStorage.getItem(TOKEN_KEY);
}

const token = readToken();

export const hasToken = token !== null;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${token ?? ""}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(path, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(error?.error ?? `Request failed (${response.status})`);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const api = {
  document: () => request<DocumentInfo>("GET", "/api/document"),
  comments: () => request<CommentsFile>("GET", "/api/comments"),
  add: (comment: NewComment) => request<Comment>("POST", "/api/comments", comment),
  update: (id: string, comment: string) =>
    request<Comment>("PATCH", `/api/comments/${id}`, { comment }),
  remove: (id: string) => request<void>("DELETE", `/api/comments/${id}`),
  done: () => request<void>("POST", "/api/done"),
};
