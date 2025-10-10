// fused-duckdb.min.js
// Tiny helper around DuckDB-WASM to init once, load data files, and run queries.
// No spatial/h3 helpers, no GeoJSON—pure data plumbing for charts/tables.
//
// Usage:
//   import { FusedDuckDB } from '.../fused-duckdb.min.js';
//   const db = await FusedDuckDB.ensure();
//   await db.loadParquet('https://.../data.parquet', 'mytable');
//   const rows = await db.queryJSON('SELECT col FROM mytable LIMIT 100');

export class FusedDuckDB {
  static DUCKDB_ESM = "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.1-dev132.0/+esm";
  static __instance = null;
  static __bytesCache = new Map(); // url -> Uint8Array

  /** Get a shared instance or create it */
  static async ensure(opts = {}) {
    if (FusedDuckDB.__instance) return FusedDuckDB.__instance;
    const inst = await FusedDuckDB.init(opts);
    FusedDuckDB.__instance = inst;
    return inst;
  }

  /** Create a fresh instance (rarely needed) */
  static async init({ logger = null } = {}) {
    const m = await import(FusedDuckDB.DUCKDB_ESM);
    const picked = await m.selectBundle(m.getJsDelivrBundles());

    const workerSrc = await (await fetch(picked.mainWorker)).text();
    const worker = new Worker(
      URL.createObjectURL(new Blob([workerSrc], { type: "application/javascript" }))
    );

    const db = new m.AsyncDuckDB(logger || new m.ConsoleLogger(), worker);
    await db.instantiate(picked.mainModule);
    const conn = await db.connect();

    return new FusedDuckDB(db, conn);
  }

  constructor(db, conn) {
    this.db = db;
    this.conn = conn;
  }

  /** Close connection and worker (optional) */
  async close() {
    try { await this.conn.close(); } catch {}
    try { await this.db.terminate(); } catch {}
    FusedDuckDB.__instance = null;
  }

  // -------- fetch/IO --------

  static async fetchBytes(url) {
    if (FusedDuckDB.__bytesCache.has(url)) return FusedDuckDB.__bytesCache.get(url);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    FusedDuckDB.__bytesCache.set(url, bytes);
    return bytes;
  }

  static clearBytesCache() {
    FusedDuckDB.__bytesCache.clear();
  }

  async registerBuffer(vname, bytes) {
    return this.db.registerFileBuffer(vname, bytes);
  }

  // -------- loaders (Parquet/CSV/JSON) --------

  /**
   * Load a Parquet file into a table.
   * options: { replace=true, project='*', where='', cast:{col:'TYPE',...} }
   */
  async loadParquet(url, table = "parquet_data", options = {}) {
    const { replace = true, project = "*", where = "", cast = null } = options;
    const vname = `${table}.parquet`;
    const bytes = await FusedDuckDB.fetchBytes(url);
    await this.registerBuffer(vname, bytes);

    const castSql = cast
      ? Object.entries(cast).map(([k, t]) => `CAST(${escapeIdent(k)} AS ${t}) AS ${escapeIdent(k)}`).join(", ")
      : null;
    const projection = castSql ? `${project}, ${castSql}`.replace(/^\*,\s*/, "") : project;

    if (replace) await this.conn.query(`DROP TABLE IF EXISTS ${escapeIdent(table)};`);
    await this.conn.query(`
      CREATE TABLE ${escapeIdent(table)} AS
      SELECT ${projection}
      FROM read_parquet('${vname}')
      ${where ? `WHERE ${where}` : ""}
    `);
    return table;
  }

  /**
   * Load CSV from URL into a table.
   * options: { replace=true, header=true, delim=',', nullstr='',
   *            columns:{name:'TYPE',...}, project='*', where='' }
   */
  async loadCSV(url, table = "csv_data", options = {}) {
    const {
      replace = true, header = true, delim = ",", nullstr = "",
      columns = null, project = "*", where = ""
    } = options;

    const vname = `${table}.csv`;
    const text = await (await fetch(url)).text();
    const bytes = new TextEncoder().encode(text);
    await this.registerBuffer(vname, bytes);

    const colsDecl = columns
      ? `(${Object.entries(columns).map(([n,t]) => `${escapeIdent(n)} ${t}`).join(", ")})`
      : "";

    if (replace) await this.conn.query(`DROP TABLE IF EXISTS ${escapeIdent(table)};`);
    await this.conn.query(`
      CREATE TABLE ${escapeIdent(table)} AS
      SELECT ${project}
      FROM read_csv('${vname}', ${colsDecl ? `columns=${colsDecl},` : ""}
           header=${header}, delim='${delim}', nullstr='${nullstr}')
      ${where ? `WHERE ${where}` : ""}
    `);
    return table;
  }

  /**
   * Load a JSON file (newline-delimited JSON lines or array) into a table.
   * options: { replace=true, project='*', where='' }
   */
  async loadJSON(url, table = "json_data", options = {}) {
    const { replace = true, project = "*", where = "" } = options;

    const vname = `${table}.json`;
    const text = await (await fetch(url)).text();
    const bytes = new TextEncoder().encode(text);
    await this.registerBuffer(vname, bytes);

    if (replace) await this.conn.query(`DROP TABLE IF EXISTS ${escapeIdent(table)};`);
    // DuckDB can read json/ndjson via read_json_auto
    await this.conn.query(`
      CREATE TABLE ${escapeIdent(table)} AS
      SELECT ${project}
      FROM read_json_auto('${vname}')
      ${where ? `WHERE ${where}` : ""}
    `);
    return table;
  }

  // -------- queries --------

  async query(sql) {
    return this.conn.query(sql);
  }

  async queryJSON(sql) {
    const res = await this.query(sql);
    return res.toArray();
  }

  // Optional: get Arrow table (for typed pipelines)
  async queryArrow(sql) {
    const res = await this.query(sql);
    return res.toArrowTable();
  }
}

// -------- utils --------
function escapeIdent(id) {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) return id;
  return '"' + String(id).replace(/"/g, '""') + '"';
}
