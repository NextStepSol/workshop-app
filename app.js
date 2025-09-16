// --- Storage / Keys ---
const LS_SLOTS = "seeyou_slots_v1";
const LS_BOOKINGS = "seeyou_bookings_v1";
const LS_ARCH_COLLAPSED = "seeyou_arch_collapsed_v1";
const LS_ACTIVE_COLLAPSED = "seeyou_active_collapsed_v1";
const LS_LAST_BACKUP = "seeyou_last_backup_v1";
const LS_COLLAPSED_SLOTS = "seeyou_collapsed_slots_v1";
const LS_WHATSAPP_TEMPLATE = "seeyou_whatsapp_template_v1";

const DEFAULT_WHATSAPP_TEMPLATE = `[Anrede] [Name],

hiermit bestätige ich [Du_Dat] die Teilnahme am [Datum]
für [Anzahl] Person(en).

Ich freue mich auf [Du_Akk] und wünsche [Du_Dat] bis dahin alles Gute.

Ganz liebe Grüße
Stefanie`;

// --- Globale Selektoren ---
const $ = s => document.querySelector(s);
const listEl = $("#list");
const modalBooking = $("#modalBooking");
const modalSlots = $("#modalSlots");
const modalConfirmDelete = $("#modalConfirmDelete");
const modalSettings = $("#modalSettings");
const modalReminder = $("#modalReminder");

// --- Globale Zustandsvariablen ---
let ctx = { currentSlotId: null, currentBookingId: null };
let pendingDeleteSlotId = null;

// --- Hilfsfunktionen ---
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const fmt = iso => new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
const toLocal = d => { const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const todayKey = () => new Date().toISOString().slice(0, 10);
const load = (k, def = []) => JSON.parse(localStorage.getItem(k) || JSON.stringify(def));
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
function normalizePhoneDE(raw) {
    let d = (raw || "").replace(/\D+/g, "");
    if (d.startsWith("00")) d = d.slice(2);
    if (d.startsWith("0")) d = "49" + d.slice(1);
    return d;
}

// --- Initialisierung ---
function createInitialData() {
    if (!localStorage.getItem(LS_SLOTS)) {
        const now = new Date();
        const s1 = new Date(now.getTime() + 24 * 3600 * 1000); s1.setHours(17, 0, 0, 0);
        const e1 = new Date(s1.getTime() + 2 * 3600 * 1000);
        save(LS_SLOTS, [{ id: uid(), title: "Schmuck-Workshop", starts_at: s1.toISOString(), ends_at: e1.toISOString(), capacity: 10, archived: false }]);
    }
    if (!localStorage.getItem(LS_BOOKINGS)) {
        save(LS_BOOKINGS, []);
    }
}

// --- Berechnungen & Status ---
const bookingsBySlot = id => load(LS_BOOKINGS).filter(b => b.slotId === id);
const sumBooked = id => bookingsBySlot(id).reduce((n, b) => n + Number(b.count || 0), 0);

function slotStatus(slot) {
    if (slot.archived) return "archived";
    if (new Date(slot.ends_at) < new Date()) return "past";
    const left = slot.capacity - sumBooked(slot.id);
    if (left <= 0) return "full";
    return "open";
}

function statusBadge(status, left) {
    const badges = {
        archived: `<span class="px-2 py-1 rounded-lg bg-slate-300 text-xs">archiv</span>`,
        past: `<span class="px-2 py-1 rounded-lg bg-gray-300 text-xs">vergangen</span>`,
        full: `<span class="px-2 py-1 rounded-lg bg-rose-200 text-xs">voll</span>`,
        open: `<span class="px-2 py-1 rounded-lg ${left <= 2 ? "bg-amber-200" : "bg-emerald-200"} text-xs">${left} frei</span>`
    };
    return badges[status] || '';
}

// --- Render-Funktionen ---
function render() {
    let slots = load(LS_SLOTS);
    let changed = false;
    const now = new Date();
    slots.forEach(slot => {
        if (!slot.archived && new Date(slot.ends_at) < now) {
            slot.archived = true;
            changed = true;
        }
    });
    if (changed) save(LS_SLOTS, slots);

    const q = ($("#search")?.value || "").toLowerCase().trim();
    const filter = $("#filterStatus")?.value || "";
    const allBookings = load(LS_BOOKINGS);

    const searchFilter = s => {
        if (!q) return true;
        if ([s.title, fmt(s.starts_at)].join(" ").toLowerCase().includes(q)) return true;
        return allBookings.filter(b => b.slotId === s.id)
            .some(b => [b.name, b.phone, b.notes].join(" ").toLowerCase().includes(q));
    };
    const statusFilter = s => !filter || slotStatus(s) === filter;

    const all = slots.filter(searchFilter).filter(statusFilter);
    const active = all.filter(s => !s.archived).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    const archived = all.filter(s => s.archived).sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));

    const collapsedSlots = load(LS_COLLAPSED_SLOTS, []);
    listEl.innerHTML = `
        ${renderSection("activeSection", "Aktuell", active, load(LS_ACTIVE_COLLAPSED, false))}
        ${archived.length ? renderSection("archSection", "Archiv", archived, load(LS_ARCH_COLLAPSED, true)) : ""}
    `;
    maybeShowBackupReminder();
}

function renderSection(id, title, slots, isSectionCollapsed) {
    return `
    <details id="${id}" class="mb-6" ${isSectionCollapsed ? "" : "open"}>
        <summary class="list-none cursor-pointer select-none rounded-xl px-3 py-2 bg-slate-200/70 hover:bg-slate-300/70 flex items-center justify-between shadow-sm">
            <span class="font-medium">${title} (${slots.length})</span>
            <span class="text-slate-500 text-sm">${isSectionCollapsed ? "ausklappen" : "einklappen"}</span>
        </summary>
        <div class="mt-3 space-y-3">
            ${slots.length ? slots.map(renderCard).join("") : `<div class="text-slate-600 bg-white/80 p-4 rounded-2xl">Keine Termine in dieser Ansicht.</div>`}
        </div>
    </details>`;
}

function renderCard(s) {
    const collapsedSlots = load(LS_COLLAPSED_SLOTS, []);
    const isCollapsed = collapsedSlots.includes(s.id);
    const booked = sumBooked(s.id);
    const left = Math.max(0, s.capacity - booked);
    const status = slotStatus(s);
    const bar = Math.min(100, Math.round(100 * booked / Math.max(1, s.capacity)));
    const barColor = { archived: "bg-slate-300", past: "bg-gray-300", full: "bg-rose-400", open: left <= 2 ? "bg-amber-400" : "bg-emerald-500" }[status];
    const actions = `
        ${!s.archived ? `<button type="button" class="px-3 py-2 rounded-xl text-sm" style="background:#AF9778;color:white" onclick="openBooking('${s.id}')">Buchung</button>` : ''}
        <button type="button" class="px-3 py-2 rounded-xl bg-gray-100 text-sm" onclick="editSlot('${s.id}')">Bearbeiten</button>
        <button type="button" class="px-3 py-2 rounded-xl ${s.archived ? 'bg-emerald-100' : 'bg-slate-100'} text-sm" onclick="toggleArchive('${s.id}', ${!s.archived})">${s.archived ? 'Reaktivieren' : 'Archivieren'}</button>
        <button type="button" class="px-3 py-2 rounded-xl bg-gray-100 text-sm" onclick='downloadICS(${JSON.stringify(s)})'>Kalender (.ics)</button>
        <button type="button" class="px-3 py-2 rounded-xl bg-rose-100 text-sm" onclick="openConfirmDelete('${s.id}')">Löschen</button>`;

    return `
    <details class="rounded-2xl bg-white/85 backdrop-blur border shadow-sm block" data-slot-id="${s.id}" ${isCollapsed ? '' : 'open'}>
        <summary class="list-none cursor-pointer p-4 flex items-start justify-between gap-3">
            <div class="min-w-0">
                <div class="text-sm text-slate-500">${statusBadge(status, left)}</div>
                <div class="font-semibold text-[20px] sm:text-base leading-snug" style="color:#AF9778">${s.title}</div>
                <div class="text-sm">${fmt(s.starts_at)} – ${fmt(s.ends_at)}</div>
            </div>
            <div class="text-2xl text-slate-400 transition-transform duration-200 details-arrow">›</div>
        </summary>
        <div class="px-4 pb-4">
            <div class="text-sm">Kapazität: ${s.capacity} · Gebucht: ${booked} · Frei: ${left}</div>
            <div class="h-2 mt-2 bg-gray-100 rounded-full overflow-hidden"><div class="h-2 ${barColor}" style="width:${bar}%"></div></div>
            ${renderBookingsMini(s.id)}
            <div class="mt-4 flex flex-wrap gap-2">${actions}</div>
        </div>
    </details>`;
}

function renderBookingsMini(slotId) {
    const list = bookingsBySlot(slotId);
    if (!list.length) return `<div class="text-xs text-slate-500 mt-2">Noch keine Buchungen.</div>`;
    return `<div class="mt-2 text-sm"><div class="font-medium mb-1">Buchungen:</div><ul class="space-y-1">${list.map(b => `<li class="flex items-center justify-between bg-gray-50 border rounded-lg px-2 py-1 cursor-pointer hover:bg-gray-100" onclick="editBooking('${b.id}')"><span>${b.name} (${b.count}) · ${b.phone}${b.notes ? ` · ${b.notes}` : ''}</span><span class="text-xs text-slate-400">›</span></li>`).join("")}</ul></div>`;
}

// --- Modals & Hauptaktionen ---
const allModals = document.querySelectorAll(".modal");
function openModal(target) { allModals.forEach(m => m.classList.add("hidden")); target.classList.remove("hidden"); target.classList.add("flex"); }
function closeModal(target) { target.classList.add("hidden"); target.classList.remove("flex"); }
function openConfirmDelete(slotId) { pendingDeleteSlotId = slotId; openModal(modalConfirmDelete); }
function toggleArchive(id, flag) { const slots = load(LS_SLOTS); const s = slots.find(x => x.id === id); if (s) { s.archived = !!flag; save(LS_SLOTS, slots); render(); } }

function openNewSlot() {
    $("#formSlot").reset();
    const now = new Date(); now.setMinutes(0, 0, 0);
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17);
    const e = new Date(s.getTime() + 2 * 3600 * 1000);
    $("#sl_capacity").value = 10;
    $("#sl_starts").value = toLocal(s);
    $("#sl_ends").value = toLocal(e);
    $("#row_title_other").style.display = "none";
    $("#formSlot").onsubmit = (e) => handleSlotFormSubmit(e, null);
    openModal(modalSlots);
}

window.editSlot = (id) => {
    const slots = load(LS_SLOTS); const s = slots.find(x => x.id === id); if (!s) return;
    $("#formSlot").reset();
    const CATS = ["Schmuck-Workshop", "Kindergeburtstag", "JGA", "Mädelsabend", "Weihnachtsfeier", "Sonstiges"];
    if (CATS.includes(s.title)) { $("#sl_category").value = s.title; $("#row_title_other").style.display = "none"; }
    else { $("#sl_category").value = "Sonstiges"; $("#row_title_other").style.display = "block"; $("#sl_title_other").value = s.title; }
    $("#sl_capacity").value = s.capacity;
    $("#sl_starts").value = toLocal(new Date(s.starts_at));
    $("#sl_ends").value = toLocal(new Date(s.ends_at));
    $("#formSlot").onsubmit = (e) => handleSlotFormSubmit(e, id);
    openModal(modalSlots);
};

window.openBooking = (slotId) => {
    ctx = { currentSlotId: slotId, currentBookingId: null };
    $("#formBooking").reset();
    $("#bk_count").value = 1;
    $("#modalBookingTitle").textContent = "Buchung hinzufügen";
    $("#btnDeleteBooking").classList.add("hidden");
    $("#btnWhatsappShare").classList.add("hidden");
    openModal(modalBooking);
};

window.editBooking = (id) => {
    const b = load(LS_BOOKINGS).find(x => x.id === id); if (!b) return;
    ctx = { currentSlotId: b.slotId, currentBookingId: b.id };
    $("#formBooking").reset();
    $("#bk_name").value = b.name;
    $("#bk_phone").value = b.phone;
    $("#bk_notes").value = b.notes || "";
    $("#bk_count").value = b.count;
    $("#bk_channel").value = b.channel || "";
    $("#bk_salutation").value = b.salutation || "Liebe/r";
    $("#modalBookingTitle").textContent = "Buchung bearbeiten";
    $("#btnDeleteBooking").classList.remove("hidden");
    $("#btnWhatsappShare").classList.remove("hidden");
    openModal(modalBooking);
};

function openSettings() {
    $("#settings_whatsapp").value = load(LS_WHATSAPP_TEMPLATE, DEFAULT_WHATSAPP_TEMPLATE);
    openModal(modalSettings);
}

function showToast(msg, type = "info") {
    const toast = $("#toast"), toastMsg = $("#toastMsg");
    toastMsg.textContent = msg;
    const color = type === 'success' ? 'bg-emerald-100 border-emerald-300' : 'bg-white/90 border-gray-200';
    toast.className = `fixed bottom-4 left-1/2 -translate-x-1/2 backdrop-blur border shadow-xl rounded-xl px-4 py-3 ${color}`;
    setTimeout(() => toast.classList.add('hidden'), 4000);
}

// --- Formular-Handler ---
function handleSlotFormSubmit(event, slotId) {
    event.preventDefault();
    const slots = load(LS_SLOTS);
    const slot = slotId ? slots.find(s => s.id === slotId) : { id: uid(), archived: false };
    
    slot.title = ($("#sl_category").value === "Sonstiges") ? ($("#sl_title_other").value.trim() || "Workshop") : $("#sl_category").value;
    slot.capacity = Number($("#sl_capacity").value || 0);
    slot.starts_at = new Date($("#sl_starts").value).toISOString();
    slot.ends_at = new Date($("#sl_ends").value).toISOString();

    if (!slotId) slots.push(slot);
    save(LS_SLOTS, slots);
    closeModal(modalSlots);
    render();
}

function handleBookingFormSubmit(event) {
    event.preventDefault();
    const { currentSlotId, currentBookingId } = ctx;
    const slot = load(LS_SLOTS).find(s => s.id === currentSlotId);
    if (!slot) return closeModal(modalBooking);

    const all = load(LS_BOOKINGS);
    const old = currentBookingId ? all.find(x => x.id === currentBookingId) : null;
    
    const booking = {
        id: old?.id || uid(),
        slotId: slot.id,
        salutation: $("#bk_salutation")?.value || "Liebe/r",
        name: $("#bk_name").value.trim(),
        phone: $("#bk_phone").value.trim(),
        notes: $("#bk_notes").value.trim(),
        count: Number($("#bk_count").value || 0),
        channel: $("#bk_channel").value,
        created_at: old?.created_at || new Date().toISOString()
    };
    
    if (!booking.name || !booking.phone || !booking.count) return alert("Bitte Name, Telefon und Personenanzahl angeben.");
    if (booking.count > slot.capacity - (sumBooked(slot.id) - (old?.count || 0))) return alert("Nicht genügend Plätze frei.");

    if (old) { all[all.findIndex(x => x.id === old.id)] = booking; } else { all.push(booking); }
    save(LS_BOOKINGS, all);
    
    showToast("Buchung gespeichert.", "success");
    closeModal(modalBooking);
    render();
}

function handleSettingsFormSubmit(event) {
    event.preventDefault();
    save(LS_WHATSAPP_TEMPLATE, $("#settings_whatsapp").value);
    closeModal(modalSettings);
    showToast("Einstellungen gespeichert.", "success");
}

// --- Backup & Export ---
function exportCsv() { /* Code für CSV Export */ }
function exportBackup() { /* Code für Backup Export */ }
async function handleRestoreFile(file) {
    if (!file || !confirm("Achtung: Wiederherstellen überschreibt alle Daten. Fortfahren?")) return;
    try {
        const json = JSON.parse(await file.text());
        if (!json || !Array.isArray(json.slots) || !Array.isArray(json.bookings)) throw new Error("Format ungültig");
        save(LS_SLOTS, json.slots); save(LS_BOOKINGS, json.bookings);
        alert("Backup erfolgreich wiederhergestellt."); render();
    } catch (err) { alert("Wiederherstellung fehlgeschlagen: " + err.message); }
}
function downloadICS(slot) { /* Code für ICS Download */ }
function maybeShowBackupReminder() {
    if (localStorage.getItem(LS_LAST_BACKUP) === todayKey()) return;
    openModal(modalReminder);
}

// --- Event Listener Initialisierung ---
function initializeEventListeners() {
    $("#search")?.addEventListener("input", render);
    $("#filterStatus")?.addEventListener("change", render);

    document.querySelectorAll("[data-close]").forEach(btn => {
        const modalToClose = $(btn.dataset.close);
        if(modalToClose) btn.onclick = () => closeModal(modalToClose);
    });

    $("#btnCancelDelete").onclick = () => closeModal(modalConfirmDelete);
    $("#btnConfirmDelete").onclick = () => {
        if (!pendingDeleteSlotId) return closeModal(modalConfirmDelete);
        save(LS_SLOTS, load(LS_SLOTS).filter(s => s.id !== pendingDeleteSlotId));
        save(LS_BOOKINGS, load(LS_BOOKINGS).filter(b => b.slotId !== pendingDeleteSlotId));
        closeModal(modalConfirmDelete); render();
    };

    $("#sl_starts")?.addEventListener("change", () => {
        const slStarts = $("#sl_starts"), slEnds = $("#sl_ends");
        if (!slStarts.value) return;
        slEnds.min = slStarts.value;
        if (!slEnds.value || slEnds.value < slStarts.value) {
            slEnds.value = toLocal(new Date(new Date(slStarts.value).getTime() + 2 * 3600 * 1000));
        }
    });

    listEl.addEventListener('toggle', (event) => {
        const target = event.target;
        if (target.tagName !== 'DETAILS') return;
        const key = { 'activeSection': LS_ACTIVE_COLLAPSED, 'archSection': LS_ARCH_COLLAPSED }[target.id];
        if (key) {
            save(key, !target.open);
            target.querySelector("summary span.text-slate-500").textContent = !target.open ? "ausklappen" : "einklappen";
        } else if (target.dataset.slotId) {
            let collapsed = load(LS_COLLAPSED_SLOTS, []);
            if (!target.open) { if (!collapsed.includes(target.dataset.slotId)) collapsed.push(target.dataset.slotId); }
            else { collapsed = collapsed.filter(id => id !== target.dataset.slotId); }
            save(LS_COLLAPSED_SLOTS, collapsed);
        }
    }, true);

    const desktopMenuTrigger = $('#desktop-menu-trigger'), desktopMenuPanel = $('#desktop-menu-panel');
    if (desktopMenuTrigger) {
        desktopMenuTrigger.addEventListener('click', e => { e.stopPropagation(); desktopMenuPanel.classList.toggle('hidden'); });
        document.addEventListener('click', () => desktopMenuPanel.classList.add('hidden'));
        desktopMenuPanel.querySelectorAll('a, label').forEach(item => item.addEventListener('click', () => setTimeout(() => desktopMenuPanel.classList.add('hidden'), 100)));
        $('#menu_btnSettings').onclick = e => { e.preventDefault(); openSettings(); };
        $('#menu_btnManageSlots').onclick = e => { e.preventDefault(); openNewSlot(); };
        $('#menu_btnExportCsv').onclick = e => { e.preventDefault(); exportCsv(); };
        $('#menu_btnBackup').onclick = e => { e.preventDefault(); exportBackup(); };
        $('#menu_btnArchiveView').onclick = e => { e.preventDefault(); const el = $('#archSection'); if (el) { el.open = true; el.scrollIntoView({behavior: 'smooth'}); } };
    }

    $('#fileRestore').onchange = e => handleRestoreFile(e.target.files?.[0]);
    $('#m_btnRestore').onclick = () => $('#fileRestore').click();
    
    // Formular-Handler
    $("#formSlot").onsubmit = (e) => handleSlotFormSubmit(e, null); // Wird in openNewSlot/editSlot überschrieben
    $("#formBooking").addEventListener("submit", handleBookingFormSubmit);
    $("#formSettings").addEventListener("submit", handleSettingsFormSubmit);

    // Klick-Handler für Aktionen in Modals
    $('#btnDeleteBooking').onclick = () => {
        if (!confirm("Diese Buchung wirklich löschen?")) return;
        save(LS_BOOKINGS, load(LS_BOOKINGS).filter(x => x.id !== ctx.currentBookingId));
        closeModal(modalBooking); render();
    };
    $('#btnWhatsappShare').onclick = () => { /* WhatsApp Logik hier */ };
    $('#btnRemindLater').onclick = () => closeModal(modalReminder);
    $('#btnBackupNow').onclick = () => { exportBackup(); closeModal(modalReminder); showToast("Backup erfolgreich erstellt.", "success"); };
}

// --- App Start ---
document.addEventListener('DOMContentLoaded', () => {
    createInitialData();
    initializeEventListeners();
    render();
});