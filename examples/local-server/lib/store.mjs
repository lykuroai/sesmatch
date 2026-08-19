// ローカル在庫の保存・一覧（フォルダ＋JSON方式）。
// data/在庫/案件/<id>/ に original.<ext>・extracted.json・meta.json を保存する。
// DBサーバーは使わない（仕様 §6.1）
import { mkdir, readFile, writeFile, readdir, rm, rename } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";

export const KIND_DIRS = { PROJECT_DESCRIPTION: "案件", ENGINEER_SHEET: "人材" };

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
  }

  itemDir(kind, id) {
    return path.join(this.dataDir, "在庫", KIND_DIRS[kind], id);
  }

  async init() {
    for (const dir of Object.values(KIND_DIRS)) {
      await mkdir(path.join(this.dataDir, "受入", dir), { recursive: true });
      await mkdir(path.join(this.dataDir, "在庫", dir), { recursive: true });
    }
    await mkdir(path.join(this.dataDir, "エラー"), { recursive: true });
  }

  inboxDir(kind) {
    return path.join(this.dataDir, "受入", KIND_DIRS[kind]);
  }

  errorDir() {
    return path.join(this.dataDir, "エラー");
  }

  // 解析済みの1件を在庫に保存し、受入フォルダの原本を在庫ディレクトリへ移動する
  // personName: 人材の氏名（PII。LLMには送らずメタ情報として保持。親サーバでは Level 2 開示まで相手に非公開）
  async saveItem({ kind, sourcePath, filename, extracted, maskedText, personName }) {
    const id = `${Date.now()}_${randomBytes(4).toString("hex")}`;
    const dir = this.itemDir(kind, id);
    await mkdir(dir, { recursive: true });
    const ext = path.extname(filename);
    await rename(sourcePath, path.join(dir, `original${ext}`));
    const meta = {
      id,
      kind,
      filename,
      personName: personName ?? null,
      status: "STORED", // STORED（ローカル保存のみ） | SENT（親サーバへ送信済み）
      createdAt: new Date().toISOString(),
      sentAt: null,
      parentJobId: null,
    };
    await writeFile(path.join(dir, "extracted.json"), JSON.stringify(extracted, null, 2), "utf-8");
    await writeFile(path.join(dir, "masked.txt"), maskedText, "utf-8");
    await writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");
    return meta;
  }

  async listItems(kind) {
    const base = path.join(this.dataDir, "在庫", KIND_DIRS[kind]);
    const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
    const items = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const item = await this.getItem(kind, e.name).catch(() => null);
      if (item) items.push(item);
    }
    return items.sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt));
  }

  async getItem(kind, id) {
    const dir = this.itemDir(kind, id);
    const meta = JSON.parse(await readFile(path.join(dir, "meta.json"), "utf-8"));
    const extracted = JSON.parse(await readFile(path.join(dir, "extracted.json"), "utf-8"));
    const files = await readdir(dir);
    const originalFile = files.find((f) => f.startsWith("original"));
    const attachmentFile = files.find((f) => f.startsWith("attachment"));
    return {
      meta,
      extracted,
      originalPath: originalFile ? path.join(dir, originalFile) : null,
      attachmentPath: attachmentFile ? path.join(dir, attachmentFile) : null,
    };
  }

  // 添付ファイル（職務経歴書等）を保存する。1件につき1ファイル（再添付で置き換え）
  async saveAttachment(kind, id, filename, buffer) {
    const dir = this.itemDir(kind, id);
    for (const f of await readdir(dir)) {
      if (f.startsWith("attachment")) await rm(path.join(dir, f), { force: true });
    }
    const ext = path.extname(filename);
    await writeFile(path.join(dir, `attachment${ext}`), buffer);
    return this.updateMeta(kind, id, { attachmentFilename: filename });
  }

  async deleteAttachment(kind, id) {
    const dir = this.itemDir(kind, id);
    for (const f of await readdir(dir)) {
      if (f.startsWith("attachment")) await rm(path.join(dir, f), { force: true });
    }
    return this.updateMeta(kind, id, { attachmentFilename: null });
  }

  // ローカル在庫の抽出データ（extracted.json）を差し替える（編集保存用）
  async updateExtracted(kind, id, extracted) {
    const dir = this.itemDir(kind, id);
    await writeFile(path.join(dir, "extracted.json"), JSON.stringify(extracted, null, 2), "utf-8");
    return extracted;
  }

  async updateMeta(kind, id, patch) {
    const dir = this.itemDir(kind, id);
    const meta = JSON.parse(await readFile(path.join(dir, "meta.json"), "utf-8"));
    const updated = { ...meta, ...patch };
    await writeFile(path.join(dir, "meta.json"), JSON.stringify(updated, null, 2), "utf-8");
    return updated;
  }

  async deleteItem(kind, id) {
    await rm(this.itemDir(kind, id), { recursive: true, force: true });
  }
}
