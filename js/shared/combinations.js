// Client-side mirror of backend/src/doudizhu/combinations.js.
// Kept identical on purpose — the server is authoritative, but the client uses this to enable or
// disable the Play button based on the current selection. Any drift from the backend will make
// the Play button lie; keep these in sync if you edit either.

const RANKS = ["3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A", "2", "sj", "bj"];
const RANK_ORDER_MAP = RANKS.reduce((acc, r, i) => {
	acc[r] = i;
	return acc;
}, {});

export const COMBO = Object.freeze({
	SINGLE: "single",
	PAIR: "pair",
	TRIPLE: "triple",
	TRIPLE_WITH_SINGLE: "triple_with_single",
	TRIPLE_WITH_PAIR: "triple_with_pair",
	STRAIGHT: "straight",
	DOUBLE_SEQUENCE: "double_sequence",
	AIRPLANE: "airplane",
	BOMB: "bomb",
	ROCKET: "rocket",
	SUPER_ROCKET: "super_rocket",
});

// Dealt cards may carry a "#<n>" instance suffix disambiguating the two physical copies that
// exist in a double deck (e.g. "4D#17", "sj#54"). Strip it before classifying the card; rule
// logic compares by rank alone, so tagged and untagged codes are interchangeable.
function baseCode(card) {
	const hash = card.indexOf("#");
	return hash === -1 ? card : card.slice(0, hash);
}

function isJoker(card) {
	const base = baseCode(card);
	return base === "sj" || base === "bj";
}

function rankOf(card) {
	const base = baseCode(card);
	return isJoker(base) ? base : base[0];
}

function rankOrder(card) {
	return RANK_ORDER_MAP[rankOf(card)];
}

function isSequenceRank(rank) {
	return rank !== "2" && rank !== "sj" && rank !== "bj";
}

function groupByRank(cards) {
	const map = Object.create(null);
	for (const c of cards) {
		const r = rankOf(c);
		map[r] = (map[r] || 0) + 1;
	}
	return map;
}

function sortByRank(cards) {
	return cards.slice().sort((a, b) => rankOrder(a) - rankOrder(b));
}

function hasConsecutiveRanks(ranks) {
	if (ranks.length === 0) return true;
	for (let i = 1; i < ranks.length; i++) {
		if (RANK_ORDER_MAP[ranks[i]] - RANK_ORDER_MAP[ranks[i - 1]] !== 1) return false;
	}
	return true;
}

export function detectCombination(cards, options = {}) {
	const mode = options.mode ?? "single";
	if (!Array.isArray(cards) || cards.length === 0) return null;
	const sorted = sortByRank(cards);
	const size = sorted.length;
	const groups = groupByRank(sorted);
	const ranksPresent = Object.keys(groups);
	const counts = Object.values(groups).sort((a, b) => b - a);
	const smallJokerCount = sorted.filter((c) => rankOf(c) === "sj").length;
	const bigJokerCount = sorted.filter((c) => rankOf(c) === "bj").length;

	if (mode === "double" && size === 4 && smallJokerCount === 2 && bigJokerCount === 2) {
		return { type: COMBO.SUPER_ROCKET, rank: 0, size: 4, cards: sorted };
	}
	if (mode === "single" && size === 2 && smallJokerCount === 1 && bigJokerCount === 1) {
		return { type: COMBO.ROCKET, rank: 0, size: 2, cards: sorted };
	}

	if (ranksPresent.length === 1 && size >= 4 && !isJoker(sorted[0])) {
		return { type: COMBO.BOMB, rank: RANK_ORDER_MAP[ranksPresent[0]], size, cards: sorted };
	}
	if (size === 1) return { type: COMBO.SINGLE, rank: rankOrder(sorted[0]), size: 1, cards: sorted };
	if (size === 2 && ranksPresent.length === 1 && !isJoker(sorted[0])) {
		return { type: COMBO.PAIR, rank: RANK_ORDER_MAP[ranksPresent[0]], size: 2, cards: sorted };
	}
	if (size === 3 && ranksPresent.length === 1 && !isJoker(sorted[0])) {
		return { type: COMBO.TRIPLE, rank: RANK_ORDER_MAP[ranksPresent[0]], size: 3, cards: sorted };
	}
	if (size === 4 && counts[0] === 3 && counts[1] === 1) {
		const tr = ranksPresent.find((r) => groups[r] === 3);
		return { type: COMBO.TRIPLE_WITH_SINGLE, rank: RANK_ORDER_MAP[tr], size: 4, cards: sorted };
	}
	if (size === 5 && counts[0] === 3 && counts[1] === 2) {
		const tr = ranksPresent.find((r) => groups[r] === 3);
		return { type: COMBO.TRIPLE_WITH_PAIR, rank: RANK_ORDER_MAP[tr], size: 5, cards: sorted };
	}
	if (size >= 5 && ranksPresent.length === size) {
		if (ranksPresent.every(isSequenceRank)) {
			const sr = ranksPresent.slice().sort((a, b) => RANK_ORDER_MAP[a] - RANK_ORDER_MAP[b]);
			if (hasConsecutiveRanks(sr)) {
				return { type: COMBO.STRAIGHT, rank: RANK_ORDER_MAP[sr[0]], size, cards: sorted };
			}
		}
	}
	if (size >= 6 && size % 2 === 0) {
		const pairRanks = [];
		let allPairs = true;
		for (const r of ranksPresent) {
			if (groups[r] !== 2 || !isSequenceRank(r)) {
				allPairs = false;
				break;
			}
			pairRanks.push(r);
		}
		if (allPairs && pairRanks.length === size / 2) {
			const sr = pairRanks.slice().sort((a, b) => RANK_ORDER_MAP[a] - RANK_ORDER_MAP[b]);
			if (hasConsecutiveRanks(sr)) {
				return { type: COMBO.DOUBLE_SEQUENCE, rank: RANK_ORDER_MAP[sr[0]], size, cards: sorted };
			}
		}
	}
	const airplane = detectAirplane(groups, sorted, size);
	if (airplane) return airplane;
	return null;
}

function detectAirplane(groups, sorted, size) {
	const tripleRanks = [];
	for (const r of Object.keys(groups)) {
		if (groups[r] >= 3 && isSequenceRank(r)) tripleRanks.push(r);
	}
	if (tripleRanks.length < 2) return null;
	tripleRanks.sort((a, b) => RANK_ORDER_MAP[a] - RANK_ORDER_MAP[b]);

	let bestStart = 0;
	let bestLen = 1;
	let curStart = 0;
	let curLen = 1;
	for (let i = 1; i < tripleRanks.length; i++) {
		if (RANK_ORDER_MAP[tripleRanks[i]] - RANK_ORDER_MAP[tripleRanks[i - 1]] === 1) {
			curLen++;
			if (curLen > bestLen) {
				bestLen = curLen;
				bestStart = curStart;
			}
		} else {
			curStart = i;
			curLen = 1;
		}
	}
	if (bestLen < 2) return null;
	const runTriples = tripleRanks.slice(bestStart, bestStart + bestLen);
	const coreSize = runTriples.length * 3;

	if (size === coreSize) {
		for (const r of Object.keys(groups)) {
			if (!runTriples.includes(r)) return null;
			if (groups[r] !== 3) return null;
		}
		return { type: COMBO.AIRPLANE, rank: RANK_ORDER_MAP[runTriples[0]], size, cards: sorted };
	}
	if (size === coreSize + runTriples.length) {
		let attachments = 0;
		for (const r of Object.keys(groups)) {
			if (runTriples.includes(r)) {
				if (groups[r] !== 3) return null;
				continue;
			}
			attachments += groups[r];
		}
		if (attachments === runTriples.length) {
			return { type: COMBO.AIRPLANE, rank: RANK_ORDER_MAP[runTriples[0]], size, cards: sorted };
		}
	}
	if (size === coreSize + runTriples.length * 2) {
		const pairAttachments = [];
		let bad = false;
		for (const r of Object.keys(groups)) {
			if (runTriples.includes(r)) {
				if (groups[r] !== 3) {
					bad = true;
					break;
				}
				continue;
			}
			if (groups[r] === 2 && !isJoker(r)) pairAttachments.push(r);
			else {
				bad = true;
				break;
			}
		}
		if (!bad && pairAttachments.length === runTriples.length) {
			return { type: COMBO.AIRPLANE, rank: RANK_ORDER_MAP[runTriples[0]], size, cards: sorted };
		}
	}
	return null;
}

export function canBeat(next, prev) {
	if (!next || !prev) return false;
	if (next.type === COMBO.SUPER_ROCKET) return true;
	if (prev.type === COMBO.SUPER_ROCKET) return false;
	if (next.type === COMBO.ROCKET) return true;
	if (prev.type === COMBO.ROCKET) return false;
	if (next.type === COMBO.BOMB && prev.type !== COMBO.BOMB) return true;
	if (prev.type === COMBO.BOMB && next.type !== COMBO.BOMB) return false;
	if (next.type === COMBO.BOMB && prev.type === COMBO.BOMB) {
		if (next.size !== prev.size) return next.size > prev.size;
		return next.rank > prev.rank;
	}
	if (next.type !== prev.type) return false;
	if (next.size !== prev.size) return false;
	return next.rank > prev.rank;
}

export function sortHand(cards) {
	return sortByRank(cards);
}
