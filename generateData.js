// generateData.js
// Genererer et realistisk sammenhængende spildevands/vandforsyningsnet
// med hovedledninger, fordelingsledninger og stikledninger
// Topologi: knuder gemmes og genanvendes så ledninger faktisk hænger sammen

const CURRENT_YEAR = 2026;

// Holstebro kommune — byer og landsbyer med realistiske positioner
const AREAS = [
  { name:'Holstebro',      lat:56.362, lng:8.454,  radius:0.030, pop:35000 },
  { name:'Vinderup',       lat:56.481, lng:8.672,  radius:0.012, pop:3500  },
  { name:'Vildbjerg',      lat:56.198, lng:8.768,  radius:0.010, pop:3000  },
  { name:'Ulfborg',        lat:56.281, lng:8.318,  radius:0.008, pop:1500  },
  { name:'Kibæk',          lat:55.974, lng:8.869,  radius:0.007, pop:1200  },
  { name:'Sevel',          lat:56.453, lng:8.979,  radius:0.005, pop:600   },
  { name:'Idom',           lat:56.330, lng:8.320,  radius:0.004, pop:400   },
  { name:'Sørvad',         lat:56.398, lng:8.755,  radius:0.004, pop:350   },
  { name:'Naur',           lat:56.432, lng:8.560,  radius:0.003, pop:250   },
  { name:'Borbjerg',       lat:56.408, lng:8.629,  radius:0.003, pop:300   },
];

const MATERIALE_BY_ERA = (year) => {
  if (year < 1950) return pick(['Beton','Lerrør','Støbejern']);
  if (year < 1970) return pick(['Beton','Lerrør','PVC']);
  if (year < 1990) return pick(['PVC','Beton','PE']);
  if (year < 2005) return pick(['PVC','PE','GRP']);
  return pick(['PVC','PE','GRP','Beton']);
};

const LEDTYPE    = ['Spildevand','Regnvand','Fælles'];
const SYSTEM_BY_YEAR = (y) => y < 1980 ? 'Fælles' : y < 2000 ? pick(['Fælles','Separeret']) : pick(['Separeret','Separeret','Fælles']);
const SANERING   = ['Planlagt','Udført','Ikke planlagt','Ikke planlagt','Under udførelse'];
const STATUS_W   = ['Aktiv','Aktiv','Aktiv','Aktiv','Inaktiv','Planlagt'];
const EJER_W     = ['Kommune','Kommune','Kommune','Forsyning','Privat'];

function rnd(min, max) { return min + Math.random() * (max - min); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function padId(n) { return String(n).padStart(7,'0'); }
function snap(v, decimals=6) { return parseFloat(v.toFixed(decimals)); }

// Haversine distance in meters
function dist(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function wktLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += dist(pts[i-1][1], pts[i-1][0], pts[i][1], pts[i][0]);
  }
  return Math.round(len);
}

function riskIndices(alder, dim) {
  let s = alder > 70 ? 3+Math.floor(Math.random()*2) :
          alder > 40 ? 2+Math.floor(Math.random()*2) :
          alder > 20 ? 1+Math.floor(Math.random()*2) :
                       Math.floor(Math.random()*2);
  let k = dim >= 700 ? 3+Math.floor(Math.random()*2) :
          dim >= 400 ? 2+Math.floor(Math.random()*2) :
          dim >= 200 ? 1+Math.floor(Math.random()*2) :
                       Math.floor(Math.random()*2);
  return { sand_idx: Math.min(4,s), kons_idx: Math.min(4,k) };
}

function makePipe(id, knude_op, knude_ned, pts, type, area, dim, year) {
  const etab = `${year}-${String(1+Math.floor(Math.random()*12)).padStart(2,'0')}-01`;
  const alder = CURRENT_YEAR - year;
  const materiale = MATERIALE_BY_ERA(year);
  const laengde = Math.max(2, wktLength(pts));
  const risiko = dim >= 500 ? pick(['Høj','Høj','Middel']) :
                 dim >= 300 ? pick(['Middel','Middel','Høj','Lav']) :
                              pick(['Lav','Lav','Middel','Ukendt']);
  const { sand_idx, kons_idx } = riskIndices(alder, dim);
  const wkt = 'LINESTRING(' + pts.map(p => `${snap(p[0])} ${snap(p[1])}`).join(',') + ')';
  return {
    id: padId(id),
    knude_op, knude_ned,
    etab, lokalitet: area.name,
    dim, materiale, alder, laengde, risiko,
    status: pick(STATUS_W),
    ejer: dim >= 400 ? pick(['Kommune','Forsyning']) : pick(EJER_W),
    ledningstype: type,
    system: SYSTEM_BY_YEAR(year),
    sanering: pick(SANERING),
    sand_idx, kons_idx, wkt,
  };
}

// Generate a street grid for an area and return pipes
function generateAreaNetwork(area, targetPipes, startId, ledtype) {
  const pipes = [];
  let id = startId;

  // --- LAYER 1: Trunk mains (store transportledninger) ---
  // 2-4 tværgående hovedledninger gennem området
  const trunkNodes = [];
  const nTrunks = 2 + Math.floor(Math.random()*3);
  for (let t = 0; t < nTrunks; t++) {
    const lat0 = area.lat + rnd(-area.radius*0.8, area.radius*0.8);
    const lng0 = area.lng + rnd(-area.radius*1.2, -area.radius*0.3);
    const lat1 = lat0 + rnd(-area.radius*0.3, area.radius*0.3);
    const lng1 = area.lng + rnd(area.radius*0.3, area.radius*1.2);
    // Add intermediate nodes for realism
    const nSeg = 3 + Math.floor(Math.random()*4);
    const segPts = [];
    for (let s = 0; s <= nSeg; s++) {
      const f = s / nSeg;
      segPts.push([
        snap(lng0 + (lng1-lng0)*f + rnd(-area.radius*0.05, area.radius*0.05)),
        snap(lat0 + (lat1-lat0)*f + rnd(-area.radius*0.03, area.radius*0.03)),
      ]);
    }
    // Split into individual pipe segments
    for (let s = 0; s < segPts.length-1; s++) {
      const knop = `TM-${padId(id)}A`;
      const knned = `TM-${padId(id)}B`;
      const dim = pick([500,600,700,800,1000]);
      const year = Math.floor(rnd(1940,1990));
      pipes.push(makePipe(id++, knop, knned, [segPts[s], segPts[s+1]], ledtype, area, dim, year));
      trunkNodes.push(segPts[s]);
    }
    trunkNodes.push(segPts[segPts.length-1]);
  }

  // --- LAYER 2: Distribution mains (fordelingsledninger, gadeledninger) ---
  // Street grid emanating from trunk nodes
  const distNodes = [...trunkNodes];
  const nStreets = Math.floor(targetPipes * 0.15);
  for (let s = 0; s < nStreets && id < startId + targetPipes * 0.4; s++) {
    // Pick a random trunk node as start
    const startNode = trunkNodes[Math.floor(Math.random() * trunkNodes.length)];
    const angle = rnd(0, Math.PI*2);
    const streetLen = rnd(0.005, area.radius*1.5);
    const nSeg = 2 + Math.floor(Math.random()*5);
    const pts = [startNode];
    for (let i = 1; i <= nSeg; i++) {
      const f = i/nSeg;
      pts.push([
        snap(startNode[0] + Math.cos(angle)*streetLen*f + rnd(-0.0003,0.0003)),
        snap(startNode[1] + Math.sin(angle)*streetLen*f*0.7 + rnd(-0.0002,0.0002)),
      ]);
    }
    for (let i = 0; i < pts.length-1; i++) {
      const dim = pick([200,250,300,315,400]);
      const year = Math.floor(rnd(1955,2010));
      pipes.push(makePipe(id++, `DM-${padId(id)}A`, `DM-${padId(id)}B`, [pts[i], pts[i+1]], ledtype, area, dim, year));
      distNodes.push(pts[i+1]);
    }
  }

  // --- LAYER 3: Service connections (stikledninger til ejendomme) ---
  // Short branches off distribution nodes
  const allNodes = distNodes.length > 0 ? distNodes : trunkNodes;
  while (id < startId + targetPipes) {
    const parentNode = allNodes[Math.floor(Math.random() * allNodes.length)];
    // 1-3 stikledninger fra dette punkt
    const nStik = 1 + Math.floor(Math.random()*3);
    for (let s = 0; s < nStik && id < startId + targetPipes; s++) {
      const angle = rnd(0, Math.PI*2);
      const stikLen = rnd(0.0003, 0.002);
      const endPt = [
        snap(parentNode[0] + Math.cos(angle)*stikLen),
        snap(parentNode[1] + Math.sin(angle)*stikLen*0.7),
      ];
      // Clamp to area bounds
      const inBounds =
        endPt[1] > area.lat - area.radius*2 && endPt[1] < area.lat + area.radius*2 &&
        endPt[0] > area.lng - area.radius*3 && endPt[0] < area.lng + area.radius*3;
      if (!inBounds) continue;
      const dim = pick([110,110,160,160,160,200]);
      const year = Math.floor(rnd(1960,2025));
      const ejer = Math.random() < 0.6 ? 'Privat' : 'Kommune';
      const p = makePipe(id++, `SK-${padId(id)}A`, `SK-${padId(id)}B`, [parentNode, endPt], ledtype, area, dim, year);
      p.ejer = ejer;
      pipes.push(p);
    }
  }

  return pipes;
}

function generate(n = 100000) {
  const pipes = [];
  let id = 1;

  // Distribute pipes across areas weighted by population
  const totalPop = AREAS.reduce((s,a) => s+a.pop, 0);
  const ledtypes = ['Spildevand','Regnvand','Fælles'];

  for (const area of AREAS) {
    const share = area.pop / totalPop;
    const areaPipes = Math.round(n * share);
    // Split between ledningstyper
    const spPipes = Math.round(areaPipes * 0.45);
    const rnPipes = Math.round(areaPipes * 0.35);
    const faPipes = areaPipes - spPipes - rnPipes;

    const sp = generateAreaNetwork(area, spPipes, id, 'Spildevand');
    id += sp.length;
    const rn = generateAreaNetwork(area, rnPipes, id, 'Regnvand');
    id += rn.length;
    const fa = generateAreaNetwork(area, faPipes, id, 'Fælles');
    id += fa.length;

    pipes.push(...sp, ...rn, ...fa);
  }

  // Re-index ids cleanly
  pipes.forEach((p,i) => { p.id = padId(i+1); });

  return pipes.slice(0, n);
}

module.exports = { generate };
