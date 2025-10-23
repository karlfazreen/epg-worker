import express from "express";
import fetch from "node-fetch";
import zlib from "zlib";

const app = express();
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

const cache = new Map();

app.get("/", (req, res) => {
  res.send("😎 Abang Hensem EPG Worker (Node.js Render Version) is running!");
});

app.get("/merge", async (req, res) => {
  try {
    const gzipOut = req.query.gzip === "1";
    const ttl = Number(req.query.ttl) || 3600;
    const cacheKey = `merged-epg-v1-${gzipOut ? "gz" : "xml"}-${ttl}`;

    if (cache.has(cacheKey)) {
      const { data, type, encoding } = cache.get(cacheKey);
      res.set("Content-Type", type);
      if (encoding) res.set("Content-Encoding", encoding);
      return res.send(data);
    }

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

    let merged = '<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="merged-by-render">\n';
    for (const ch of channelMap.values()) merged += ch + "\n";
    for (const p of programmeMap.values()) merged += p + "\n";
    merged += "</tv>";

    if (gzipOut) {
      const gzipped = zlib.gzipSync(merged);
      cache.set(cacheKey, {
        data: gzipped,
        type: "application/gzip",
        encoding: "gzip"
      });
      res.set("Content-Type", "application/gzip");
      res.set("Content-Encoding", "gzip");
      res.set("Cache-Control", `max-age=${ttl}`);
      res.send(gzipped);
    } else {
      cache.set(cacheKey, {
        data: merged,
        type: "application/xml; charset=utf-8"
      });
      res.set("Content-Type", "application/xml; charset=utf-8");
      res.set("Cache-Control", `max-age=${ttl}`);
      res.send(merged);
    }

  } catch (err) {
    console.error(err);
    res.status(500).send("❌ Worker error: " + err.message);
  }
});

async function fetchEPG(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);

    const buffer = await res.arrayBuffer();
    const isGz =
      /\.gz($|\?)/i.test(url) ||
      /gzip/i.test(res.headers.get("content-encoding") || "") ||
      /application\/(gzip|x-gzip)/i.test(res.headers.get("content-type") || "");

    const data = isGz ? zlib.gunzipSync(Buffer.from(buffer)) : Buffer.from(buffer);
    return data.toString();
  } catch (err) {
    console.error(`❌ Fetch fail ${url}:`, err.message);
    return null;
  }
}

app.listen(10000, () => console.log("🚀 EPG Worker running on port 10000"));
