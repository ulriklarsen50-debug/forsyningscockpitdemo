// server.js
// Simulerer en SQL Server REST API til LIFA Forsyningsoverblik
//
// I PRODUKTION erstattes in-memory data med:
//   const sql = require('mssql');
//   const pool = await sql.connect(config);
//   const result = await pool.request()
//     .input('risiko', sql.VarChar, filters.risiko)
//     .query(`SELECT id, ..., geometry.STAsText() AS wkt
//             FROM ledninger WHERE (@risiko IS NULL OR risiko=@risiko) ...`);

const express = require('express');
const cors    = require('cors');
const { generate } = require('./generateData');

const app  = express();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('LIFA API kører på port ${PORT}'));
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/node_modules', express.static('node_modules'));

// ── Generate dataset once on startup ──────────────────────────────────────────
console.log('Genererer 100.000 ledninger...');
const t0    = Date.now();
const PIPES = generate(100000);
console.log(`Klar på ${Date.now()-t0}ms — ${PIPES.length.toLocaleString()} ledninger i memory`);

// ── Pre-compute unique filter values ──────────────────────────────────────────
const FILTER_VALUES = {};
['status','ejer','ledningstype','materiale','dim','system','lokalitet','risiko','sanering']
  .forEach(field => {
    FILTER_VALUES[field] = [...new Set(PIPES.map(p => String(p[field])))].sort();
  });

// ── Helper: apply filters to dataset ─────────────────────────────────────────
function applyFilters(pipes, q) {
  return pipes.filter(p => {
    if (q.yearFrom && p.etab.slice(0,4) < q.yearFrom) return false;
    if (q.yearTo   && p.etab.slice(0,4) > q.yearTo)   return false;
    if (q.status       && p.status       !== q.status)       return false;
    if (q.ejer         && p.ejer         !== q.ejer)          return false;
    if (q.ledningstype && p.ledningstype !== q.ledningstype)  return false;
    if (q.materiale    && p.materiale    !== q.materiale)     return false;
    if (q.dim          && String(p.dim)  !== String(q.dim))   return false;
    if (q.system       && p.system       !== q.system)        return false;
    if (q.lokalitet    && p.lokalitet    !== q.lokalitet)     return false;
    if (q.risiko       && p.risiko       !== q.risiko)        return false;
    if (q.sanering     && p.sanering     !== q.sanering)      return false;
    if (q.sand_idx     !== undefined && String(p.sand_idx)  !== String(q.sand_idx))  return false;
    if (q.kons_idx     !== undefined && String(p.kons_idx)  !== String(q.kons_idx))  return false;
    // Matrix multi-select: sand_kons = "s,k|s,k|..."
    if (q.matrix) {
      const cells = q.matrix.split('|').map(c => c.split(',').map(Number));
      if (!cells.some(([s,k]) => p.sand_idx===s && p.kons_idx===k)) return false;
    }
    if (q.ids) {
      const ids = q.ids.split(',');
      if (!ids.includes(p.id)) return false;
    }
    return true;
  });
}

// ── GET /api/filter-values ─────────────────────────────────────────────────
// Returns unique dropdown values
app.get('/api/filter-values', (req, res) => {
  res.json(FILTER_VALUES);
});

// ── GET /api/matrix ────────────────────────────────────────────────────────
// Returns 5x5 matrix of summed lengths, respecting sidebar filters (excl. matrix)
app.get('/api/matrix', (req, res) => {
  const t = Date.now();
  const filtered = applyFilters(PIPES, req.query);
  const sums = Array.from({length:5}, () => new Array(5).fill(0));
  filtered.forEach(p => { sums[p.sand_idx][p.kons_idx] += p.laengde; });
  console.log(`/api/matrix ${filtered.length} pipes in ${Date.now()-t}ms`);
  res.json({ sums, total: filtered.reduce((s,p)=>s+p.laengde,0), count: filtered.length });
});

// ── GET /api/geojson ───────────────────────────────────────────────────────
// Returns GeoJSON FeatureCollection for MapLibre
// Supports bbox for viewport-based loading: ?bbox=lng1,lat1,lng2,lat2
// In production this would be a PostGIS/SQL Server spatial query
app.get('/api/geojson', (req, res) => {
  const t = Date.now();
  const filtered = applyFilters(PIPES, req.query);

  const sample = filtered;

  const geojson = {
    type: 'FeatureCollection',
    features: sample.map(p => ({
      type: 'Feature',
      properties: {
        id: p.id, materiale: p.materiale, risiko: p.risiko,
        dim: p.dim, alder: p.alder, laengde: p.laengde,
        status: p.status, sand_idx: p.sand_idx, kons_idx: p.kons_idx,
      },
      geometry: wktToGeoJSON(p.wkt),
    })),
  };

  console.log(`/api/geojson ${filtered.length}→${sample.length} features in ${Date.now()-t}ms`);
  res.json({ ...geojson, _total: filtered.length, _shown: sample.length });
});

// ── GET /api/table ─────────────────────────────────────────────────────────
// Paginated table data
app.get('/api/table', (req, res) => {
  const t       = Date.now();
  const page    = parseInt(req.query.page  || 0);
  const limit   = parseInt(req.query.limit || 100);
  const filtered = applyFilters(PIPES, req.query);
  const slice   = filtered.slice(page*limit, page*limit+limit);
  const total_laengde = filtered.reduce((s,p)=>s+p.laengde,0);
  console.log(`/api/table ${filtered.length} pipes, page ${page} in ${Date.now()-t}ms`);
  res.json({
    rows: slice.map(({wkt,...rest}) => rest), // exclude WKT from table
    total: filtered.length,
    total_laengde,
    page, limit,
  });
});

// ── GET /api/barchart ─────────────────────────────────────────────────────
// Returns meter per year aggregation
app.get('/api/barchart', (req, res) => {
  const filtered = applyFilters(PIPES, req.query);
  const byYear = {};
  filtered.forEach(p => {
    const yr = p.etab.slice(0,4);
    byYear[yr] = (byYear[yr]||0) + p.laengde;
  });
  res.json(byYear);
});

// ── WKT → GeoJSON geometry helper ─────────────────────────────────────────
function wktToGeoJSON(wkt) {
  const inner = wkt.replace(/^LINESTRING\s*\(/, '').replace(/\)$/, '');
  const coords = inner.split(',').map(pair => pair.trim().split(/\s+/).map(Number));
  return { type: 'LineString', coordinates: coords };
}

app.listen(PORT, () => console.log(`LIFA API kører på http://localhost:${PORT}`));
