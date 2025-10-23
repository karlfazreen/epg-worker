// server.js
import express from "express";
import fetch from "node-fetch";
import zlib from "zlib";

const app = express();
const PORT = process.env.PORT || 10000;

const EPG_URLS = [
  "https://raw.githubusercontent.com/AqFad2811/epg/main/epg.xml",
  "https://azimabid00.github.io/epg/astro_epg.xml",
  "https://azimabid00.github.io/epg/unifi_epg.xml",
  "https://epg.pw/xmltv/epg_ID.xml.gz",
  "https://epg.pw/xmltv/epg_IN.xml.gz",
  "https://i.mjh.nz/SamsungTVPlus/us.xml.gz",
  "https://i.mjh.nz/SamsungTVPlus/gb.xml.gz",
  "https://raw.githubusercontent.com/ydbf/MoveOnJoy/refs/heads/main/epg.xml",
  "https://raw.githubusercontent.com/dbghelp/mewatch-EPG/refs/heads/main/mewatch.xml",
  "https://iptvx.one/EPG",
  "https://epg.pw/api/epg.xml?channel_id=247795",
  "https://epg.pw/api/epg.xml?channel_id=62234",
  "https://epg.pw/api/epg.xml?channel_id=427680",
  "https://epg.pw/xmltv/epg_TH.xml",
  "https://animenosekai.github.io/japanterebi-xmltv/guide.xml",
  "https://www.open-epg.com/files/philippines1.xml.gz",
  "https://epgshare01.online/epgshare01/epg_ripper_SG1.xml.gz",
  "https://epgshare01.online/epgshare01/epg_ripper_UK1.xml.gz"
];

// Simple in-memory cache
const cache = new Map();

app.get("/", async (req, res) => {
  // Support query params on root: ?gzip=1&ttl=86400
  try {
    const gzipOut = req.query.gzip === "1";
    const ttl = Number(req.query.ttl) || 3600; // seconds
    const cacheKey = `merged-epg-v1-${gzipOut ? "gz" : "xml"}-${ttl}`;

    // Return cached if exists
    const cached = cache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < (ttl * 1000)) {
      // Serve cached
      if (cached.encoding) res.set("Content-Encoding", cached.encoding);
      res.set("Content-Type", cached.type);
      res.set("Cache-Control", `max-age=${ttl}`);
      return res.send(cached.data);
    }

    // Fetch all sources in parallel
    const results = await Promise.allSettled(EPG_URLS.map(fetchEPG));

    const channelMap = new Map();
    const programmeMap = new Map();

    for (const r of results) {
      if (r.status !== "fulfilled" || !r.value) continue;
      const text = r.value;

      for (const m of text.matchAll(/<channel\b[^>]*>[\s\S]*?<\/channel>/gi)) {
        const chunk = m[0];
        const idMatch = chunk.match(/<channel[^>]*\bid=["']([^"']+)["']/i);
        if (!idMatch) continue;
        const id = idMatch[1].trim();
        if (!channelMap.has(id)) channelMap.set(id, chunk);
      }

      for (const m of text.matchAll(/<programme\b[^>]*>[\s\S]*?<\/programme>/gi)) {
        const chunk = m[0];
        const channelAttr = (chunk.match(/channel=["']([^"']+)["']/i) || [])[1];
        const startAttr = (chunk.match(/start=["']([^"']+)["']/i) || [])[1];
        if (!channelAttr || !startAttr) continue;
        const key = `${channelAttr}||${startAttr}`;
        if (!programmeMap.has(key)) programmeMap.set(key, chunk);
      }
    }

    // Build merged XML
    const header = '<?xml version="1.0" encoding="UTF-8"?>\n';
    let merged = header + '<tv generator-info-name="merged-by-render">\n';
    for (const ch of channelMap.values()) merged += ch + '\n';
    for (const p of programmeMap.values()) merged += p + '\n';
    merged += '</tv>';

    if (gzipOut) {
      const gzipped = zlib.gzipSync(Buffer.from(merged, "utf8"));
      // Cache gzipped buffer
      cache.set(cacheKey, { data: gzipped, type: "application/gzip", encoding: "gzip", ts: Date.now() });
      res.set("Content-Type", "application/gzip");
      res.set("Content-Encoding", "gzip");
      res.set("Cache-Control", `max-age=${ttl}`);
      return res.send(gzipped);
    }

    // Cache plain XML
    cache.set(cacheKey, { data: merged, type: "application/xml; charset=utf-8", ts: Date.now() });
    res.set("Content-Type", "application/xml; charset=utf-8");
    res.set("Cache-Control", `max-age=${ttl}`);
    return res.send(merged);

  } catch (err) {
    console.error(err);
    return res.status(500).send("Worker error: " + err.message);
  }
});

async function fetchEPG(url) {
  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) throw new Error(`${url} -> ${r.status}`);

    const ct = r.headers.get("content-type") || "";
    const ce = r.headers.get("content-encoding") || "";
    const isGz = /\.gz($|\?)/i.test(url) || /gzip/i.test(ce) || /application\/(gzip|x-gzip)/i.test(ct);

    const arrayBuf = await r.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    if (isGz) {
      try {
        const unz = zlib.gunzipSync(buf);
        return unz.toString();
      } catch (e) {
        // fallback: attempt inflate
        const infl = zlib.inflateSync(buf);
        return infl.toString();
      }
    }
    return buf.toString();
  } catch (err) {
    console.error(`❌ Fetch fail ${url}:`, err.message);
    return null;
  }
}

app.listen(PORT, () => console.log(`🚀 EPG Worker running on port ${PORT}`));


/*
  package.json (add this file to your repo)
  {
    "name": "epg-worker",
    "version": "1.0.0",
    "main": "server.js",
    "type": "module",
    "dependencies": {
      "express": "^4.19.2",
      "node-fetch": "^3.3.2"
    }
  }
*/
