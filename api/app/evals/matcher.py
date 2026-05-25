"""Match predicted events to gold events and compute precision/recall.

A predicted event matches a gold event when BOTH hold:

1. Party overlap: ≥1 normalized party name in common (lowercase, legal
   suffixes stripped; substring containment counts, so "Acme" matches
   "Acme Corporation").
2. Date agreement: exact ISO match, OR either side has precision
   "approximate" and the year-month prefixes match, OR the date_precision
   is "range" and the other side's date falls inside the range.

Title is NOT a gating criterion: the model legitimately uses synonyms
("MSA entered" vs "Master Services Agreement executed") that destroy
token-Jaccard but describe the same event. When two predicted events could
fit one gold event, the candidate with the higher title-token Jaccard wins.

Matching is greedy with tiebreaking: gold events are walked in declaration
order, and for each gold the unclaimed predicted with the highest title
Jaccard among those satisfying party+date is claimed. A more sophisticated
assignment (Hungarian, score-weighted) is overkill for the current dataset
size.

Definitions of precision and recall live in ARCHITECTURE.md so the numbers
in the README can be interpreted unambiguously.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

_STOP_WORDS = {
    "the",
    "a",
    "an",
    "of",
    "to",
    "in",
    "on",
    "at",
    "by",
    "and",
    "or",
    "for",
    "with",
    "from",
    "is",
    "was",
    "are",
    "be",
}
_LEGAL_SUFFIXES = {
    "inc",
    "incorporated",
    "llc",
    "ltd",
    "limited",
    "co",
    "corp",
    "corporation",
    "company",
    "plc",
    "lp",
    "llp",
    "pllc",
    "md",
    "group",
}


@dataclass(frozen=True)
class GoldEvent:
    title: str
    date: str
    date_precision: str
    parties: list[str]


@dataclass(frozen=True)
class PredictedEvent:
    title: str
    date: str
    date_precision: str
    parties: list[str]  # party names


@dataclass
class CaseResult:
    case: str
    tp: int
    fp: int
    fn: int
    precision: float
    recall: float
    unmatched_gold: list[dict]
    unmatched_predicted: list[dict]


def _normalize_party(name: str) -> str:
    cleaned = "".join(c.lower() if c.isalnum() or c.isspace() else " " for c in name)
    tokens = [t for t in cleaned.split() if t and t not in _LEGAL_SUFFIXES]
    return " ".join(tokens)


def _party_overlap(a: list[str], b: list[str]) -> bool:
    if not a or not b:
        return False
    na = [_normalize_party(x) for x in a if x]
    nb = [_normalize_party(x) for x in b if x]
    for x in na:
        for y in nb:
            if not x or not y:
                continue
            if x == y or x in y or y in x:
                return True
    return False


def _title_tokens(title: str) -> set[str]:
    cleaned = "".join(c.lower() if c.isalnum() or c.isspace() else " " for c in title)
    return {t for t in cleaned.split() if len(t) >= 3 and t not in _STOP_WORDS}


def _title_jaccard(a: str, b: str) -> float:
    ta = _title_tokens(a)
    tb = _title_tokens(b)
    if not ta and not tb:
        return 1.0
    inter = len(ta & tb)
    union = len(ta | tb)
    return inter / union if union else 0.0


def _parse_range(date: str) -> tuple[str, str]:
    if "/" in date:
        start, end = date.split("/", 1)
        return start, end
    return date, date


def _date_match(g: GoldEvent, p: PredictedEvent) -> bool:
    # Range on either side: any overlap with the other's window counts.
    if g.date_precision == "range" or p.date_precision == "range":
        gs, ge = _parse_range(g.date)
        ps, pe = _parse_range(p.date)
        return not (ge < ps or pe < gs)
    # Approximate on either side: same year-month suffices.
    if g.date_precision == "approximate" or p.date_precision == "approximate":
        return g.date[:7] == p.date[:7]
    return g.date == p.date


def _matches(g: GoldEvent, p: PredictedEvent) -> bool:
    if not _party_overlap(g.parties, p.parties):
        return False
    return _date_match(g, p)


def evaluate_case(case: str, gold: list[GoldEvent], predicted: list[PredictedEvent]) -> CaseResult:
    claimed = [False] * len(predicted)
    matched_gold_indices: set[int] = set()

    for gi, g in enumerate(gold):
        # Score each unclaimed candidate by title Jaccard; pick the highest.
        # Ties resolve to the earliest declared, which keeps matching stable.
        best_pi = -1
        best_score = -1.0
        for pi, p in enumerate(predicted):
            if claimed[pi]:
                continue
            if not _matches(g, p):
                continue
            score = _title_jaccard(g.title, p.title)
            if score > best_score:
                best_score = score
                best_pi = pi
        if best_pi >= 0:
            claimed[best_pi] = True
            matched_gold_indices.add(gi)

    tp = len(matched_gold_indices)
    fn = len(gold) - tp
    fp = sum(1 for c in claimed if not c)
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0

    unmatched_gold = [asdict(g) for gi, g in enumerate(gold) if gi not in matched_gold_indices]
    unmatched_predicted = [asdict(p) for pi, p in enumerate(predicted) if not claimed[pi]]

    return CaseResult(
        case=case,
        tp=tp,
        fp=fp,
        fn=fn,
        precision=round(precision, 4),
        recall=round(recall, 4),
        unmatched_gold=unmatched_gold,
        unmatched_predicted=unmatched_predicted,
    )


@dataclass
class OverallMetrics:
    tp: int
    fp: int
    fn: int
    precision: float
    recall: float


def aggregate(per_case: list[CaseResult]) -> OverallMetrics:
    tp = sum(c.tp for c in per_case)
    fp = sum(c.fp for c in per_case)
    fn = sum(c.fn for c in per_case)
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    return OverallMetrics(tp=tp, fp=fp, fn=fn, precision=round(precision, 4), recall=round(recall, 4))


@dataclass
class EvalReport:
    prompt_version: str
    model: str
    run_at: str
    overall: OverallMetrics
    per_case: list[CaseResult] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "prompt_version": self.prompt_version,
            "model": self.model,
            "run_at": self.run_at,
            "overall": asdict(self.overall),
            "per_case": [asdict(c) for c in self.per_case],
        }
