"""FastAPI 서버. 127.0.0.1 에만 바인딩한다."""
from __future__ import annotations

import io
import json
import secrets
import sqlite3
import threading
import time
import zipfile
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from fastapi import Body, FastAPI, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import __version__, db, minutes, paths
from . import report as RP
from . import roster as RO
from . import rules as R
from . import service as S
from . import share as SH
from .parse_neis import ParseError, normalize_id, parse_file, summarize

@asynccontextmanager
async def _lifespan(_: FastAPI):
    try:
        SH.autostart()  # 공유가 켜져 있었으면 교내망 공유 서버도 다시 연다
    except Exception:  # 공유가 안 열려도 앱은 켜져야 한다
        pass
    yield
    SH.shutdown()


app = FastAPI(title="생활지도·학생선도 통계", docs_url=None, redoc_url=None, openapi_url=None, lifespan=_lifespan)

_previews: Dict[str, Dict[str, Any]] = {}
_previews_lock = threading.Lock()


@app.exception_handler(S.AppError)
def _app_error(_: Request, e: S.AppError):
    return JSONResponse({"detail": e.message, "data": e.data}, status_code=e.status)


@app.exception_handler(ParseError)
def _parse_error(_: Request, e: ParseError):
    return JSONResponse({"detail": str(e)}, status_code=400)


@app.exception_handler(RO.RosterError)
def _roster_error(_: Request, e: RO.RosterError):
    return JSONResponse({"detail": str(e)}, status_code=400)


@app.exception_handler(minutes.TemplateError)
def _tpl_error(_: Request, e: minutes.TemplateError):
    return JSONResponse({"detail": str(e)}, status_code=400)


def _months(s: Optional[str]) -> List[int]:
    if not s:
        return []
    return [int(x) for x in s.split(",") if x.strip().isdigit() and 1 <= int(x) <= 12]


def _year(conn: sqlite3.Connection, y: Optional[int]) -> int:
    return int(y) if y else S.get_settings(conn)["current_year"]


def _download(data: bytes, filename: str, media: str) -> Response:
    return Response(
        data,
        media_type=media,
        headers={"Content-Disposition": "attachment; filename*=UTF-8''%s" % quote(filename)},
    )


# ================================================================ 상태·설정

@app.get("/api/state")
def state(school_year: Optional[int] = None):
    with db.session() as conn:
        s = S.get_settings(conn)
        y = _year(conn, school_year)
        return {
            "version": __version__,
            "settings": s,
            "school_year": y,
            "readonly": y != s["current_year"],
            "school_years": S.school_years(conn),
            "months_by_grade": S.months_by_grade(conn, y),
            "rules_text": R.describe(s["rules"]),
            "missing_measures": R.missing_measures(s["rules"], s["grades"]),
        }


@app.put("/api/settings")
def put_settings(patch: Dict[str, Any] = Body(...)):
    with db.session() as conn:
        s = S.save_settings(conn, patch)
        S.sync_alerts(conn, s["current_year"])
        return s


@app.post("/api/rules/describe")
def rules_describe(rules: Dict[str, Any] = Body(...)):
    r = R.merge_rules(rules)
    return {"text": R.describe(r), "missing_measures": R.missing_measures(r, rules.get("_grades") or [])}


@app.post("/api/school-year")
def new_school_year(body: Dict[str, Any] = Body(...)):
    y = int(body.get("year") or 0)
    if y < 2000 or y > 2100:
        raise S.AppError("학년도가 올바르지 않습니다")
    with db.session() as conn:
        db.set_setting(conn, "current_year", y)
        return S.get_settings(conn)


# ================================================================ 업로드

MULTI_MONTH_MSG = ("이 파일은 %s~%s 기간의 합계라 달별로 나눌 수 없습니다. "
                   "나이스에서 기간을 한 달씩(예: 3/1~3/31) 나눠 내려받아 함께 올리십시오")


def _remember(parsed: Dict[str, Any], summ: Dict[str, Any], file_name: str) -> str:
    token = secrets.token_urlsafe(16)
    with _previews_lock:
        now = time.time()
        for k in [k for k, v in _previews.items() if now - v["t"] > 3600]:
            _previews.pop(k, None)
        _previews[token] = {"t": now, "parsed": parsed, "summary": summ, "file_name": file_name}
    return token


def _preview_one(conn: sqlite3.Connection, data: bytes, file_name: str) -> Dict[str, Any]:
    """파일 하나 미리 읽기. 읽지 못하면 error 를 담아 돌려준다(여러 파일 중 하나가 틀려도 나머지는 보이게)."""
    try:
        parsed = parse_file(data, file_name)
    except ParseError as e:
        return {"file_name": file_name, "ok": False, "error": str(e)}
    s = S.get_settings(conn)
    summ = summarize(parsed, s["rules"]["start_month"])
    y = summ["school_year"] or s["current_year"]
    summ["school_year"] = y
    summ["multi_month"] = len(summ["months"]) > 1
    exist = {}
    for m in summ["months"] or []:
        exist[str(m)] = [e["grade"] for e in S.existing_months(conn, y, [g["grade"] for g in summ["grades"]], m)]
    summ.update({"file_name": file_name, "existing": exist, "ok": not summ["multi_month"]})
    if summ["multi_month"]:
        summ["error"] = MULTI_MONTH_MSG % (summ["period_from"], summ["period_to"])
    summ["token"] = _remember(parsed, summ, file_name)
    return summ


def _item_month(pv: Dict[str, Any], want: Any) -> int:
    """저장할 달. 기간이 한 달이면 그 달, 기간을 못 찾았으면 고른 달. 여러 달이면 거절."""
    months = pv["summary"]["months"]
    if len(months) > 1:
        raise S.AppError("%s: " % pv["file_name"] + MULTI_MONTH_MSG % (pv["summary"]["period_from"], pv["summary"]["period_to"]))
    if len(months) == 1:
        return months[0]
    m = int(want or 0)
    if not 1 <= m <= 12:
        raise S.AppError("%s: 기간을 찾지 못했습니다. 월을 골라 주십시오" % pv["file_name"])
    return m


@app.post("/api/upload/preview")
async def upload_preview(file: UploadFile = File(...)):
    data = await file.read()
    with db.session() as conn:
        r = _preview_one(conn, data, file.filename or "")
    if "token" not in r:
        raise S.AppError(r["error"])
    return r


@app.post("/api/upload/preview-many")
async def upload_preview_many(files: List[UploadFile] = File(...)):
    out = []
    with db.session() as conn:
        for f in files:
            out.append(_preview_one(conn, await f.read(), f.filename or ""))
    return out


@app.post("/api/upload/commit")
def upload_commit(body: Dict[str, Any] = Body(...)):
    items = [{"token": body.get("token"), "month": body.get("month")}]
    res = _commit_items(items, body.get("grades") or [], bool(body.get("overwrite")))
    one = res["files"][0]
    return {"saved": one["saved"], "new_alerts": res["new_alerts"], "school_year": one["school_year"], "month": one["month"]}


@app.post("/api/upload/commit-many")
def upload_commit_many(body: Dict[str, Any] = Body(...)):
    return _commit_items(body.get("items") or [], body.get("grades") or [], bool(body.get("overwrite")))


def _commit_items(items: List[Dict[str, Any]], grades_in: List[Any], overwrite: bool) -> Dict[str, Any]:
    grades = sorted({int(g) for g in grades_in})
    if not grades:
        raise S.AppError("분석할 학년을 하나 이상 고르십시오")
    if not items:
        raise S.AppError("올릴 파일이 없습니다")
    plan = []
    with _previews_lock:
        pvs = [_previews.get(it.get("token") or "") for it in items]
    if any(pv is None for pv in pvs):
        raise S.AppError("미리 읽은 파일이 사라졌습니다. 파일을 다시 골라 주십시오", 410)
    seen: Dict[tuple, str] = {}
    for it, pv in zip(items, pvs):
        m = _item_month(pv, it.get("month"))
        y = int(pv["summary"]["school_year"])
        if (y, m) in seen:
            raise S.AppError("%d월 파일이 두 개입니다: %s, %s" % (m, seen[(y, m)], pv["file_name"]))
        seen[(y, m)] = pv["file_name"]
        plan.append((pv, y, m))
    with db.session() as conn:
        exist = []
        for pv, y, m in plan:
            exist += S.existing_months(conn, y, grades, m)
        if exist and not overwrite:
            raise S.AppError(
                "이미 올린 달입니다: " + ", ".join("%d학년 %d월" % (e["grade"], e["month"]) for e in exist),
                409,
                {"existing": exist},
            )
        files, new_alerts = [], 0
        for pv, y, m in plan:
            r = S.save_upload(conn, pv["parsed"], y, m, grades, pv["file_name"])
            new_alerts += r["new_alerts"]
            files.append({"file_name": pv["file_name"], "school_year": y, "month": m, "saved": r["saved"]})
    with _previews_lock:
        for it in items:
            _previews.pop(it.get("token"), None)
    return {"files": files, "new_alerts": new_alerts}


@app.get("/api/uploads")
def uploads(school_year: Optional[int] = None):
    with db.session() as conn:
        return S.list_uploads(conn, _year(conn, school_year))


@app.delete("/api/uploads/{uid}")
def delete_upload(uid: int):
    with db.session() as conn:
        S.delete_upload(conn, uid)
        return {"ok": True}


# ================================================================ 대시보드

@app.get("/api/dashboard")
def dashboard(grade: int, lookup_months: str = "", target_months: Optional[str] = None, apply: int = 0,
              school_year: Optional[int] = None):
    with db.session() as conn:
        y = _year(conn, school_year)
        tm = _months(target_months) if target_months is not None else S.data_months(conn, y, grade)
        return S.dashboard(conn, y, grade, _months(lookup_months), tm, bool(apply))


# ================================================================ 미인정 현황 공유·내려받기

@app.get("/api/report")
def report_data(school_year: Optional[int] = None):
    with db.session() as conn:
        return RP.build(conn, _year(conn, school_year))


@app.get("/api/report.xlsx")
def report_xlsx(scope: str = "all", grade: Optional[int] = None, cls: Optional[int] = None, sid: Optional[str] = None,
                months: Optional[str] = None, school_year: Optional[int] = None):
    with db.session() as conn:
        d = RP.build(conn, _year(conn, school_year))
    body = RP.to_xlsx(d, scope, grade, cls, sid, _months(months))
    return _download(body, RP.title_of(d, scope, grade, cls, sid) + ".xlsx",
                     "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@app.get("/api/share")
def share_status():
    with db.session() as conn:
        return SH.status(conn)


@app.post("/api/share")
def share_action(body: Dict[str, Any] = Body(...)):
    with db.session() as conn:
        return SH.apply(conn, str(body.get("action") or ""))


@app.get("/api/share/file")
def share_file(school_year: Optional[int] = None):
    with db.session() as conn:
        d = RP.build(conn, _year(conn, school_year))
    stamp = d["generated_at"].replace("-", "").replace(":", "").replace(" ", "_")
    return _download(RP.view_html("file", d).encode("utf-8"), "%d학년도_미인정출결_공유_%s.html" % (d["school_year"], stamp),
                     "text/html; charset=utf-8")


# ================================================================ 학생

@app.get("/api/students/{sid}")
def student(sid: str, school_year: Optional[int] = None):
    with db.session() as conn:
        info = S.student_info(conn, _year(conn, school_year), sid)
        if not info:
            raise S.AppError("학생을 찾지 못했습니다", 404)
        return info


@app.get("/api/personal/{sid}")
def personal(sid: str, school_year: Optional[int] = None):
    with db.session() as conn:
        return S.personal(conn, _year(conn, school_year), sid)


# ================================================================ 학생 명단·학적

@app.get("/api/roster")
def roster_list(school_year: Optional[int] = None, grade: Optional[int] = None):
    with db.session() as conn:
        return {"students": RO.list_roster(conn, _year(conn, school_year), grade), "statuses": RO.STATUSES,
                "leaving": sorted(RO.LEAVING)}


@app.post("/api/roster")
def roster_add(body: Dict[str, Any] = Body(...)):
    with db.session() as conn:
        return RO.save_student(conn, _year(conn, body.get("school_year")), body, create=True)


@app.put("/api/roster/{sid}")
def roster_update(sid: str, body: Dict[str, Any] = Body(...)):
    with db.session() as conn:
        return RO.save_student(conn, _year(conn, body.get("school_year")), dict(body, student_id=sid))


@app.delete("/api/roster/{sid}")
def roster_delete(sid: str, school_year: Optional[int] = None):
    with db.session() as conn:
        RO.delete_student(conn, _year(conn, school_year), sid)
        return {"ok": True}


@app.post("/api/roster/import")
def roster_import(body: Dict[str, Any] = Body(...)):
    with db.session() as conn:
        return RO.import_paste(conn, _year(conn, body.get("school_year")), body.get("text") or "")


# ================================================================ 제외·알림

@app.get("/api/exclusions")
def exclusions(school_year: Optional[int] = None):
    with db.session() as conn:
        return S.list_exclusions(conn, _year(conn, school_year))


@app.put("/api/exclusions")
def save_exclusion(body: Dict[str, Any] = Body(...)):
    with db.session() as conn:
        return S.save_exclusion(conn, _year(conn, body.get("school_year")), body)


@app.post("/api/exclusions/bulk")
def bulk_exclusions(body: Dict[str, Any] = Body(...)):
    with db.session() as conn:
        return S.bulk_add_exclusions(conn, _year(conn, body.get("school_year")), body)


@app.delete("/api/exclusions/{eid}")
def delete_exclusion(eid: int):
    with db.session() as conn:
        S.delete_exclusion(conn, eid)
        return {"ok": True}


@app.get("/api/alerts")
def alerts(school_year: Optional[int] = None, status: Optional[str] = None, grade: Optional[int] = None):
    with db.session() as conn:
        return S.list_alerts(conn, _year(conn, school_year), status, grade)


@app.post("/api/alerts/{aid}/ack")
def ack_alert(aid: int, body: Dict[str, Any] = Body(default={})):
    with db.session() as conn:
        S.ack_alert(conn, aid, "open" if body.get("reopen") else "acknowledged")
        return {"ok": True}


@app.get("/api/alerts/export.xlsx")
def alerts_export(school_year: Optional[int] = None, grade: Optional[int] = None):
    with db.session() as conn:
        y = _year(conn, school_year)
        data = S.alerts_xlsx(conn, y, grade)
    name = "%d학년도_%s서류에_없는_내역.xlsx" % (y, "%d학년_" % grade if grade else "")
    return _download(data, name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


# ================================================================ 생활지도 이력

@app.get("/api/guidance")
def guidance(school_year: Optional[int] = None, grade: Optional[int] = None):
    with db.session() as conn:
        return S.list_guidance(conn, _year(conn, school_year), grade)


@app.post("/api/guidance")
def add_guidance(body: Dict[str, Any] = Body(...)):
    with db.session() as conn:
        return S.save_guidance(conn, _year(conn, body.get("school_year")), body)


@app.put("/api/guidance/{gid}")
def edit_guidance(gid: int, body: Dict[str, Any] = Body(...)):
    with db.session() as conn:
        return S.save_guidance(conn, _year(conn, body.get("school_year")), body, gid)


@app.delete("/api/guidance/{gid}")
def del_guidance(gid: int):
    with db.session() as conn:
        S.delete_guidance(conn, gid)
        return {"ok": True}


@app.post("/api/import-paste")
def import_paste(body: Dict[str, Any] = Body(...)):
    kind = body.get("kind")
    if kind not in ("exclusion", "guidance"):
        raise S.AppError("가져올 종류를 골라 주십시오")
    with db.session() as conn:
        return S.import_paste(conn, _year(conn, body.get("school_year")), kind, body.get("text") or "")


# ================================================================ 회의록

@app.get("/api/meetings")
def meetings(school_year: Optional[int] = None):
    with db.session() as conn:
        return S.list_meetings(conn, _year(conn, school_year))


@app.post("/api/meetings/draft")
def meeting_draft(body: Dict[str, Any] = Body(...)):
    with db.session() as conn:
        y = _year(conn, body.get("school_year"))
        return S.build_draft(conn, y, int(body["grade"]), body.get("student_ids") or [], body.get("basis_month"), body.get("opts") or {})


@app.post("/api/meetings/student-block")
def meeting_student_block(body: Dict[str, Any] = Body(...)):
    with db.session() as conn:
        y = _year(conn, body.get("school_year"))
        return S.student_minutes_block(conn, y, int(body["grade"]), normalize_id(body["student_id"]),
                                       int(body["basis_month"]), bool(body.get("include_year_total")))


@app.post("/api/meetings")
def create_meeting(payload: Dict[str, Any] = Body(...)):
    with db.session() as conn:
        return S.save_meeting(conn, payload)


@app.get("/api/meetings/{mid}")
def get_meeting(mid: int):
    with db.session() as conn:
        return S.get_meeting(conn, mid)


@app.put("/api/meetings/{mid}")
def update_meeting(mid: int, payload: Dict[str, Any] = Body(...)):
    with db.session() as conn:
        return S.save_meeting(conn, payload, mid)


@app.delete("/api/meetings/{mid}")
def delete_meeting(mid: int):
    with db.session() as conn:
        S.delete_meeting(conn, mid)
        return {"ok": True}


@app.post("/api/meetings/{mid}/finalize")
def finalize_meeting(mid: int):
    with db.session() as conn:
        return S.finalize_meeting(conn, mid)


@app.post("/api/meetings/{mid}/unfinalize")
def unfinalize_meeting(mid: int):
    with db.session() as conn:
        return S.unfinalize_meeting(conn, mid)


@app.get("/api/meetings/{mid}/hwpx")
def meeting_hwpx(mid: int):
    with db.session() as conn:
        p = S.get_meeting(conn, mid)["payload"]
    return _download(minutes.render_hwpx(p), S.meeting_filename(p), "application/hwp+zip")


@app.post("/api/meetings/render")
def meeting_render(payload: Dict[str, Any] = Body(...)):
    return _download(minutes.render_hwpx(payload), S.meeting_filename(payload), "application/hwp+zip")


# ================================================================ 양식·백업

@app.get("/api/template")
def template_info():
    custom = paths.custom_template_path()
    return {"custom": custom.exists(), "updated_at": datetime.fromtimestamp(custom.stat().st_mtime).isoformat(timespec="minutes") if custom.exists() else None}


@app.post("/api/template")
async def template_upload(file: UploadFile = File(...)):
    data = await file.read()
    minutes.validate_template(data)
    paths.custom_template_path().write_bytes(data)
    return template_info()


@app.delete("/api/template")
def template_reset():
    p = paths.custom_template_path()
    if p.exists():
        p.unlink()
    return template_info()


@app.get("/api/template/download")
def template_download():
    p = paths.template_path()
    return _download(p.read_bytes(), "회의록_양식.hwpx", "application/hwp+zip")


@app.get("/api/backup")
def backup():
    tmp = paths.tmp_dir() / ("backup_%s.db" % secrets.token_hex(4))
    src = db.connect()
    try:
        dst = sqlite3.connect(str(tmp))
        src.backup(dst)
        dst.close()
        settings = S.get_settings(src)
    finally:
        src.close()
    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(str(tmp), "app.db")
        z.writestr("settings.json", json.dumps(settings, ensure_ascii=False, indent=2))
        z.writestr("meta.json", json.dumps({"app": "생활지도·학생선도 통계", "version": __version__,
                                            "exported_at": datetime.now().isoformat(timespec="seconds")}, ensure_ascii=False))
        if paths.custom_template_path().exists():
            z.write(str(paths.custom_template_path()), "minutes_template.hwpx")
    tmp.unlink()
    name = "생활지도통계_백업_%s.zip" % datetime.now().strftime("%Y%m%d_%H%M")
    return _download(bio.getvalue(), name, "application/zip")


@app.post("/api/restore")
async def restore(file: UploadFile = File(...)):
    data = await file.read()
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise S.AppError("백업 zip 파일이 아닙니다")
    if "app.db" not in z.namelist():
        raise S.AppError("백업 파일에 app.db 가 없습니다")
    tmp = paths.tmp_dir() / ("restore_%s.db" % secrets.token_hex(4))
    tmp.write_bytes(z.read("app.db"))
    try:
        c = sqlite3.connect(str(tmp))
        c.execute("SELECT key FROM settings LIMIT 1")
        c.execute("SELECT id FROM monthly_records LIMIT 1")
        c.close()
    except sqlite3.DatabaseError:
        tmp.unlink()
        raise S.AppError("백업 파일의 데이터가 손상되었습니다")
    # 지금 DB 는 data/backups 에 보관
    bdir = paths.data_dir() / "backups"
    bdir.mkdir(exist_ok=True)
    cur = paths.db_path()
    if cur.exists():
        src = db.connect()
        dst = sqlite3.connect(str(bdir / ("before_restore_%s.db" % datetime.now().strftime("%Y%m%d_%H%M%S"))))
        src.backup(dst)
        dst.close()
        src.close()
    # 복원: sqlite backup API 로 덮어써 열려 있는 WAL 과도 맞춘다
    src = sqlite3.connect(str(tmp))
    dst = sqlite3.connect(str(cur))
    src.backup(dst)
    dst.close()
    src.close()
    tmp.unlink()
    if "minutes_template.hwpx" in z.namelist():
        paths.custom_template_path().write_bytes(z.read("minutes_template.hwpx"))
    db.reset_init_cache()
    with db.session() as conn:
        return {"ok": True, "settings": S.get_settings(conn)}


# ================================================================ 화면

@app.get("/api/health")
def health():
    return {"ok": True, "version": __version__}


if paths.STATIC_DIR.exists() and (paths.STATIC_DIR / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=str(paths.STATIC_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        f = paths.STATIC_DIR / full_path
        if full_path and f.is_file() and paths.STATIC_DIR in f.resolve().parents:
            return FileResponse(str(f))
        return FileResponse(str(paths.STATIC_DIR / "index.html"), headers={"Cache-Control": "no-store"})
else:
    @app.get("/")
    def no_build():
        return Response("<h1>화면 파일이 없습니다</h1><p>frontend 폴더에서 npm run build 를 실행해 주십시오.</p>",
                        media_type="text/html; charset=utf-8")
