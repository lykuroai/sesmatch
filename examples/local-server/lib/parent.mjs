// 親サーバ（ses.lykuro.ai）APIクライアント。
// 認証は APIトークン（Bearer ses_pat_...）を推奨。未設定時は email/password の
// セッション認証（暫定運用）にフォールバックし、失効時は自動再ログインする。
import { readFile } from "fs/promises";
import path from "path";

export class ParentClient {
  constructor({ baseUrl, token, email, password }) {
    this.baseUrl = (baseUrl ?? "").replace(/\/$/, "");
    this.token = token ?? "";
    this.email = email ?? "";
    this.password = password ?? "";
    this.cookie = null;
  }

  get configured() {
    return Boolean(this.baseUrl && (this.token || (this.email && this.password)));
  }

  async #login() {
    const res = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(`親サーバへのログインに失敗 (${res.status}): ${body?.error?.message ?? ""}`);
    }
    const session = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .find((c) => c.startsWith("sesmatch_session="));
    if (!session) throw new Error("ログイン応答にセッションCookieがありません");
    this.cookie = session;
  }

  async request(pathname, options = {}) {
    const headers = { ...(options.headers ?? {}) };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    } else {
      if (!this.cookie) await this.#login();
      headers.cookie = this.cookie;
    }
    let res = await fetch(`${this.baseUrl}${pathname}`, { ...options, headers });
    if (res.status === 401 && !this.token) {
      await this.#login();
      res = await fetch(`${this.baseUrl}${pathname}`, {
        ...options,
        headers: { ...headers, cookie: this.cookie },
      });
    }
    return res;
  }

  // 原本ファイルを親サーバの取込APIへ送信する（親側でPII匿名化→LLM解析→人手確認）
  async sendDocument(filePath, displayName, expectedKind) {
    const content = await readFile(filePath);
    const form = new FormData();
    const ext = path.extname(filePath);
    const name = displayName.endsWith(ext) ? displayName : `${displayName}${ext}`;
    form.append("file", new Blob([content]), name);
    form.append("expectedKind", expectedKind);
    const res = await this.request("/api/v1/ingestions", { method: "POST", body: form });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error?.message ?? `送信に失敗しました (HTTP ${res.status})`);
    return body; // 取込ジョブ
  }

  async getIngestion(jobId) {
    const res = await this.request(`/api/v1/ingestions/${jobId}`);
    if (!res.ok) throw new Error(`取込状況の取得に失敗 (HTTP ${res.status})`);
    return res.json();
  }
}
