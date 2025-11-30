const eventsContainer = document.getElementById("events-container");
const typeFilter = document.getElementById("type-filter");
const statusFilter = document.getElementById("status-filter");
const timezoneInfo = document.getElementById("timezone-info");

// Список таймеров для обновления
let countdownEntries = [];
let countdownTimerId = null;

// ----- Инициализация -----
initTimezoneInfo();
setupFilters();
loadEvents();

// ----- Функции -----

function initTimezoneInfo() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "локальный часовой пояс";
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absMin = Math.abs(offsetMinutes);
  const hours = Math.floor(absMin / 60)
    .toString()
    .padStart(2, "0");
  const mins = (absMin % 60).toString().padStart(2, "0");
  const offsetStr = `UTC${sign}${hours}:${mins}`;

  timezoneInfo.textContent = `Ваш часовой пояс: ${tz} (${offsetStr}). Время событий отображается в нём.`;
}

function setupFilters() {
  typeFilter.addEventListener("change", () => loadEvents());
  statusFilter.addEventListener("change", () => loadEvents());
}

async function loadEvents() {
  eventsContainer.innerHTML = `<div class="loading">Загрузка событий…</div>`;

  // Сбрасываем старые таймеры
  countdownEntries = [];
  if (countdownTimerId !== null) {
    clearInterval(countdownTimerId);
    countdownTimerId = null;
  }

  const params = new URLSearchParams();
  const type = typeFilter.value;
  const status = statusFilter.value;

  if (type) params.set("type", type);
  if (status) params.set("status", status);

  // всегда хотим будущие/лайв сначала
  params.set("sort", "start_asc");

  const url = `/api/events?${params.toString()}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      eventsContainer.innerHTML =
        '<div class="loading">Нет событий по выбранным фильтрам.</div>';
      return;
    }

    eventsContainer.innerHTML = "";
    data.forEach((ev) => renderEvent(ev));

    // стартуем обновление таймеров
    countdownTimerId = setInterval(updateAllCountdowns, 1000);
    updateAllCountdowns();
  } catch (err) {
    console.error(err);
    eventsContainer.innerHTML =
      '<div class="error">Не удалось загрузить события. Попробуйте обновить страницу позже.</div>';
  }
}

function renderEvent(ev) {
  const card = document.createElement("article");
  card.className = "event-card";

  // картинка
  if (ev.image) {
    const img = document.createElement("img");
    img.className = "event-image";
    img.src = ev.image;
    img.alt = ev.name;
    card.appendChild(img);
  }

  const content = document.createElement("div");
  content.className = "event-content";

  const title = document.createElement("h2");
  title.className = "event-title";
  title.textContent = ev.name;
  content.appendChild(title);

  // мета: тип, статус, локация
  const meta = document.createElement("div");
  meta.className = "event-meta";

  const typePill = document.createElement("span");
  typePill.className = "event-type-pill " + typeClass(ev.type);
  typePill.textContent = typeLabel(ev.type);
  meta.appendChild(typePill);

  const statusSpan = document.createElement("span");
  statusSpan.className = "event-status " + statusClass(ev.status?.code);
  statusSpan.textContent = statusLabel(ev.status?.code);
  meta.appendChild(statusSpan);

  if (ev.location) {
    const locSpan = document.createElement("span");
    locSpan.textContent = `• ${ev.location}`;
    meta.appendChild(locSpan);
  }

  content.appendChild(meta);

  // время
  const dateBlock = document.createElement("div");
  dateBlock.className = "event-datetime";

  const startDate = ev.start ? new Date(ev.start) : null;
  const endDate = ev.end ? new Date(ev.end) : null;

  if (startDate) {
    const startText = startDate.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });

    let line = `Начало: ${startText}`;

    if (endDate) {
      const endText = endDate.toLocaleTimeString(undefined, {
        timeStyle: "short",
      });
      line += ` — окончание: ${endText}`;
    }

    dateBlock.textContent = line;
  } else {
    dateBlock.textContent = "Время будет объявлено позже";
  }

  content.appendChild(dateBlock);

  // динамический таймер
  const countdown = document.createElement("div");
  countdown.className =
    "event-countdown " + countdownClass(ev.status?.code);
  countdown.textContent = "";
  content.appendChild(countdown);

  if (startDate) {
    countdownEntries.push({
      el: countdown,
      start: startDate.getTime(),
      end: endDate ? endDate.getTime() : null,
      statusCode: ev.status?.code || "upcoming",
    });
  }

  // описание
  if (ev.description) {
    const desc = document.createElement("p");
    desc.className = "event-description";
    desc.textContent = ev.description.replace(/\s+/g, " ").trim();
    content.appendChild(desc);
  }

  // ссылки
  if (Array.isArray(ev.links) && ev.links.length > 0) {
    const linksBox = document.createElement("div");
    linksBox.className = "event-links";

    ev.links.forEach((lnk) => {
      const a = document.createElement("a");
      a.className = "event-link";
      a.href = lnk.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = lnk.label || "Link";
      linksBox.appendChild(a);
    });

    content.appendChild(linksBox);
  }

  card.appendChild(content);

  // футер: статы + кнопки
  const footer = document.createElement("div");
  footer.className = "event-footer";

  const statsBox = document.createElement("div");
  statsBox.className = "event-stats";

  const goingStat = document.createElement("div");
  goingStat.className = "event-stat";
  goingStat.innerHTML = `👤 <span>${ev.stats?.going || 0}</span>`;
  statsBox.appendChild(goingStat);

  const interestedStat = document.createElement("div");
  interestedStat.className = "event-stat";
  interestedStat.innerHTML = `⭐ <span>${ev.stats?.interested || 0}</span>`;
  statsBox.appendChild(interestedStat);

  footer.appendChild(statsBox);

  const actions = document.createElement("div");
  actions.className = "event-actions";

  const btnGoing = document.createElement("button");
  btnGoing.className = "btn";
  btnGoing.textContent = "Я пойду";
  btnGoing.addEventListener("click", () =>
    sendInterest(ev.id, "going", goingStat)
  );

  const btnInterested = document.createElement("button");
  btnInterested.className = "btn btn-ghost";
  btnInterested.textContent = "Интересно";
  btnInterested.addEventListener("click", () =>
    sendInterest(ev.id, "interested", interestedStat)
  );

  actions.appendChild(btnGoing);
  actions.appendChild(btnInterested);

  footer.appendChild(actions);
  card.appendChild(footer);

  eventsContainer.appendChild(card);
}

function typeClass(type) {
  switch (type) {
    case "irl":
      return "event-type-irl";
    case "virtual":
      return "event-type-virtual";
    case "radio":
      return "event-type-radio";
    default:
      return "event-type-other";
  }
}

function typeLabel(type) {
  switch (type) {
    case "irl":
      return "IRL";
    case "virtual":
      return "VR";
    case "radio":
      return "Radio";
    default:
      return "Другое";
  }
}

function statusClass(code) {
  switch (code) {
    case "live":
      return "event-status-live";
    case "upcoming":
      return "event-status-upcoming";
    case "past":
      return "event-status-past";
    default:
      return "";
  }
}

function statusLabel(code) {
  switch (code) {
    case "live":
      return "Live";
    case "upcoming":
      return "Upcoming";
    case "past":
      return "Past";
    default:
      return "Unknown";
  }
}

// ----- Динамический таймер -----

function updateAllCountdowns() {
  const now = Date.now();
  countdownEntries.forEach((entry) => {
    updateCountdown(entry, now);
  });
}

function updateCountdown(entry, now) {
  const { el, start, end } = entry;

  if (!el) return;

  if (now < start) {
    // ещё не началось
    const diff = start - now;
    el.className = "event-countdown event-countdown-upcoming";
    el.textContent = "Начнётся через: " + formatDiff(diff);
  } else if (end && now >= start && now <= end) {
    // идёт сейчас, до конца
    const diff = end - now;
    el.className = "event-countdown event-countdown-live";
    el.textContent = "Идёт сейчас · осталось: " + formatDiff(diff);
  } else if (!end && now >= start && now - start < 6 * 3600_000) {
    // идёт сейчас, конец неизвестен (6 часов условный лимит)
    el.className = "event-countdown event-countdown-live";
    el.textContent = "Идёт сейчас";
  } else if (now >= start) {
    // уже прошло
    const diff = now - start;
    el.className = "event-countdown event-countdown-past";
    el.textContent = "Прошло с начала: " + formatDiff(diff);
  }
}

function formatDiff(ms) {
  if (ms <= 0) return "< 1 сек";

  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const parts = [];
  if (days > 0) parts.push(days + " д");
  if (hours > 0) parts.push(hours + " ч");
  if (minutes > 0) parts.push(minutes + " мин");
  if (seconds > 0 && days === 0) parts.push(seconds + " с");

  return parts.join(" ") || "< 1 сек";
}

// ----- Голосование (interest / going) -----

async function sendInterest(eventId, action, statNode) {
  try {
    const res = await fetch(`/api/events/${eventId}/interest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json(); // { going, interested }

    const span = statNode.querySelector("span");
    if (span) {
      span.textContent =
        action === "going" ? data.going ?? 0 : data.interested ?? 0;
    }
  } catch (err) {
    console.error(err);
  }
}
