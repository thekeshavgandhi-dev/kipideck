/**
 * In-memory stand-in for the Google Drive appDataFolder + OAuth token endpoint.
 * Implements exactly the surface lib/drive-sync.js uses, so the sync logic
 * (sharding, delta detection, merge, resumable uploads, legacy migration) can be
 * tested end to end without the network.
 */
export class MockDrive {
  constructor() {
    this.files = new Map(); // id -> { id, name, text, description, mimeType, createdTime, modifiedTime }
    this.nextId = 1;
    this.sessions = new Map(); // session URL -> { id?, name, text }
    this.calls = { token: 0, list: 0, download: 0, create: 0, update: 0, resumable: 0, delete: 0, userinfo: 0 };
    this.issuedTokens = new Set();
    this.currentToken = null;
    /** Set to make the *next* token request fail (simulating a revoked refresh token). */
    this.rejectTokenOnce = false;
    /** Set to reject all refresh_token grants (expired session). */
    this.rejectRefresh = false;
  }

  seed(name, text, description = "") {
    const id = `seed-${this.nextId++}`;
    this.files.set(id, { id, name, text, description, mimeType: "application/json", createdTime: new Date().toISOString(), modifiedTime: new Date().toISOString() });
    return id;
  }

  byName(name) {
    return [...this.files.values()].find((f) => f.name === name);
  }

  get installedFetch() {
    return (url, opts = {}) => this.fetch(url, opts);
  }

  // -- helpers -------------------------------------------------------------
  /** FormData parts arrive as File objects in Node, strings in some engines. */
  static async partText(part) {
    if (part == null) return "";
    if (typeof part === "string") return part;
    if (typeof part.text === "function") return part.text();
    return String(part);
  }

  static json(data) {
    return {
      ok: true,
      status: 200,
      headers: { get: (h) => (h.toLowerCase() === "content-type" ? "application/json" : null) },
      json: async () => data,
      text: async () => JSON.stringify(data),
    };
  }

  static error(status, data, headers = {}) {
    return {
      ok: false,
      status,
      headers: { get: (h) => headers[h.toLowerCase()] || null },
      json: async () => data,
      text: async () => JSON.stringify(data),
    };
  }

  static noContent() {
    return { ok: true, status: 204, headers: { get: () => null }, json: async () => null, text: async () => "" };
  }

  // -- router --------------------------------------------------------------
  async fetch(url, opts = {}) {
    const method = (opts.method || "GET").toUpperCase();
    const body = opts.body;
    const asText = typeof body === "string" ? body : body && typeof body.text === "function" ? await body.text() : null;

    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      this.calls.token++;
      if (this.rejectTokenOnce) {
        this.rejectTokenOnce = false;
        return MockDrive.error(400, { error: "invalid_grant" });
      }
      const params = new URLSearchParams(asText || "");
      if (params.get("grant_type") === "refresh_token") {
        if (this.rejectRefresh) return MockDrive.error(400, { error: "invalid_grant" });
        this.currentToken = `access-${this.calls.token}`;
        this.issuedTokens.add(this.currentToken);
        return MockDrive.json({ access_token: this.currentToken, expires_in: 3600, token_type: "Bearer" });
      }
      const code = params.get("code");
      if (!code) return MockDrive.error(400, { error: "invalid_request" });
      this.currentToken = `access-${this.calls.token}`;
      this.issuedTokens.add(this.currentToken);
      return MockDrive.json({
        access_token: this.currentToken,
        refresh_token: `refresh-for-${code}`,
        expires_in: 3600,
        token_type: "Bearer",
      });
    }

    if (url.includes("/oauth2/v3/userinfo")) {
      this.calls.userinfo++;
      return MockDrive.json({ email: "keeper@example.com", name: "Keeper" });
    }

    // Resumable session PUT (commits bytes to a file).
    if (url.startsWith("https://upload.mock/session/")) {
      const session = this.sessions.get(url);
      if (!session) return MockDrive.error(404, { error: { message: "session gone" } });
      const text = asText ?? (body && body.size ? String(body.size) : "");
      if (session.id) {
        const existing = this.files.get(session.id);
        if (existing) {
          existing.text = text;
          existing.size = text.length;
          existing.modifiedTime = new Date().toISOString();
        }
        this.calls.update++;
        return MockDrive.json(existing);
      }
      const id = `res-${this.nextId++}`;
      const rec = { id, name: session.name, text, size: text.length, description: session.description || "", mimeType: "application/json", createdTime: new Date().toISOString(), modifiedTime: new Date().toISOString() };
      this.files.set(id, rec);
      this.calls.create++;
      return MockDrive.json(rec);
    }

    if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files")) {
      const q = new URL(url).searchParams;
      const uploadType = q.get("uploadType");
      const idMatch = url.match(/\/files\/([^/?]+)/);

      if (uploadType === "resumable") {
        this.calls.resumable++;
        const sessionUrl = `https://upload.mock/session/${this.nextId++}`;
        let name, description, id;
        if (body instanceof FormData) {
          const meta = JSON.parse((await MockDrive.partText(body.get("metadata"))) || "{}");
          name = meta.name;
          description = meta.description;
        } else if (asText) {
          const meta = JSON.parse(asText);
          name = meta.name;
          description = meta.description;
        }
        id = idMatch ? idMatch[1] : null;
        this.sessions.set(sessionUrl, { id, name, description });
        return {
          ok: true,
          status: 200,
          headers: { get: (h) => (h.toLowerCase() === "location" ? sessionUrl : null) },
          json: async () => ({}),
          text: async () => "{}",
        };
      }

      if (uploadType === "multipart" && !idMatch) {
        if (!(body instanceof FormData)) return MockDrive.error(400, { error: { message: "expected multipart" } });
        const meta = JSON.parse((await MockDrive.partText(body.get("metadata"))) || "{}");
        const text = await MockDrive.partText(body.get("file"));
        const id = `mp-${this.nextId++}`;
        const rec = { id, name: meta.name, text, size: text.length, description: meta.description || "", mimeType: "application/json", createdTime: new Date().toISOString(), modifiedTime: new Date().toISOString() };
        this.files.set(id, rec);
        this.calls.create++;
        return MockDrive.json(rec);
      }

      if (uploadType === "media" && idMatch) {
        const existing = this.files.get(idMatch[1]);
        if (!existing) return MockDrive.error(404, { error: { message: "notFound" } });
        existing.text = asText;
        existing.size = (asText || "").length;
        existing.modifiedTime = new Date().toISOString();
        this.calls.update++;
        return MockDrive.json(existing);
      }

      return MockDrive.error(400, { error: { message: `unhandled upload ${uploadType}` } });
    }

    if (url.startsWith("https://www.googleapis.com/drive/v3/files")) {
      const parsed = new URL(url);
      const idMatch = parsed.pathname.match(/\/files\/([^/?]+)$/);

      if (!idMatch) {
        // list
        this.calls.list++;
        const fields = parsed.searchParams.get("fields") || "";
        const out = [...this.files.values()].map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          description: f.description,
          size: String(f.size || f.text.length),
          createdTime: f.createdTime,
          modifiedTime: f.modifiedTime,
          md5Checksum: fields.includes("md5Checksum") ? "mock-md5" : undefined,
        }));
        return MockDrive.json({ files: out });
      }

      const id = idMatch[1];
      const file = this.files.get(id);
      if (!file) return MockDrive.error(404, { error: { message: "notFound" } });

      if (parsed.searchParams.get("alt") === "media") {
        this.calls.download++;
        return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => JSON.parse(file.text), text: async () => file.text };
      }
      if (method === "PATCH") {
        const patch = JSON.parse(asText || "{}");
        Object.assign(file, patch, { modifiedTime: new Date().toISOString() });
        this.calls.update++;
        return MockDrive.json(file);
      }
      if (method === "DELETE") {
        this.files.delete(id);
        this.calls.delete++;
        return MockDrive.noContent();
      }
      return MockDrive.json(file);
    }

    return MockDrive.error(404, { error: { message: `mock has no route for ${method} ${url}` } });
  }
}

/** Install a mock as the global fetch; returns a restore function. */
export function installMockDrive(mock) {
  const previous = globalThis.fetch;
  globalThis.fetch = mock.installedFetch;
  return () => {
    globalThis.fetch = previous;
  };
}
