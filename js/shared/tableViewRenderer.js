// Rendering helpers for the Dou Di Zhu table. Pure DOM, given state + refs.

import { sortHand } from "./combinations.js";

export function cardSrc(cardCode) {
	// Cards dealt by the server may carry a "#<n>" instance suffix (e.g. "4D#17"); the SVG asset
	// is named by the base code alone.
	const hash = cardCode.indexOf("#");
	const base = hash === -1 ? cardCode : cardCode.slice(0, hash);
	if (base === "sj" || base === "bj") {
		return `cards/${base}.svg`;
	}
	return `cards/${base.toUpperCase()}.svg`;
}

export function renderHand(handEl, cards, selectedSet, onToggle) {
	const sorted = sortHand(cards);
	handEl.innerHTML = "";
	for (const code of sorted) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "hand-card";
		btn.dataset.card = code;
		if (selectedSet.has(code)) btn.classList.add("selected");
		const img = document.createElement("img");
		img.src = cardSrc(code);
		img.alt = code;
		btn.appendChild(img);
		btn.addEventListener("click", () => onToggle(code));
		handEl.appendChild(btn);
	}
}

export function renderLastMove(lastMoveEl, lastMove, seatNameByIndex) {
	lastMoveEl.innerHTML = "";
	if (!lastMove) {
		lastMoveEl.classList.add("empty");
		lastMoveEl.textContent = "— free round —";
		return;
	}
	lastMoveEl.classList.remove("empty");
	const header = document.createElement("div");
	header.className = "last-move-header";
	header.textContent = `${seatNameByIndex.get(lastMove.seatIndex) ?? `Seat ${lastMove.seatIndex + 1}`} played ${lastMove.type.replace(/_/g, " ")}`;
	lastMoveEl.appendChild(header);
	const row = document.createElement("div");
	row.className = "last-move-cards";
	for (const code of lastMove.cards) {
		const img = document.createElement("img");
		img.src = cardSrc(code);
		img.alt = code;
		img.className = "played-card";
		row.appendChild(img);
	}
	lastMoveEl.appendChild(row);
}

export function renderKitty(kittyEl, kitty) {
	if (!kitty || kitty.length === 0) {
		kittyEl.classList.add("hidden");
		kittyEl.innerHTML = "";
		return;
	}
	kittyEl.classList.remove("hidden");
	kittyEl.innerHTML = "";
	const label = document.createElement("div");
	label.className = "kitty-label";
	label.textContent = "Kitty";
	kittyEl.appendChild(label);
	const row = document.createElement("div");
	row.className = "kitty-cards";
	for (const code of kitty) {
		const img = document.createElement("img");
		img.src = cardSrc(code);
		img.alt = code;
		img.className = "kitty-card";
		row.appendChild(img);
	}
	kittyEl.appendChild(row);
}

export function renderOpponent(opponentEl, publicPlayer, opts) {
	const { isTurn, landlordSeatIndex, connected = true, canKick = false, onKick = null } = opts;
	const nameEl = opponentEl.querySelector(".opponent-name");
	const roleEl = opponentEl.querySelector(".opponent-role");
	const countEl = opponentEl.querySelector(".opponent-hand-count");
	const statusEl = opponentEl.querySelector(".opponent-status");
	const scoreEl = opponentEl.querySelector(".opponent-score");

	nameEl.textContent = publicPlayer.name;
	roleEl.textContent = publicPlayer.role === "landlord"
		? "Landlord"
		: publicPlayer.role === "farmer"
		? "Farmer"
		: "";
	countEl.textContent = String(publicPlayer.handCount);
	statusEl.textContent = publicPlayer.hasPassed ? "passed" : "";
	scoreEl.textContent = `score ${publicPlayer.score}`;

	opponentEl.classList.toggle("turn", isTurn);
	opponentEl.classList.toggle("landlord", landlordSeatIndex === publicPlayer.seatIndex);
	opponentEl.classList.toggle("offline", !connected);

	// Offline badge — insert before the name if disconnected, remove when reconnected.
	let offlineBadge = opponentEl.querySelector(".opponent-offline");
	if (!connected) {
		if (!offlineBadge) {
			offlineBadge = document.createElement("div");
			offlineBadge.className = "opponent-offline";
			offlineBadge.textContent = "Offline";
			opponentEl.insertBefore(offlineBadge, nameEl);
		}
	} else {
		offlineBadge?.remove();
	}

	// Kick button — only rendered for the host (seat 0), not on themselves.
	let kickBtn = opponentEl.querySelector(".kick-button");
	if (canKick && onKick) {
		if (!kickBtn) {
			kickBtn = document.createElement("button");
			kickBtn.type = "button";
			kickBtn.className = "kick-button";
			kickBtn.textContent = "Kick";
			opponentEl.appendChild(kickBtn);
		}
		kickBtn.onclick = () => onKick(publicPlayer.seatIndex, publicPlayer.name);
	} else {
		kickBtn?.remove();
	}
}

export function renderNotification(notifEl, messages, fallback) {
	if (Array.isArray(messages) && messages.length > 0) {
		notifEl.textContent = messages[0];
	} else {
		notifEl.textContent = fallback ?? "";
	}
}

export function clearOpponent(opponentEl) {
	opponentEl.querySelector(".opponent-name").textContent = "";
	opponentEl.querySelector(".opponent-role").textContent = "";
	opponentEl.querySelector(".opponent-hand-count").textContent = "";
	opponentEl.querySelector(".opponent-status").textContent = "";
	opponentEl.querySelector(".opponent-score").textContent = "";
	opponentEl.classList.remove("turn", "landlord", "offline");
	opponentEl.querySelector(".opponent-offline")?.remove();
	opponentEl.querySelector(".kick-button")?.remove();
}
