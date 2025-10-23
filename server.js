// 🛰️ EPG Worker for Render.com 
import express from "express";
import fetch from "node-fetch";
import zlib from "zlib";

const app = express();
const PORT = process.env.PORT || 10000;

// 🧾 Senarai sumber EPG 
const EPG_URLS = [
  "https://raw.githubusercontent.com/AqFad2811/epg/main/epg.xml",
  "https://azimabid00.github.io/epg/astro_epg.xml",
  "https://azimabid00.github.io/epg/unifi_epg.xml",
  "https://i.mjh.nz/SamsungTVPlus/us.xml.gz",
  "https://i.mjh.nz/SamsungTVPlus/gb.xml.gz",
  "https://epg.pw/xmltv/epg_ID.xml.gz",
  "https://epg.pw/xmltv/epg_IN.xml.gz",
  "https://www.open-epg.com/files/philippines1.xml.gz",
  "https://raw.githubusercontent.com/ydbf/MoveOnJoy/refs/heads/main/epg.xml",
  "https://raw.githubusercontent.com/dbghelp/mewatch-EPG/refs/heads/main/mewatch.xml",
  "https://epg.pw/xmltv/epg_TH.xml",              // Thailand pack
  "https://animenosekai.github.io/japanterebi-xmltv/guide.xml", // Japan
  "https://www.open-epg.com/files/philippines1.xml.gz",
];

app.get("/", async (req, res) => {
  const gzipOut = req.query.gzip === "1";
  const ttl = Number(req.query.ttl) || 3600;

  try {
    console.log("🚀 Fetching EPG sources...");
    const results = [];

    // Fetch satu per satu supaya tak overload memori
    for (const url of EPG_URLS) {
      const data = await fetchEPG(url);
      if (data) results.push(data);
      await new Promise((r) => setTimeout(r, 800)); // delay kecil
    }

    // Gabungkan semua XML
    const merged = mergeEPG(results);
    let output = merged;

    // Compress jika ?gzip=1
    if (gzipOut) {
      zlib.gzip(output, (err, gzipped) => {
        if (err) {
          console.error("❌ Gzip error:", err);
          return res.status(500).send("Compression failed");
        }
        res.setHeader("Content-Type", "application/gzip");
        res.setHeader("Content-Encoding", "gzip");
        res.setHeader("Cache-Control", `max-age=${ttl}`);
        res.send(gzipped);
      });
    } else {
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Cache-Control", `max-age=${ttl}`);
      res.send(output);
    }
  } catch (err) {
    console.error("🔥 EPG merge failed:", err);
    res.status(500).send("EPG worker failed");
  }
});

// 🚀 Start server
app.listen(PORT, () => {
  console.log(`✅ EPG Worker running on port ${PORT}`);
});

// 🧩 Function untuk fetch & auto-decompress
async function fetchEPG(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const ce = res.headers.get("content-encoding") || "";
    const ct = res.headers.get("content-type") || "";

    // Detect gzip secara selamat (tanpa salah detect)
    const isGz =
      /gzip/i.test(ce) ||
      /application\/gzip|application\/x-gzip/.test(ct) ||
      /\.gz($|\?)/i.test(url);

    const buffer = await res.arrayBuffer();
    const data = Buffer.from(buffer);

    if (isGz) {
      try {
        return zlib.gunzipSync(data).toString("utf-8");
      } catch {
        console.warn(`⚠️ Skip corrupt gzip: ${url}`);
        return null;
      }
    } else {
      return data.toString("utf-8");
    }
  } catch (err) {
    console.warn(`❌ Fetch fail ${url}: ${err.message}`);
    return null;
  }
}

// 🧠 Function untuk merge XML
function mergeEPG(list) {
  const channelMap = new Map();
  const programmeMap = new Map();

  for (const text of list) {
    if (!text) continue;

    // Channel
    for (const m of text.matchAll(/<channel\b[^>]*>[\s\S]*?<\/channel>/gi)) {
      const chunk = m[0];
      const idMatch = chunk.match(/<channel[^>]*\bid=["']([^"']+)["']/i);
      if (!idMatch) continue;
      const id = idMatch[1].trim();
      if (!channelMap.has(id)) channelMap.set(id, chunk);
    }

    // Programme
    for (const m of text.matchAll(/<programme\b[^>]*>[\s\S]*?<\/programme>/gi)) {
      const chunk = m[0];
      const ch = (chunk.match(/channel=["']([^"']+)["']/i) || [])[1];
      const start = (chunk.match(/start=["']([^"']+)["']/i) || [])[1];
      if (!ch || !start) continue;
      const key = `${ch}||${start}`;
      if (!programmeMap.has(key)) programmeMap.set(key, chunk);
    }
  }

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n';
  for (const ch of channelMap.values()) xml += ch + "\n";
  for (const p of programmeMap.values()) xml += p + "\n";
  xml += "</tv>";
  return xml;
}
