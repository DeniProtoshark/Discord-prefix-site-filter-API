import express from "express";
import fetch from "node-fetch";
import "dotenv/config";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const GUILD_ID = process.env.GUILD_ID;
const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;

// ===== КЭШ =====
const CACHE_TTL_MS = 60_000; // 60 сек
let cachedEvents = null;
let cachedAt = 0;

// ===== ПРОСТЫЕ СТАТЫ (движок интереса) =====
const interests = {}; // { [eventId]: { going: number, interested: number } }

function getStats(id) {
  if (!interests[id]) {
    interests[id] = { going: 0, interested: 0 };
  }
  return interests[id];
}

// ---------- Тип события по хэштегам ----------
function detectType(name, description) {
  const text = `${name}\n${description || ""}`.toUpperCase();

  if (text.includes("#IRL")) return "irl";
  if (text.includes("#VR") || text.includes("#VIRTUAL")) return "virtual";
  if (text.includes("#RADIO")) return "radio";

  return "other";
}

// ---------- Лейблы для ссылок ----------
function labelForUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();

    if (host.includes("youtube.com") || host.includes("youtu.be")) return "YouTube";
    if (host.includes("twitch.tv")) return "Twitch";
    if (host.includes("spotify.com")) return "Spotify";
    if (host.includes("soundcloud.com")) return "SoundCloud";
    if (host.includes("mixcloud.com")) return "Mixcloud";
    if (host.includes("bandcamp.com")) return "Bandcamp";
    if (host.includes("tiktok.com")) return "TikTok";
    if (host.includes("facebook.com")) return "Facebook";
    if (host.includes("instagram.com")) return "Instagram";

    // твои радио-домены
    if (
      host.includes("hpsbassline.myftp.biz") ||
      host.includes("azura.hpsbassline.myftp.biz") ||
      host.includes("radio")
    ) {
      return "Radio";
    }

    return host.replace(/^www\./, "");
  } catch {
    return "Link";
  }
}

// ---------- Вытаскиваем ссылки и хэштеги ----------
function extractLinksTags(description) {
  if (!description) return { links: [], tags: [] };

  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const links = [];
  const matches = description.match(urlRegex) || [];

  for (const m of matches) {
    links.push({ url: m, label: labelForUrl(m) });
  }

  const tagMatches = [...description.matchAll(/#(\w+)/g)];
  const tags = tagMatches
    .map((m) => m[1].toUpperCase())
    .filter((t) => !["IRL", "VR", "VIRTUAL", "RADIO"].includes(t));

  return { links, tags };
}

// ---------- Статус события ----------
function getStatus(startIso, endIso) {
  if (!startIso) {
    return { code: "upcoming", label: "Upcoming" };
  }

  const now = Date.now();
  const startMs = new Date(startIso).getTime();
  const endMs = endIso ? new Date(endIso).getTime() : startMs + 3 * 3600_000;

  if (Number.isNaN(startMs)) {
    return { code: "upcoming", label: "Upcoming" };
  }

  if (now < startMs) {
    return { code: "upcoming", label: "Upcoming" };
  }

  if (now >= startMs && now <= endMs) {
    return { code: "live", label: "Live" };
  }

  return { code: "past", label: "Past" };
}

// ---------- Общая нормализация ивента ----------
function normalizeEvent(e) {
  const type = detectType(e.name, e.description);
  const stats = getStats(e.id);
  const { links, tags } = extractLinksTags(e.description || "");
  const status = getStatus(e.scheduled_start_time, e.scheduled_end_time);

  const startMs = e.scheduled_start_time
    ? new Date(e.scheduled_start_time).getTime()
    : null;
  const endMs = e.scheduled_end_time
    ? new Date(e.scheduled_end_time).getTime()
    : null;

  const durationMinutes =
    startMs && endMs ? Math.round((endMs - startMs) / 60000) : null;

  let imageUrl = null;
  if (e.image) {
    if (typeof e.image === "string" && e.image.startsWith("http")) {
      imageUrl = e.image;
    } else {
      imageUrl = `https://cdn.discordapp.com/guild-events/${e.id}/${e.image}.webp?size=1024`;
    }
  }

  return {
    id: e.id,
    name: e.name,
    description: e.description,
    image: imageUrl,
    start: e.scheduled_start_time,
    end: e.scheduled_end_time,
    startUnix: startMs,
    endUnix: endMs,
    durationMinutes,
    type,
    location: e.entity_metadata?.location || null,
    link: "#",
    links,
    tags,
    status,
    stats,
  };
}

// ---------- МОК для локальных тестов (если нет токена/ID) ----------
function getMockEvents() {
  const now = Date.now();

  const mock = [
    {
      id: "1",
      name: "Street Session: Downtown Vibes #IRL #DNB",
      description:
        "Open DJ set in the city center.\n#IRL #DNB\nhttps://hpsbassline.myftp.biz/",
      scheduled_start_time: new Date(now + 30 * 60_000).toISOString(),
      scheduled_end_time: new Date(now + 2 * 3600_000).toISOString(),
      entity_metadata: { location: "Haapsalu" },
      image:
        "https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg",
    },
    {
      id: "2",
      name: "VR Club Showcase #VR #HARDCORE",
      description:
        "Immersive VR experience.\n#VR #HARDCORE\nhttps://twitch.tv/hps_bassline",
      scheduled_start_time: new Date(now + 3 * 3600_000).toISOString(),
      scheduled_end_time: null,
      entity_metadata: { location: "VRChat" },
      image:
        "https://images.pexels.com/photos/3404200/pexels-photo-3404200.jpeg",
    },
  ];

  const mapped = mock.map(normalizeEvent);

  mapped.sort((a, b) => {
    if (a.startUnix == null && b.startUnix == null) return 0;
    if (a.startUnix == null) return 1;
    if (b.startUnix == null) return -1;
    return a.startUnix - b.startUnix;
  });

  return mapped;
}

// ---------- Получить ивенты из Discord + кэш ----------
async function fetchDiscordEvents({ ignoreCache = false } = {}) {
  if (!GUILD_ID || !DISCORD_TOKEN) {
    console.warn("No GUILD_ID or DISCORD_BOT_TOKEN — using mock data");
    return getMockEvents();
  }

  const now = Date.now();

  if (!ignoreCache && cachedEvents && now - cachedAt < CACHE_TTL_MS) {
    return cachedEvents;
  }

  const res = await fetch(
    `https://discord.com/api/v10/guilds/${GUILD_ID}/scheduled-events`,
    {
      headers: { Authorization: `Bot ${DISCORD_TOKEN}` },
    }
  );

  if (res.status === 429) {
    const data = await res.json().catch(() => ({}));
    console.warn("Discord API rate limited:", data);

    if (cachedEvents) {
      console.log("Returning cached events from cache");
      return cachedEvents;
    }

    throw new Error("Rate limited by Discord and no cache available");
  }

  if (!res.ok) {
    console.error("Discord API error:", await res.text());
    throw new Error("Failed to fetch events from Discord");
  }

  const events = await res.json();
  const mapped = events.map(normalizeEvent);

  mapped.sort((a, b) => {
    if (a.startUnix == null && b.startUnix == null) return 0;
    if (a.startUnix == null) return 1;
    if (b.startUnix == null) return -1;
    return a.startUnix - b.startUnix;
  });

  cachedEvents = mapped;
  cachedAt = Date.now();
  return mapped;
}

// ---------- API: список ивентов с фильтрами ----------
app.get("/api/events", async (req, res) => {
  const filterType = (req.query.type || "").toLowerCase(); // irl / virtual / radio / other
  const filterStatus = (req.query.status || "").toLowerCase(); // live / upcoming / past
  const ignoreCache = req.query.force === "1";
  const sort = (req.query.sort || "start_asc").toLowerCase(); // start_asc | start_desc
  const limit = parseInt(req.query.limit, 10);

  try {
    let events = await fetchDiscordEvents({ ignoreCache });

    // фильтр по типу (#IRL / #VR / #RADIO / other)
    if (filterType) {
      events = events.filter((e) => e.type === filterType);
    }

    // фильтр по статусу
    if (filterStatus === "live") {
      events = events.filter((e) => e.status.code === "live");
    } else if (filterStatus === "upcoming") {
      events = events.filter((e) => e.status.code === "upcoming");
    } else if (filterStatus === "past") {
      events = events.filter((e) => e.status.code === "past");
    } else {
      // по умолчанию: убираем прошедшие
      events = events.filter((e) => e.status.code !== "past");
    }

    // сортировка
    if (sort === "start_desc") {
      events = [...events].sort((a, b) => (b.startUnix || 0) - (a.startUnix || 0));
    } else {
      events = [...events].sort((a, b) => (a.startUnix || 0) - (b.startUnix || 0));
    }

    // лимит
    if (!Number.isNaN(limit) && limit > 0) {
      events = events.slice(0, limit);
    }

    res.json(events);
  } catch (err) {
    console.error(err);

    if (cachedEvents) {
      console.log("Returning cached events due to error (with filters)");

      let events = cachedEvents;

      if (filterType) {
        events = events.filter((e) => e.type === filterType);
      }

      if (filterStatus === "live") {
        events = events.filter((e) => e.status.code === "live");
      } else if (filterStatus === "upcoming") {
        events = events.filter((e) => e.status.code === "upcoming");
      } else if (filterStatus === "past") {
        events = events.filter((e) => e.status.code === "past");
      } else {
        events = events.filter((e) => e.status.code !== "past");
      }

      if (sort === "start_desc") {
        events = [...events].sort(
          (a, b) => (b.startUnix || 0) - (a.startUnix || 0)
        );
      } else {
        events = [...events].sort(
          (a, b) => (a.startUnix || 0) - (b.startUnix || 0)
        );
      }

      if (!Number.isNaN(limit) && limit > 0) {
        events = events.slice(0, limit);
      }

      return res.json(events);
    }

    res.status(500).json({ error: "Failed to load events" });
  }
});

// ---------- API: только live-ивенты ----------
app.get("/api/events/live", async (req, res) => {
  try {
    const events = await fetchDiscordEvents({ ignoreCache: false });
    const live = events.filter((e) => e.status.code === "live");
    res.json(live);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load live events" });
  }
});

// ---------- API: один ивент по ID ----------
app.get("/api/events/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const events = await fetchDiscordEvents({ ignoreCache: false });
    const ev = events.find((e) => e.id === id);

    if (!ev) {
      return res.status(404).json({ error: "Event not found" });
    }

    res.json(ev);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load event" });
  }
});

// ---------- API: интерес / going ----------
app.post("/api/events/:id/interest", (req, res) => {
  const id = req.params.id;
  const { action } = req.body || {};

  if (action !== "going" && action !== "interested") {
    return res.status(400).json({ error: "Invalid action" });
  }

  const stats = getStats(id);
  stats[action] += 1;

  return res.json(stats);
});

// ---------- Статика ----------
app.use(express.static("public"));

app.listen(PORT, () => {
  console.log(`Events API running at http://localhost:${PORT}`);
});
