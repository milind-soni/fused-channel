// fused-duckdb.js
// Minimal helper for DuckDB-WASM + Parquet + GeoJSON utilities.
// Works as an ES module: <script type="module"> import { FusedDuckDB } from ".../fused-duckdb.js";
//
// Features:
// - One shared AsyncDuckDB instance per page (init/ensure caching)
// - Auto-selects WASM bundle via jsDelivr (works in browsers/CDN)
// - Installs spatial + community h3 extensions (best-effort)
// - Load Parquet from URL or bytes, create/replace a table
// - Run queries, return Arrow/JSON
// - Build GeoJSON in SQL (H3 boundary, WKT, or Point columns)
// - Simple memoized fetch for Parquet bytes
//
// Notes:
// - Keep your SQL small; very large GeoJSON may be heavy to stringify.
// - If you need streaming/tiles, compose queries to page your results.

export class FusedDuckDB {
  /** Pin DuckDB-WASM tag here if you want a specific version */
  static DUCKDB_ESM = "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.1-dev132.0/+esm";

  /** Singleton instance */
  static __instance = null;

  /** Simple in-memory cache for fetched parquet bytes */
  static __bytesCache = new Map(); // url -> Uint8Array

  /** Return existing instance or initialize a new one */
  static async ensure(opts = {}) {
    if (FusedDuckDB.__instance) return FusedDuckDB.__instance;
    const inst = await FusedDuckDB.init(opts);
    FusedDuckDB.__instance = inst;
    return inst;
  }

  /** Force a fresh instance (rarely needed) */
  static async init({ installSpatial = true, installH3 = true, logger = null } = {}) {
    const m = await import(FusedDuckDB.DUCKDB_ESM);
    const bundles = m.getJsDelivrBundles();
    const picked = await m.selectBundle(bundles);

    // Spin up worker from the selected bundle
    const workerSrc = await (await fetch(picked.mainWorker)).text();
    const worker = new Worker(
      URL.createObjectURL(new Blob([workerSrc], { type: "application/javascript" }))
    );

    const db = new m.AsyncDuckDB(logger || new m.ConsoleLogger(), worker);
    await db.instantiate(picked.mainModule);

    const conn = await db.connect();

    // Best-effort extension load
    if (installSpatial) {
      try { await conn.query("INSTALL spatial; LOAD spatial;"); } catch (e) { /* ignore */ }
    }
    if (installH3) {
      try { await conn.query("INSTALL h3 FROM community; LOAD h3;"); } catch (e) { /* ignore */ }
    }

    return new FusedDuckDB(db, conn);
  }

  constructor(db, conn) {
    this.db = db;
    this.conn = conn;
  }

  /** Close connection and worker (usually you don't need to call this) */
  async close() {
    try { await this.conn.close(); } catch {}
    try { await this.db.terminate(); } catch {}
    FusedDuckDB.__instance = null;
  }

  /** Fetch URL into Uint8Array (memoized) */
  static async fetchBytes(url) {
    if (FusedDuckDB.__bytesCache.has(url)) return FusedDuckDB.__bytesCache.get(url);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    FusedDuckDB.__bytesCache.set(url, bytes);
    return bytes;
  }

  /** Clear the memoized bytes cache */
  static clearBytesCache() {
    FusedDuckDB.__bytesCache.clear();
  }

  /** Register bytes as a DuckDB virtual file (for read_parquet) */
  async registerBuffer(name, bytes) {
    return this.db.registerFileBuffer(name, bytes);
  }

  /**
   * Load a Parquet file from URL into a DuckDB table.
   * @param {string} url - HTTP(S) URL to a parquet file
   * @param {string} table - destination table name (default: 'parquet_data')
   * @param {object} options - { replace: true, project: 'col1, col2 as x', where: '...', cast: {col:'TYPE',...} }
   */
  async loadParquet(url, table = "parquet_data", options = {}) {
    const { replace = true, project = "*", where = "", cast = null } = options;
    const bytes = await FusedDuckDB.fetchBytes(url);
    const vname = `${table}.parquet`;
    await this.registerBuffer(vname, bytes);

    const castSql = cast
      ? Object.entries(cast).map(([k, t]) => `CAST(${k} AS ${t}) AS ${k}`).join(", ")
      : null;

    const projection = castSql ? `${project}, ${castSql}`.replace(/^\*,\s*/, "") : project;

    if (replace) {
      await this.conn.query(`DROP TABLE IF EXISTS ${escapeIdent(table)};`);
    }
    await this.conn.query(`
      CREATE TABLE ${escapeIdent(table)} AS
      SELECT ${projection}
      FROM read_parquet('${vname}')
      ${where ? `WHERE ${where}` : ""}
    `);
    return table;
  }

  /**
   * Load Parquet from bytes into a table.
   * @param {Uint8Array|ArrayBuffer} bytes
   * @param {string} table
   * @param {object} options same as loadParquet
   */
  async loadParquetBytes(bytes, table = "parquet_data", options = {}) {
    const vname = `${table}.parquet`;
    await this.registerBuffer(vname, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    const { replace = true, project = "*", where = "", cast = null } = options;

    const castSql = cast
      ? Object.entries(cast).map(([k, t]) => `CAST(${k} AS ${t}) AS ${k}`).join(", ")
      : null;

    const projection = castSql ? `${project}, ${castSql}`.replace(/^\*,\s*/, "") : project;

    if (replace) {
      await this.conn.query(`DROP TABLE IF EXISTS ${escapeIdent(table)};`);
    }
    await this.conn.query(`
      CREATE TABLE ${escapeIdent(table)} AS
      SELECT ${projection}
      FROM read_parquet('${vname}')
      ${where ? `WHERE ${where}` : ""}
    `);
    return table;
  }

  /** Run a SQL query; returns a DuckDB result object (with toArray, toArrayRow, etc.) */
  async query(sql) {
    return this.conn.query(sql);
  }

  /** Run a SQL query and return rows as JS objects (simple convenience). */
  async queryJSON(sql) {
    const res = await this.query(sql);
    return res.toArray();
  }

  // ---------------------------
  // GeoJSON builders (SQL-based)
  // ---------------------------

  /**
   * Convert an H3 cell table to GeoJSON using h3_cell_to_boundary_wkt.
   * @param {object} cfg
   *   - table: source table, e.g. 'spatial_data'
   *   - hexCol: column with H3 cell index (BIGINT / string castable)
   *   - props: array of property columns to include (default: all numeric columns except hex)
   *   - where: optional WHERE clause
   * @returns {object} GeoJSON FC
   */
  async toGeoJSONFromH3({ table, hexCol = "h3_cell", props = null, where = "" }) {
    if (!table) throw new Error("toGeoJSONFromH3: 'table' is required");

    // If props is null, infer numeric columns except the hexCol
    const inferred = props || await this._inferNumericProps(table, hexCol);

    const propsExpr = inferred.length
      ? `'\"properties\":{' || ${inferred
          .map((c, i) => (i ? `','||'\"${c}\":'||${c}` : `'\"${c}\":'||${c}`))
          .join("||")} || '}'`
      : `'"properties":{}'`;

    const sql = `
      SELECT
        '{"type":"FeatureCollection","features":[' ||
        string_agg(
          '{"type":"Feature","geometry":' ||
            ST_AsGeoJSON(ST_GeomFromText(h3_cell_to_boundary_wkt(${hexCol}))) ||
            ',' || ${propsExpr} || '}',
          ','
        )
        || ']}' AS gj
      FROM ${escapeIdent(table)}
      WHERE h3_is_valid_cell(${hexCol})
      ${where ? `AND (${where})` : ""}
    `;
    const res = await this.query(sql);
    const row = res.toArray()[0] || { gj: '{"type":"FeatureCollection","features":[]}' };
    return JSON.parse(row.gj || '{"type":"FeatureCollection","features":[]}');
  }

  /**
   * Convert a table with WKT geometry column to GeoJSON.
   * @param {object} cfg
   *   - table, wktCol = 'geometry_wkt', props = [...], where
   */
  async toGeoJSONFromWKT({ table, wktCol = "geometry_wkt", props = null, where = "" }) {
    if (!table) throw new Error("toGeoJSONFromWKT: 'table' is required");
    const inferred = props || await this._inferNonGeomProps(table, [wktCol]);

    const propsExpr = inferred.length
      ? `'\"properties\":{' || ${inferred
          .map((c, i) => (i ? `','||'\"${c}\":'||${c}` : `'\"${c}\":'||${c}`))
          .join("||")} || '}'`
      : `'"properties":{}'`;

    const sql = `
      SELECT
        '{"type":"FeatureCollection","features":[' ||
        string_agg(
          '{"type":"Feature","geometry":' ||
            ST_AsGeoJSON(ST_GeomFromText(${wktCol})) ||
            ',' || ${propsExpr} || '}',
          ','
        )
        || ']}' AS gj
      FROM ${escapeIdent(table)}
      WHERE ${wktCol} IS NOT NULL
      ${where ? `AND (${where})` : ""}
    `;
    const res = await this.query(sql);
    const row = res.toArray()[0] || { gj: '{"type":"FeatureCollection","features":[]}' };
    return JSON.parse(row.gj || '{"type":"FeatureCollection","features":[]}');
  }

  /**
   * Convert a table of point columns (lng/lat) to GeoJSON.
   * @param {object} cfg
   *   - table, lngCol='lng', latCol='lat', props=[...], where
   */
  async toGeoJSONFromPoints({ table, lngCol = "lng", latCol = "lat", props = null, where = "" }) {
    if (!table) throw new Error("toGeoJSONFromPoints: 'table' is required");
    const inferred = props || await this._inferNonGeomProps(table, [lngCol, latCol]);

    const propsExpr = inferred.length
      ? `'\"properties\":{' || ${inferred
          .map((c, i) => (i ? `','||'\"${c}\":'||${c}` : `'\"${c}\":'||${c}`))
          .join("||")} || '}'`
      : `'"properties":{}'`;

    const sql = `
      SELECT
        '{"type":"FeatureCollection","features":[' ||
        string_agg(
          '{"type":"Feature","geometry":{"type":"Point","coordinates":[' || ${lngCol} || ',' || ${latCol} || ']},' ||
            ${propsExpr} || '}',
          ','
        )
        || ']}' AS gj
      FROM ${escapeIdent(table)}
      WHERE ${lngCol} IS NOT NULL AND ${latCol} IS NOT NULL
      ${where ? `AND (${where})` : ""}
    `;
    const res = await this.query(sql);
    const row = res.toArray()[0] || { gj: '{"type":"FeatureCollection","features":[]}' };
    return JSON.parse(row.gj || '{"type":"FeatureCollection","features":[]}');
  }

  // ---------------------------
  // Helpers (introspection)
  // ---------------------------

  async _inferNumericProps(table, excludeCol) {
    const cols = await this.queryJSON(`PRAGMA table_info(${escapeIdent(table)})`);
    return cols
      .filter(c =>
        c.name !== excludeCol &&
        /INT|DOUBLE|DECIMAL|REAL|FLOAT|HUGEINT|UBIGINT|BIGINT|SMALLINT|TINYINT/i.test(c.type)
      )
      .map(c => c.name);
  }

  async _inferNonGeomProps(table, excludeCols = []) {
    const cols = await this.queryJSON(`PRAGMA table_info(${escapeIdent(table)})`);
    return cols
      .filter(c => !excludeCols.includes(c.name))
      .map(c => c.name);
  }
}

// ---------------------------
// Utilities
// ---------------------------

function escapeIdent(id) {
  // basic identifier escape: wrap in quotes, double internal quotes
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) return id;
  return '"' + String(id).replace(/"/g, '""') + '"';
}
