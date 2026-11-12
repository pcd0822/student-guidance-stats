"""10절 3단계: 규칙 엔진 테스트."""
from app import rules as R
from app.alerts import compute_alerts

RULES = R.merge_rules(None)


def rec(abs=0, late=0, leave=0, result=0):
    return {"abs": abs, "late": late, "leave": leave, "result": result}


# ---------------------------------------------------------------- 이월

def test_carry_over_example():
    records = {9: rec(abs=1, late=2), 10: rec(late=1, leave=3)}
    sep = R.compute_student(records, [9], RULES)
    assert (sep["score"], sep["carry"]) == (1, 2)  # 1 + ⌊2÷3⌋, 지각 2회 이월
    both = R.compute_student(records, [9, 10], RULES)
    assert both["eff"] == rec(abs=1, late=3, leave=3)
    assert (both["score"], both["carry"]) == (3, 0)  # 1 + ⌊6÷3⌋


def test_monthly_conversion_would_differ():
    """달마다 따로 환산해 더하면 1 + 1 = 2점이지만, 기간 전체로 나누면 3점."""
    records = {9: rec(abs=1, late=2), 10: rec(late=1, leave=3)}
    per_month = sum(R.score(r, RULES)[0] for r in records.values())
    assert per_month == 2
    assert R.compute_student(records, [9, 10], RULES)["score"] == 3


def test_simple_mode_uses_same_value_for_display_and_threshold():
    rules = R.merge_rules({"conversion": {"mode": "simple"}})
    res = R.compute_student({9: rec(abs=1, late=2)}, [9], rules)
    assert (res["score"], res["carry"]) == (3, 0)


def test_uncounted_items_are_ignored():
    rules = R.merge_rules({"count": {"result": False}})
    res = R.compute_student({9: rec(late=2, result=5)}, [9], rules)
    assert (res["score"], res["carry"]) == (0, 2)


# ---------------------------------------------------------------- 초기화

def test_reset_drops_carry():
    """9월 지각 2 → 9월 지도 → 10월 지각 1이면 0점, 이월 1"""
    records = {9: rec(late=2), 10: rec(late=1)}
    g = [{"month": 9, "step": 1}]
    res = R.compute_student(records, [9, 10], RULES, guidances=g)
    assert (res["score"], res["carry"]) == (0, 1)
    assert [pm["counted"] for pm in res["months"]] == [False, True]


def test_reset_scope_before():
    rules = R.merge_rules({"reset": {"scope": "before"}})
    records = {8: rec(abs=5), 9: rec(late=2), 10: rec(late=1)}
    res = R.compute_student(records, [8, 9, 10], rules, guidances=[{"month": 9}])
    assert res["eff"] == rec(late=3)


def test_reset_disabled():
    rules = R.merge_rules({"reset": {"enabled": False}})
    res = R.compute_student({9: rec(abs=3)}, [9], rules, guidances=[{"month": 9}])
    assert res["score"] == 3


def test_school_year_order_boundary():
    """12월 지도 → 1월은 다시 센다. 1월 지도는 3~12월을 지운다(달력 순서 버그 수정)."""
    records = {11: rec(abs=2), 12: rec(abs=3), 1: rec(abs=4), 2: rec(abs=1)}
    dec = R.compute_student(records, [11, 12, 1, 2], RULES, guidances=[{"month": 12}])
    assert dec["eff"]["abs"] == 5  # 1·2월만
    jan = R.compute_student(records, [11, 12, 1, 2], RULES, guidances=[{"month": 1}])
    assert jan["eff"]["abs"] == 1  # 2월만
    assert R.school_order(3) == 0 and R.school_order(2) == 11
    assert R.sort_months([1, 12, 3, 2]) == [3, 12, 1, 2]


def test_guidance_in_last_month_counts_nothing():
    res = R.compute_student({2: rec(abs=9)}, [2], RULES, guidances=[{"month": 2}])
    assert res["score"] == 0


# ---------------------------------------------------------------- 차수

def test_stages():
    labels = [R.stage_info(i, RULES)["label"] for i in range(5)]
    assert labels == [
        "학년부 생활지도(1차)", "학년부 생활지도(2차)", "학년부 생활지도(3차)", "학생선도위원회", "학생선도위원회",
    ]


def test_stage_measure_per_grade():
    rules = R.merge_rules({"measures": {"3": {"2": "교내 환경정화활동"}}})
    assert R.stage_info(1, rules, 3)["measure"] == "교내 환경정화활동"
    assert R.stage_info(1, rules, 2)["measure"] == ""
    assert "3학년 1차" in R.missing_measures(rules, [3])


# ---------------------------------------------------------------- 제외

def test_whole_period_exclusion():
    ex = {"all_period": True, "all_reason": "자퇴"}
    res = R.compute_student({4: rec(abs=3), 9: rec(late=6)}, [4, 9], RULES, ex)
    assert res["score"] == 0 and res["raw"] == rec(abs=3, late=6)


def test_month_exclusion_only_hits_that_month():
    """숙려제가 9월뿐이면 4월 미인정은 그대로 센다(기존 버그 1)."""
    ex = {"months": {"9": [{"reason": "숙려제", "mode": "all"}]}}
    res = R.compute_student({4: rec(abs=3), 9: rec(abs=5)}, [4, 9], RULES, ex)
    assert res["eff"]["abs"] == 3


def test_documented_exclusion_keeps_remainder():
    """10월 조퇴 10 중 서류 7 → 3회 누적"""
    ex = {"months": {"10": [{"reason": "학원 수강", "mode": "documented", "counts": {"leave": 7}}]}}
    res = R.compute_student({10: rec(leave=10)}, [10], RULES, ex)
    assert res["eff"]["leave"] == 3 and res["doc"]["leave"] == 7
    assert (res["score"], res["carry"]) == (1, 0)


def test_documented_remainder_carries_over():
    ex = {"months": {"10": [{"reason": "학원 수강", "mode": "documented", "counts": {"leave": 8}}]}}
    res = R.compute_student({10: rec(leave=10), 11: rec(late=1)}, [10, 11], RULES, ex)
    assert (res["score"], res["carry"]) == (1, 0)  # 남은 조퇴 2 + 11월 지각 1 = 3


def test_two_reasons_in_one_month():
    ex = {"months": {"10": [
        {"reason": "학원 수강", "mode": "documented", "counts": {"leave": 5}},
        {"reason": "병원 진료 미처리", "mode": "documented", "counts": {"leave": 2, "abs": 1}},
    ]}}
    res = R.compute_student({10: rec(abs=1, leave=10)}, [10], RULES, ex)
    assert res["eff"] == rec(leave=3)


# ---------------------------------------------------------------- 서류에 없는 내역 알림

def test_alert_record_more_than_documents():
    ex = {"months": {"10": [{"reason": "학원 수강", "mode": "documented", "counts": {"leave": 7}}]}}
    al = compute_alerts({10: rec(leave=10)}, ex, RULES)
    assert len(al) == 1
    a = al[0]
    assert (a["kind"], a["month"], a["item"], a["recorded"], a["documented"]) == ("over", 10, "leave", 10, 7)
    assert a["became_target"] is False  # 3회 = 1점, 기준 3점 미만


def test_alert_new_month_without_documents():
    ex = {"months": {"10": [{"reason": "학원 수강", "mode": "documented", "counts": {"leave": 7}}]}}
    al = compute_alerts({4: rec(abs=1), 10: rec(leave=7), 11: rec(leave=4)}, ex, RULES)
    assert [(a["kind"], a["month"], a["item"], a["recorded"]) for a in al] == [("undocumented", 11, "leave", 4)]
    # 4월(등록보다 앞선 달)은 알림 대상 아님, 10월은 서류와 같아 알림 없음


def test_alert_became_target():
    ex = {"months": {"10": [{"reason": "학원 수강", "mode": "documented", "counts": {"leave": 3}}]}}
    records = {9: rec(abs=2), 10: rec(leave=6)}
    al = compute_alerts(records, ex, RULES)
    assert al and al[0]["became_target"] is True  # 2 + ⌊3÷3⌋ = 3점, 서류에 없는 3회가 없었다면 2점


def test_no_alert_for_all_mode_or_all_period():
    ex = {"months": {"9": [{"reason": "숙려제", "mode": "all"}]}}
    assert compute_alerts({9: rec(abs=5)}, ex, RULES) == []
    assert compute_alerts({9: rec(abs=5)}, {"all_period": True, "all_reason": "자퇴"}, RULES) == []


def test_describe_mentions_carry():
    d = R.describe(RULES)
    assert "3회마다 결석 1회" in d["parts"]["conversion"]
    assert "다음 달로 넘어갑니다" in d["parts"]["conversion"]
    assert "결과를 합쳐" in d["parts"]["conversion"]
