"""「서류에 없는 내역」 알림 계산 (5-3절). 순수 함수."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from . import rules as R


def compute_alerts(
    records: Dict[int, Dict[str, int]],
    exclusion: Optional[Dict[str, Any]],
    rules: Dict[str, Any],
    guidances: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """제외가 등록된 학생 한 명의 알림 목록.

    1. over: 서류 횟수 방식인 달에 기록이 서류보다 많을 때(서류에 없는 횟수는 누적에 반영됨)
    2. undocumented: 제외 등록 이후의 달에 서류 없이 미인정이 생겼을 때
    3. became_target: 서류에 없는 내역 때문에 대상자 기준을 넘었으면 모든 알림에 표시
    """
    if not exclusion or exclusion.get("all_period"):
        return []
    start = int(rules.get("start_month", 3))
    months_map = exclusion.get("months") or {}
    registered = [int(m) for m, ents in months_map.items() if ents]
    if not registered:
        return []
    first_order = min(R.school_order(m, start) for m in registered)
    out: List[Dict[str, Any]] = []
    for m in R.sort_months(records.keys(), start):
        rec = records[m]
        entries = R.month_entries(exclusion, m)
        reasons = ", ".join(e.get("reason", "") for e in entries if e.get("reason"))
        if entries:
            if any(e.get("mode") == "all" for e in entries):
                continue
            ex = R.apply_exclusion(rec, entries)
            for k in R.ITEMS:
                rawv = ex["raw"][k]
                docv = sum(int((e.get("counts") or {}).get(k, 0) or 0) for e in entries if e.get("mode") == "documented")
                if rawv > docv:
                    out.append({"month": m, "item": k, "recorded": rawv, "documented": docv, "kind": "over", "reason": reasons})
        elif R.school_order(m, start) > first_order:
            for k in R.ITEMS:
                rawv = int(rec.get(k, 0) or 0)
                if rawv > 0:
                    out.append({"month": m, "item": k, "recorded": rawv, "documented": 0, "kind": "undocumented", "reason": ""})
    # 세지 않는 항목은 알림도 만들지 않는다
    cnt = rules.get("count") or {}
    out = [a for a in out if cnt.get(a["item"], True)]
    if out:
        became = _became_target(records, exclusion, rules, guidances or [], out)
        for a in out:
            a["became_target"] = became
    return out


def _became_target(records, exclusion, rules, guidances, alerts) -> bool:
    """지금 대상자인데, 서류에 없는 내역까지 모두 뺐다면 대상자가 아니었을 경우."""
    months = list(records.keys())
    now = R.compute_student(records, months, rules, exclusion, guidances)
    th = int(rules.get("threshold", 3))
    if now["score"] < th:
        return False
    # 알림 횟수만큼 더 뺀 가상의 기록
    adj = {m: dict(v) for m, v in records.items()}
    for a in alerts:
        rec = adj[a["month"]]
        rec[a["item"]] = max(0, int(rec.get(a["item"], 0)) - (a["recorded"] - a["documented"]))
    hypo = R.compute_student(adj, months, rules, exclusion, guidances)
    return hypo["score"] < th


def alert_text(a: Dict[str, Any], name: str = "") -> str:
    label = R.ITEM_LABELS.get(a["item"], a["item"])
    who = ("%s %s · " % (a.get("student_id", ""), name)).lstrip(" ·") if a.get("student_id") else ""
    if a["kind"] == "over":
        return "%s%d월 %s: 기록 %d회 / 서류 %d회 → 서류에 없는 %d회는 누적에 반영됨" % (
            who, a["month"], label, a["recorded"], a["documented"], a["recorded"] - a["documented"])
    return "%s%d월 미인정 %s %d회 — 서류 미등록" % (who, a["month"], label, a["recorded"])
