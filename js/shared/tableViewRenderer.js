// Rendering helpers for the Dou Di Zhu table. Pure DOM, given state + refs.

const RANK_ORDER = ["3","4","5","6","7","8","9","10","J","Q","K","A","2","sj","bj"];

function cardRank(code) {
	const hash = code.indexOf("#");
	const base = hash === -1 ? code : code.slice(0, hash);
	if (base === "sj" || base === "bj") return base;
	return base.slice(0, -1); // strip suit
}

function cardsText(cards) {
	return [...cards]
		.sort((a, b) => RANK_ORDER.indexOf(cardRank(a)) - RANK_ORDER.indexOf(cardRank(b)))
		.map(cardRank)
		.join("");
}

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

export function renderHand(handEl, cardZOrder, cardPositions, selectedSet) {
	handEl.innerHTML = "";
	for (let zi = 0; zi < cardZOrder.length; zi++) {
		const code = cardZOrder[zi];
		const pos = cardPositions.get(code);
		if (!pos) continue;
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "hand-card";
		btn.dataset.card = code;
		btn.style.left = `${pos.x}px`;
		btn.style.top = `${pos.y}px`;
		btn.style.zIndex = String(zi + 1);
		if (selectedSet.has(code)) btn.classList.add("selected");
		const img = document.createElement("img");
		img.src = cardSrc(code);
		img.alt = code;
		btn.appendChild(img);
		handEl.appendChild(btn);
	}
}

export function renderTurnHistory(el, turnHistory, seatNameByIndex) {
	el.innerHTML = "";
	if (!turnHistory || turnHistory.length === 0) return;

	// Left: text log of all moves this trick.
	const log = document.createElement("div");
	log.className = "turn-history-log";
	for (const entry of turnHistory) {
		const row = document.createElement("div");
		row.className = "turn-history-entry";
		const name = document.createElement("span");
		name.className = "turn-history-name";
		name.textContent = seatNameByIndex.get(entry.seatIndex) ?? `Seat ${entry.seatIndex + 1}`;
		row.appendChild(name);
		const detail = document.createElement("span");
		if (entry.action === "pass") {
			detail.className = "turn-history-pass";
			detail.textContent = "passed";
			row.appendChild(detail);
		} else {
			// Text fallback (mobile).
			detail.className = "turn-history-play";
			detail.textContent = cardsText(entry.cards);
			row.appendChild(detail);
			// Mini card images (desktop/tablet).
			const sorted = [...entry.cards].sort(
				(a, b) => RANK_ORDER.indexOf(cardRank(a)) - RANK_ORDER.indexOf(cardRank(b))
			);
			const miniCards = document.createElement("div");
			miniCards.className = "turn-history-mini-cards";
			for (const code of sorted) {
				const img = document.createElement("img");
				img.src = cardSrc(code);
				img.alt = cardRank(code);
				img.className = "turn-history-mini-card";
				miniCards.appendChild(img);
			}
			row.appendChild(miniCards);
		}
		log.appendChild(row);
	}
	el.appendChild(log);

	// Center: big card images of the most recent play only (no header text).
	const lastPlay = [...turnHistory].reverse().find((e) => e.action === "play");
	if (lastPlay) {
		const main = document.createElement("div");
		main.className = "turn-history-main";
		const cardRow = document.createElement("div");
		cardRow.className = "last-move-cards";
		for (const code of lastPlay.cards) {
			const img = document.createElement("img");
			img.src = cardSrc(code);
			img.alt = code;
			img.className = "played-card";
			cardRow.appendChild(img);
		}
		main.appendChild(cardRow);
		el.appendChild(main);
	}
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
