// Dou Di Zhu client runtime: WebSocket client that joins a seat, renders hand + center table,
// and emits claim_landlord / decline_landlord / play_cards / pass.

import { canBeat, detectCombination } from "./shared/combinations.js";
import {
	clearOpponent,
	renderHand,
	renderKitty,
	renderLastMove,
	renderNotification,
	renderOpponent,
} from "./shared/tableViewRenderer.js";

const body = document.body;
const notifEl = document.getElementById("notification");
const lastMoveEl = document.getElementById("last-move");
const kittyEl = document.getElementById("kitty");
const phaseEl = document.getElementById("phase-indicator");
const myHandEl = document.getElementById("my-hand");
const meNameEl = document.getElementById("me-name");
const meRoleEl = document.getElementById("me-role");
const meScoreEl = document.getElementById("me-score");
const readyBtn = document.getElementById("ready-button");
const claimBtn = document.getElementById("claim-button");
const declineBtn = document.getElementById("decline-button");
const playBtn = document.getElementById("play-button");
const passBtn = document.getElementById("pass-button");
const connectionStatusEl = document.getElementById("connection-status");
const shareLinkEl = document.getElementById("share-link");
const shareCopyBtn = document.getElementById("share-copy");
const namePromptEl = document.getElementById("name-prompt");
const namePromptInput = document.getElementById("name-prompt-input");
const namePromptSubmit = document.getElementById("name-prompt-submit");
const opponentEls = {
	N: document.querySelector(".opponent-N"),
	W: document.querySelector(".opponent-W"),
	E: document.querySelector(".opponent-E"),
};

const urlParams = new URLSearchParams(globalThis.location.search);
const tableId = urlParams.get("tableId") || "";
const initialSeatIndex = parseOptionalInt(urlParams.get("seatIndex"));
const WS_URL = (() => {
	const p = urlParams.get("wsUrl");
	if (p) return p;
	const proto = location.protocol === "https:" ? "wss" : "ws";
	const port = urlParams.get("wsPort") || "8787";
	return `${proto}://${location.hostname || "localhost"}:${port}`;
})();
const SESSION_STORAGE_KEY = `doudizhu:session:${tableId}`;
const NAME_STORAGE_KEY = "doudizhu:name";

let mySeatIndex = initialSeatIndex;
let sessionToken = readStoredToken();
let playerName = resolveInitialName();
let currentTurnToken = null;
let currentMode = "single";
let lastServerState = null;
const selected = new Set();
let socket = null;
let reconnectDelayMs = 1000;
let closedByClient = false;

function resolveInitialName() {
	const fromUrl = (urlParams.get("name") || "").trim().slice(0, 20);
	if (fromUrl) return fromUrl;
	try {
		const stored = (localStorage.getItem(NAME_STORAGE_KEY) || "").trim().slice(0, 20);
		if (stored) return stored;
	} catch {
		// ignore
	}
	return "";
}

function parseOptionalInt(v) {
	if (v === null || v === "") return null;
	const n = Number.parseInt(v, 10);
	return Number.isNaN(n) ? null : n;
}

function readStoredToken() {
	try {
		const raw = localStorage.getItem(SESSION_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		return parsed.sessionToken || null;
	} catch {
		return null;
	}
}

function writeStoredToken(entry) {
	try {
		if (entry) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(entry));
		else localStorage.removeItem(SESSION_STORAGE_KEY);
	} catch {
		// ignore
	}
}

function setStatus(text, variant = "info") {
	if (!connectionStatusEl) return;
	connectionStatusEl.textContent = text;
	connectionStatusEl.dataset.variant = variant;
	connectionStatusEl.classList.toggle("hidden", !text);
}

function sendSocketMessage(msg) {
	if (!socket || socket.readyState !== WebSocket.OPEN) {
		console.warn("ws not open; dropping", msg.type);
		return;
	}
	socket.send(JSON.stringify(msg));
}

/* ---------------- selection ---------------- */

function toggleCard(code) {
	if (selected.has(code)) selected.delete(code);
	else selected.add(code);
	refreshHandRender();
	refreshPlayEnable();
}

function clearSelection() {
	selected.clear();
	refreshHandRender();
	refreshPlayEnable();
}

function refreshHandRender() {
	if (!lastServerState) return;
	const hand = lastServerState.seat?.hand ?? [];
	renderHand(myHandEl, hand, selected, toggleCard);
}

function refreshPlayEnable() {
	if (!lastServerState || !lastServerState.seat) {
		playBtn.disabled = true;
		return;
	}
	const sel = Array.from(selected);
	if (sel.length === 0) {
		playBtn.disabled = true;
		return;
	}
	const combo = detectCombination(sel, { mode: currentMode });
	if (!combo) {
		playBtn.disabled = true;
		return;
	}
	const last = lastServerState.table.lastMove;
	if (last) {
		// Reconstruct a minimal comparable combo from the last-move descriptor.
		const prevCombo = detectCombination(last.cards, { mode: currentMode });
		playBtn.disabled = !canBeat(combo, prevCombo);
	} else {
		playBtn.disabled = false;
	}
}

/* ---------------- rendering ---------------- */

function applyState(state) {
	lastServerState = state;
	currentMode = state.table.mode ?? "single";

	// Adjust layout to player count
	const playerCount = state.table.playersPublic.length;
	body.dataset.playerCount = String(playerCount);

	// Seat layout: me at bottom, opponents placed around relative to my seat.
	const seatNameByIndex = new Map();
	for (const p of state.table.playersPublic) seatNameByIndex.set(p.seatIndex, p.name);

	placeOpponents(state.table.playersPublic, state.table);

	// Me panel
	const me = state.seat;
	if (me) {
		meNameEl.textContent = me.name;
		const myPublic = state.table.playersPublic.find((p) => p.seatIndex === me.seatIndex);
		meRoleEl.textContent = myPublic?.role === "landlord"
			? "— Landlord"
			: myPublic?.role === "farmer"
			? "— Farmer"
			: "";
		meScoreEl.textContent = `(score ${myPublic?.score ?? 0})`;
		renderHand(myHandEl, me.hand, selected, toggleCard);
	}

	renderLastMove(lastMoveEl, state.table.lastMove, seatNameByIndex);
	renderKitty(kittyEl, state.table.kitty);
	renderNotification(notifEl, state.table.notifications, "");

	phaseEl.textContent = `Phase: ${state.table.phase} · Hand ${state.table.handNumber}`;
	currentTurnToken = me?.turnToken ?? null;

	// Clean up any stale selections that aren't in the hand anymore.
	if (me) {
		const handSet = new Set(me.hand);
		for (const c of Array.from(selected)) if (!handSet.has(c)) selected.delete(c);
	}

	updateActionButtons(state);
	refreshPlayEnable();
}

function placeOpponents(playersPublic, tableView) {
	const myIdx = mySeatIndex ?? 0;
	const playerCount = playersPublic.length;
	// Order opponents clockwise starting from the seat to my left.
	const ordered = [];
	for (let offset = 1; offset < playerCount; offset++) {
		const idx = (myIdx + offset) % playerCount;
		ordered.push(playersPublic.find((p) => p.seatIndex === idx));
	}
	// Assign to slots: 3P → [W, E] (two opponents flanking), 4P → [W, N, E].
	const slotOrder = playerCount === 3 ? ["W", "E"] : ["W", "N", "E"];
	// Clear all
	for (const key of ["N", "W", "E"]) {
		clearOpponent(opponentEls[key]);
		opponentEls[key].classList.add("hidden");
	}
	for (let i = 0; i < ordered.length; i++) {
		const key = slotOrder[i];
		const el = opponentEls[key];
		if (!el || !ordered[i]) continue;
		el.classList.remove("hidden");
		const isTurn = tableView.turnSeatIndex === ordered[i].seatIndex ||
			tableView.bidTurnSeatIndex === ordered[i].seatIndex;
		renderOpponent(el, ordered[i], {
			isTurn,
			landlordSeatIndex: tableView.landlordSeatIndex,
		});
	}
}

function updateActionButtons(state) {
	const { phase, turnSeatIndex, bidTurnSeatIndex, lastMove } = state.table;
	const me = state.seat;
	const myTurn = me && (turnSeatIndex === me.seatIndex || bidTurnSeatIndex === me.seatIndex);

	hide(readyBtn);
	hide(claimBtn);
	hide(declineBtn);
	hide(playBtn);
	hide(passBtn);

	if (phase === "waiting" || phase === "finished") {
		const myPublic = state.table.playersPublic.find((p) => p.seatIndex === me?.seatIndex);
		if (me && !myPublic?.ready) show(readyBtn);
		return;
	}
	if (phase === "bidding" && myTurn) {
		show(claimBtn);
		show(declineBtn);
		return;
	}
	if (phase === "playing" && myTurn) {
		show(playBtn);
		if (lastMove) show(passBtn);
		return;
	}
}

function show(btn) {
	btn.classList.remove("hidden");
}

function hide(btn) {
	btn.classList.add("hidden");
}

/* ---------------- socket lifecycle ---------------- */

function handleServerMessage(msg) {
	switch (msg.type) {
		case "session":
			if (typeof msg.seatIndex === "number") {
				mySeatIndex = msg.seatIndex;
				updateAddressBar(mySeatIndex);
			}
			if (msg.sessionToken) {
				sessionToken = msg.sessionToken;
				writeStoredToken({ sessionToken, seatIndex: mySeatIndex });
			}
			setStatus("Connected.", "ok");
			return;
		case "state":
			applyState(msg);
			return;
		case "error":
			console.warn("server error", msg.code, msg.message);
			if (msg.code === "invalid_session" || msg.code === "seat_taken") {
				writeStoredToken(null);
				sessionToken = null;
			}
			notifEl.textContent = `Server: ${msg.message ?? msg.code}`;
			return;
		case "pong":
			return;
		default:
			console.warn("unknown msg", msg.type);
	}
}

function updateAddressBar(seatIndex) {
	try {
		const params = new URLSearchParams(location.search);
		params.set("seatIndex", String(seatIndex));
		history.replaceState({}, "", `${location.pathname}?${params.toString()}`);
	} catch {
		// ignore
	}
}

function openSocket() {
	if (!tableId) {
		notifEl.textContent = "Missing tableId in URL.";
		return;
	}
	setStatus("Connecting…", "info");
	socket = new WebSocket(WS_URL);
	socket.addEventListener("open", () => {
		reconnectDelayMs = 1000;
		const payload = {
			type: "join_table",
			tableId,
			name: playerName,
		};
		if (typeof mySeatIndex === "number") payload.seatIndex = mySeatIndex;
		if (sessionToken) payload.sessionToken = sessionToken;
		sendSocketMessage(payload);
	});
	socket.addEventListener("message", (ev) => {
		let msg;
		try {
			msg = JSON.parse(ev.data);
		} catch {
			return;
		}
		handleServerMessage(msg);
	});
	socket.addEventListener("close", () => {
		if (closedByClient) return;
		setStatus("Reconnecting…", "warn");
		setTimeout(openSocket, reconnectDelayMs);
		reconnectDelayMs = Math.min(reconnectDelayMs * 2, 10_000);
	});
	socket.addEventListener("error", () => {
		// `close` follows
	});
}

/* ---------------- button wiring ---------------- */

readyBtn.addEventListener("click", () => {
	sendSocketMessage({ type: "ready" });
	hide(readyBtn);
});
claimBtn.addEventListener("click", () => {
	sendSocketMessage({ type: "claim_landlord", turnToken: currentTurnToken });
});
declineBtn.addEventListener("click", () => {
	sendSocketMessage({ type: "decline_landlord", turnToken: currentTurnToken });
});
playBtn.addEventListener("click", () => {
	const cards = Array.from(selected);
	if (cards.length === 0) return;
	sendSocketMessage({ type: "play_cards", turnToken: currentTurnToken, cards });
	clearSelection();
});
passBtn.addEventListener("click", () => {
	sendSocketMessage({ type: "pass", turnToken: currentTurnToken });
});

globalThis.addEventListener("beforeunload", () => {
	closedByClient = true;
	socket?.close();
});

/* ---------------- share link ---------------- */

function computeShareUrl() {
	const params = new URLSearchParams({ tableId });
	const wsUrlParam = urlParams.get("wsUrl");
	if (wsUrlParam) params.set("wsUrl", wsUrlParam);
	const base = `${location.origin}${location.pathname}`;
	return `${base}?${params.toString()}`;
}

function wireShareBar() {
	if (!shareLinkEl || !tableId) return;
	const url = computeShareUrl();
	shareLinkEl.value = url;
	if (!shareCopyBtn) return;
	shareCopyBtn.addEventListener("click", async () => {
		try {
			await navigator.clipboard.writeText(url);
			const original = shareCopyBtn.textContent;
			shareCopyBtn.textContent = "Copied!";
			setTimeout(() => (shareCopyBtn.textContent = original), 1500);
		} catch {
			shareLinkEl.select();
			shareLinkEl.setSelectionRange(0, 99999);
		}
	});
}

/* ---------------- name prompt ---------------- */

function promptForName() {
	return new Promise((resolve) => {
		if (!namePromptEl || !namePromptInput || !namePromptSubmit) {
			resolve("Player");
			return;
		}
		namePromptEl.classList.remove("hidden");
		namePromptInput.focus();
		const submit = () => {
			const value = (namePromptInput.value || "").trim().slice(0, 20);
			if (!value) {
				namePromptInput.focus();
				return;
			}
			try {
				localStorage.setItem(NAME_STORAGE_KEY, value);
			} catch {
				// ignore
			}
			namePromptEl.classList.add("hidden");
			namePromptSubmit.removeEventListener("click", submit);
			namePromptInput.removeEventListener("keydown", onKey);
			resolve(value);
		};
		const onKey = (ev) => {
			if (ev.key === "Enter") submit();
		};
		namePromptSubmit.addEventListener("click", submit);
		namePromptInput.addEventListener("keydown", onKey);
	});
}

/* ---------------- boot ---------------- */

async function boot() {
	wireShareBar();
	if (!playerName) {
		notifEl.textContent = "Waiting for your name…";
		playerName = await promptForName();
	}
	notifEl.textContent = "Loading table…";
	openSocket();
}

boot();
