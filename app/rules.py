"""생활규정 엔진 — 순수 함수만 둔다. 모든 계산은 settings.rules 하나만 읽는다.

Code.gs 에서 읽어 낸 규정(기본값):
1. 미인정 결석·지각·조퇴·결과만 센다
2. 결석 1회 = 1점, 지각·조퇴·결과는 합쳐 3회마다 1점. 남은 횟수는 다음 달로 이월
   → 기간 전체의 지각·조퇴·결과를 먼저 더한 뒤 한 번에 3으로 나눈다
3. 체크한 달을 더한다
4. 생활지도를 받으면 마지막 지도 달까지 지우고 다음 달부터 다시 센다(이월도 사라짐)
5. 초기화 후 3점 이상이면 대상자
6. 지도 횟수 0 → 1차, 1 → 2차, 2 → 3차, 3 이상 → 학생선도위원회
"""
from __future__ import annotations

import copy
from typing import Any, Dict, Iterable, List, Optional, Tuple

ITEMS = ["abs", "late", "leave", "result"]
ITEM_LABELS = {"abs": "결석", "late": "지각", "leave": "조퇴", "result": "결과"}

DEFAULT_RULES: Dict[str, Any] = {
    "start_month": 3,
    "count": {"abs": True, "late": True, "leave": True, "result": True},
    "conversion": {"mode": "weighted", "n": 3},
    "threshold": 3,
    "reset": {"enabled": True, "scope": "through"},  # through=지도한 달까지 / before=지도한 달 전까지
    "stages": {"count": 3, "final_name": "학생선도위원회", "stage_name": "학년부 생활지도"},
    # 학년별 × 차수별 지도(징계) 방안. {"3": {"1": "...", "2": "...", "3": "...", "final": "..."}}
    "measures": {},
}


def merge_rules(rules: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    out = copy.deepcopy(DEFAULT_RULES)
    for k, v in (rules or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k].update(v)
        else:
            out[k] = v
    return out


# ---------------------------------------------------------------- 학년도 월 순서

def school_order(m: int, start: int = 3) -> int:
    """학년도 순서: 시작 월이 0, 그다음 달이 1 … (3월 시작이면 3→0, 12→9, 1→10, 2→11)"""
    return (int(m) - int(start) + 12) % 12


def school_months(start: int = 3) -> List[int]:
    return [((start - 1 + i) % 12) + 1 for i in range(12)]


def sort_months(months: Iterable[int], start: int = 3) -> List[int]:
    return sorted({int(m) for m in months}, key=lambda m: school_order(m, start))


def month_range(m_from: int, m_to: int, start: int = 3) -> List[int]:
    a, b = school_order(m_from, start), school_order(m_to, start)
    return [m for m in school_months(start) if a <= school_order(m, start) <= b]


# ---------------------------------------------------------------- 제외 적용

def empty_counts() -> Dict[str, int]:
    return {k: 0 for k in ITEMS}


def add_counts(a: Dict[str, int], b: Dict[str, int]) -> Dict[str, int]:
    return {k: int(a.get(k, 0)) + int(b.get(k, 0)) for k in ITEMS}


def month_entries(exclusion: Optional[Dict[str, Any]], month: int) -> List[Dict[str, Any]]:
    """한 학생·한 달의 제외 항목. 「전체 기간」이면 그 달 전체 제외 항목 하나."""
    if not exclusion:
        return []
    if exclusion.get("all_period"):
        return [{"reason": exclusion.get("all_reason") or "전체 기간", "mode": "all"}]
    months = exclusion.get("months") or {}
    return list(months.get(str(month)) or months.get(month) or [])


def apply_exclusion(record: Dict[str, int], entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    """그 달 기록 → {eff: 누적에 들어가는 값, doc: 제외된 값, all: 그 달 전체 제외인지, reasons}"""
    raw = {k: int(record.get(k, 0) or 0) for k in ITEMS}
    reasons = [e.get("reason", "") for e in entries if e.get("reason")]
    if any(e.get("mode") == "all" for e in entries):
        return {"raw": raw, "eff": empty_counts(), "doc": dict(raw), "all": True, "reasons": reasons}
    doc = empty_counts()
    for e in entries:
        if e.get("mode") == "documented":
            for k in ITEMS:
                doc[k] += int((e.get("counts") or {}).get(k, 0) or 0)
    doc = {k: min(doc[k], raw[k]) for k in ITEMS}
    eff = {k: raw[k] - doc[k] for k in ITEMS}
    return {"raw": raw, "eff": eff, "doc": doc, "all": False, "reasons": reasons}


# ---------------------------------------------------------------- 환산

def counted(totals: Dict[str, int], rules: Dict[str, Any]) -> Dict[str, int]:
    """세는 대상이 아닌 항목은 0으로."""
    cnt = rules.get("count") or {}
    return {k: (int(totals.get(k, 0)) if cnt.get(k, True) else 0) for k in ITEMS}


def score(totals: Dict[str, int], rules: Dict[str, Any]) -> Tuple[int, int]:
    """(환산 점수, 이월 횟수). 기간 전체 합계를 받아 한 번에 나눈다.

    가중: 결석 + ⌊(지각+조퇴+결과) ÷ N⌋, 이월 = 나머지
    단순: 네 항목 합, 이월 0
    """
    t = counted(totals, rules)
    conv = rules.get("conversion") or {}
    if conv.get("mode", "weighted") == "simple":
        return sum(t.values()), 0
    n = max(1, int(conv.get("n", 3) or 3))
    others = t["late"] + t["leave"] + t["result"]
    return t["abs"] + others // n, others % n


# ---------------------------------------------------------------- 초기화·차수

def last_guidance_month(guidances: List[Dict[str, Any]], start: int = 3) -> Optional[int]:
    months = [int(g["month"]) for g in guidances if g.get("month")]
    if not months:
        return None
    return max(months, key=lambda m: school_order(m, start))


def counting_start(guidances: List[Dict[str, Any]], rules: Dict[str, Any]) -> Optional[int]:
    """누적을 다시 세기 시작하는 달. None 이면 학년도 첫 달부터, -1 이면 셀 달이 없음."""
    start = int(rules.get("start_month", 3))
    reset = rules.get("reset") or {}
    if not reset.get("enabled", True):
        return None
    last = last_guidance_month(guidances, start)
    if last is None:
        return None
    if reset.get("scope", "through") == "before":
        return last
    o = school_order(last, start) + 1
    if o >= 12:
        return -1
    return school_months(start)[o]


def month_counts_after_reset(month: int, guidances: List[Dict[str, Any]], rules: Dict[str, Any]) -> bool:
    cs = counting_start(guidances, rules)
    if cs is None:
        return True
    if cs == -1:
        return False
    start = int(rules.get("start_month", 3))
    return school_order(month, start) >= school_order(cs, start)


def stage_info(guidance_count: int, rules: Dict[str, Any], grade: Optional[int] = None) -> Dict[str, Any]:
    """지금까지 받은 지도 횟수 → 이번에 해당하는 단계."""
    st = rules.get("stages") or {}
    n = max(1, int(st.get("count", 3) or 3))
    stage_name = st.get("stage_name") or "학년부 생활지도"
    final_name = st.get("final_name") or "학생선도위원회"
    c = max(0, int(guidance_count))
    if c >= n:
        info = {"index": n, "step": c + 1, "final": True, "label": final_name, "short": final_name, "key": "final"}
    else:
        info = {
            "index": c,
            "step": c + 1,
            "final": False,
            "label": "%s(%d차)" % (stage_name, c + 1),
            "short": "%d차" % (c + 1),
            "key": str(c + 1),
        }
    info["measure"] = measure_for(rules, grade, info["key"]) if grade is not None else ""
    return info


def measure_for(rules: Dict[str, Any], grade: Optional[int], key: str) -> str:
    m = (rules.get("measures") or {}).get(str(grade)) or {}
    return str(m.get(key) or "").strip()


def missing_measures(rules: Dict[str, Any], grades: Iterable[int]) -> List[str]:
    """비어 있는 지도 방안 칸 목록(저장 전 알림용)."""
    n = int((rules.get("stages") or {}).get("count", 3) or 3)
    out = []
    for g in grades:
        for i in range(1, n + 1):
            if not measure_for(rules, g, str(i)):
                out.append("%d학년 %d차" % (g, i))
        if not measure_for(rules, g, "final"):
            out.append("%d학년 %s" % (g, (rules.get("stages") or {}).get("final_name") or "학생선도위원회"))
    return out


# ---------------------------------------------------------------- 학생 한 명 계산

def compute_student(
    records: Dict[int, Dict[str, int]],
    months: Iterable[int],
    rules: Dict[str, Any],
    exclusion: Optional[Dict[str, Any]] = None,
    guidances: Optional[List[Dict[str, Any]]] = None,
    apply_exclusions: bool = True,
    apply_reset: bool = True,
) -> Dict[str, Any]:
    """체크한 달(months)에 대해 학생 한 명의 누적·이월을 계산한다.

    records: {월: {abs, late, leave, result}} (원자료)
    """
    start = int(rules.get("start_month", 3))
    guidances = guidances or []
    raw_tot = empty_counts()
    eff_tot = empty_counts()
    doc_tot = empty_counts()
    per_month = []
    for m in sort_months(months, start):
        rec = records.get(m)
        if rec is None:
            continue
        entries = month_entries(exclusion, m) if apply_exclusions else []
        ex = apply_exclusion(rec, entries)
        in_period = month_counts_after_reset(m, guidances, rules) if apply_reset else True
        raw_tot = add_counts(raw_tot, ex["raw"])
        if in_period:
            eff_tot = add_counts(eff_tot, ex["eff"])
            doc_tot = add_counts(doc_tot, ex["doc"])
        per_month.append(
            {
                "month": m,
                "raw": ex["raw"],
                "eff": ex["eff"],
                "doc": ex["doc"],
                "all_excluded": ex["all"],
                "reasons": ex["reasons"],
                "counted": in_period,
            }
        )
    sc, carry = score(eff_tot, rules)
    return {"raw": raw_tot, "eff": eff_tot, "doc": doc_tot, "score": sc, "carry": carry, "months": per_month}


# ---------------------------------------------------------------- 자연어 설명

def _eul(word: str) -> str:
    """받침 있으면 '을', 없으면 '를'"""
    if not word:
        return "을"
    c = ord(word[-1])
    if 0xAC00 <= c <= 0xD7A3:
        return "을" if (c - 0xAC00) % 28 else "를"
    return "을"


def describe(rules: Dict[str, Any]) -> Dict[str, Any]:
    """마법사 각 단계 아래·마지막 화면에 보여 줄 문장."""
    r = merge_rules(rules)
    cnt = r["count"]
    names = [ITEM_LABELS[k] for k in ITEMS if cnt.get(k, True)]
    others = [ITEM_LABELS[k] for k in ("late", "leave", "result") if cnt.get(k, True)]
    out: Dict[str, str] = {}
    out["count"] = (
        "미인정 %s만 셉니다. 질병·기타·인정 출결은 세지 않습니다." % "·".join(names)
        if names
        else "세는 항목이 없습니다. 하나 이상 고르십시오."
    )
    conv = r["conversion"]
    n = int(conv.get("n", 3) or 3)
    if conv.get("mode") == "simple":
        out["conversion"] = "미인정 %s 횟수를 그대로 더합니다." % "·".join(names) if names else "더할 항목이 없습니다."
    else:
        abs_part = "미인정 결석 1회를 1점으로 칩니다. " if cnt.get("abs", True) else ""
        if others:
            out["conversion"] = (
                abs_part
                + "미인정 %s%s 합쳐 %d회마다 결석 1회로 칩니다. %d회가 안 되어 남은 횟수는 다음 달로 넘어갑니다."
                % ("·".join(others), _eul(others[-1]), n, n)
            )
        else:
            out["conversion"] = abs_part.strip() or "더할 항목이 없습니다."
    out["threshold"] = "초기화 뒤 누적이 %d점 이상이면 대상자 명단에 올립니다." % int(r["threshold"])
    rs = r["reset"]
    if rs.get("enabled", True):
        if rs.get("scope") == "before":
            out["reset"] = "생활지도를 받으면 지도한 달 전까지의 기록을 지우고 지도한 달부터 다시 셉니다. 남아 있던 이월 횟수도 사라집니다."
        else:
            out["reset"] = "생활지도를 받으면 지도한 달까지의 기록을 지우고 다음 달부터 다시 셉니다. 남아 있던 이월 횟수도 사라집니다."
    else:
        out["reset"] = "생활지도를 받아도 누적을 초기화하지 않습니다."
    st = r["stages"]
    k = int(st.get("count", 3) or 3)
    seq = ", ".join("%d회 → %s(%d차)" % (i, st.get("stage_name") or "학년부 생활지도", i + 1) for i in range(k))
    out["stages"] = "지금까지 받은 지도 횟수로 단계를 정합니다: %s, %d회 이상 → %s." % (seq, k, st.get("final_name"))
    lines = [
        out["count"],
        out["conversion"],
        "집계 기간은 화면에서 체크한 달들입니다.",
        out["reset"],
        out["threshold"],
        out["stages"],
        "제외 처리는 학생 × 달마다 적용합니다. 「그 달 전체 제외」는 그 달 기록을 빼고, 「서류 확인 횟수만큼 제외」는 서류 횟수를 뺀 나머지를 누적합니다.",
        "월별 미인정 조회표에는 원자료를 그대로 보여 주고, 제외·초기화는 대상자 명단에만 적용합니다.",
    ]
    out_all = {"parts": out, "summary": lines}
    return out_all
