"""학생선도 소위원회 회의록 hwpx 생성 (7-3절).

양식 XML 을 복사해 고치는 방식이다. header.xml(글자·문단·테두리 모양)은 손대지 않고
section0.xml 의 charPrIDRef·paraPrIDRef·borderFillIDRef 를 그대로 다시 쓴다.
"""
from __future__ import annotations

import copy
import io
import random
import struct
import zipfile
import zlib
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

from lxml import etree

from . import paths
from . import rules as R

HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"
OPF = "http://www.idpf.org/2007/opf/"
NS = {"hp": HP}


def q(tag: str) -> str:
    return "{%s}%s" % (HP, tag)


# 표2 한 개에 넣을 학생 수(너비 46510 HWPUNIT 안에서 읽을 수 있게)
STUDENTS_PER_TABLE = 3
LINE_H = 1920  # 글자 한 줄(1200) + 줄 간격(720)


class TemplateError(ValueError):
    pass


# ================================================================ XML 헬퍼

def _drop_lineseg(el: etree._Element) -> None:
    """바꾼 문단의 줄 배치 정보를 지워 한글이 열 때 다시 계산하게 한다."""
    for ls in el.iter(q("linesegarray")):
        ls.getparent().remove(ls)


def set_para_text(p: etree._Element, text: str) -> None:
    """문단의 글자를 바꾼다. 글자가 든 첫 run 만 남기고 나머지 글자 run 은 지운다(표·구역 정보 run 은 유지)."""
    runs = p.findall(q("run"))
    target = None
    for r in runs:
        if r.find(q("secPr")) is not None or r.find(q("tbl")) is not None or r.find(q("ctrl")) is not None:
            continue
        if target is None:
            target = r
        else:
            p.remove(r)
    if target is None:
        # 글자 run 이 없으면 마지막 run 의 글자 모양을 빌려 새로 만든다
        target = etree.SubElement(p, q("run"))
        ref = runs[-1].get("charPrIDRef") if runs else "0"
        target.set("charPrIDRef", ref or "0")
        lsa = p.find(q("linesegarray"))
        if lsa is not None:
            p.remove(lsa)
            p.append(lsa)
    for child in list(target):
        target.remove(child)
    t = etree.SubElement(target, q("t"))
    t.text = text
    _drop_lineseg(p)


def para_text(p: etree._Element) -> str:
    """문단 바로 아래 글자만(안쪽 표 글자는 빼고)."""
    out = []
    for r in p.findall(q("run")):
        for t in r.findall(q("t")):
            out.append("".join(t.itertext()))
    return "".join(out)


def set_cell_lines(tc: etree._Element, lines: Sequence[str]) -> None:
    """셀 안 줄바꿈은 문단을 나눠서 넣는다."""
    sub = tc.find(q("subList"))
    ps = sub.findall(q("p"))
    if not ps:
        raise TemplateError("빈 셀 양식")
    proto = ps[0]
    for p in ps:
        sub.remove(p)
    lines = list(lines) or [""]
    for i, line in enumerate(lines):
        np_ = copy.deepcopy(proto)
        if i:
            np_.set("id", "0")
        set_para_text(np_, line)
        sub.append(np_)


def cell_lines(tc: etree._Element) -> List[str]:
    sub = tc.find(q("subList"))
    return [para_text(p) for p in sub.findall(q("p"))]


def tbl_cells(tbl: etree._Element) -> List[etree._Element]:
    return [tc for tr in tbl.findall(q("tr")) for tc in tr.findall(q("tc"))]


def cell_at(tbl: etree._Element, row: int, col: int) -> etree._Element:
    for tc in tbl_cells(tbl):
        a = tc.find(q("cellAddr"))
        if int(a.get("rowAddr")) == row and int(a.get("colAddr")) == col:
            return tc
    raise TemplateError("양식 표에서 (%d, %d) 칸을 찾지 못했습니다" % (row, col))


def set_geom(tc: etree._Element, row: int, col: int, rs: int, cs: int, w: int, h: int) -> None:
    tc.find(q("cellAddr")).attrib.update({"colAddr": str(col), "rowAddr": str(row)})
    tc.find(q("cellSpan")).attrib.update({"colSpan": str(cs), "rowSpan": str(rs)})
    tc.find(q("cellSz")).attrib.update({"width": str(w), "height": str(h)})


_ids = random.Random()


def _new_id() -> str:
    return str(_ids.randint(1_000_000_000, 2_000_000_000))


# ================================================================ 양식 읽기

class Template:
    def __init__(self, path: Union[str, Path, None] = None, data: Optional[bytes] = None):
        self.data = data if data is not None else Path(path or paths.template_path()).read_bytes()
        with zipfile.ZipFile(io.BytesIO(self.data)) as z:
            self.infos = z.infolist()
            self.files = {i.filename: z.read(i.filename) for i in self.infos}
        if "Contents/section0.xml" not in self.files:
            raise TemplateError("hwpx 양식에 Contents/section0.xml 이 없습니다")

    def section(self) -> etree._Element:
        return etree.fromstring(self.files["Contents/section0.xml"])


def _locate(root: etree._Element) -> Dict[str, Any]:
    """양식에서 고칠 자리를 찾는다."""
    tables = list(root.iter(q("tbl")))
    if len(tables) < 3:
        raise TemplateError("양식에 표가 3개(머리 표·월별 미인정 표·생활지도 표) 있어야 합니다")
    t1 = tables[0]
    content_tc = None
    for tc in tbl_cells(t1):
        if tc.find(q("subList")).find(".//" + q("tbl")) is not None:
            content_tc = tc
            break
    if content_tc is None:
        raise TemplateError("심의 내용 칸을 찾지 못했습니다")
    sub = content_tc.find(q("subList"))
    paras = sub.findall(q("p"))
    tbl_paras = [p for p in paras if p.find(".//" + q("tbl")) is not None]
    # 빈 양식(값이 모두 빈칸)도 받도록 글자 유무가 아니라 문단 종류로 고른다
    no_tbl = [p for p in paras if p.find(".//" + q("tbl")) is None]
    text_paras = [p for p in no_tbl if para_text(p).strip()] or no_tbl
    empty_paras = [p for p in no_tbl if not para_text(p).strip()]
    plain = [p for p in text_paras if p.get("paraPrIDRef") == "0"] or text_paras
    if len(tbl_paras) < 2 or not plain:
        raise TemplateError("심의 내용 칸의 구조가 기본 양식과 다릅니다")
    first_p = root.find(q("p"))
    return {
        "t1": t1,
        "content_tc": content_tc,
        "content_sub": sub,
        "p_text": plain[0],
        "p_empty": empty_paras[0] if empty_paras else plain[0],
        "p_tbl2": tbl_paras[0],
        "p_tbl3": tbl_paras[1],
        "title_p": first_p,
    }


# ================================================================ 표2: 월별 미인정 내역

def _tbl2_protos(tbl: etree._Element) -> Dict[str, etree._Element]:
    return {
        "head_left": cell_at(tbl, 0, 0),
        "head_student": cell_at(tbl, 0, 2),
        "month": cell_at(tbl, 1, 0),
        "label": cell_at(tbl, 1, 1),
        "value": cell_at(tbl, 1, 2),
        "total_left": cell_at(tbl, 3, 0),
        "total_value": cell_at(tbl, 3, 2),
    }


def _col_widths(tbl: etree._Element, ncols: int) -> List[int]:
    ws: Dict[int, int] = {}
    for tc in tbl_cells(tbl):
        if tc.find(q("cellSpan")).get("colSpan") == "1":
            ws[int(tc.find(q("cellAddr")).get("colAddr"))] = int(tc.find(q("cellSz")).get("width"))
    return [ws.get(i, 0) for i in range(ncols)]


def build_tbl2(proto_tbl: etree._Element, students: List[Dict[str, Any]], start_month: int, zorder: int) -> etree._Element:
    pr = _tbl2_protos(proto_tbl)
    total_w = int(proto_tbl.find(q("sz")).get("width"))
    w0, w1 = _col_widths(proto_tbl, 2)
    rest = total_w - w0 - w1
    k = max(1, len(students))
    sw = [rest // k] * k
    sw[-1] += rest - sum(sw)
    widths = [w0, w1] + sw

    h_head = int(pr["head_left"].find(q("cellSz")).get("height"))
    h_row = int(pr["label"].find(q("cellSz")).get("height"))
    months: List[int] = R.sort_months({m["month"] for s in students for m in s.get("months", [])}, start_month)
    max_lines = max([len(s.get("total_lines") or [""]) for s in students] or [1])
    h_total = h_row + (LINE_H - 366) * (max_lines - 1)

    tbl = copy.deepcopy(proto_tbl)
    for tr in tbl.findall(q("tr")):
        tbl.remove(tr)
    tbl.set("id", _new_id())
    tbl.set("zOrder", str(zorder))
    rows: List[etree._Element] = []

    def new_tr():
        tr = etree.Element(q("tr"))
        rows.append(tr)
        return tr

    def put(tr, proto, r, c, rs, cs, h, lines):
        tc = copy.deepcopy(proto)
        set_geom(tc, r, c, rs, cs, sum(widths[c:c + cs]), h)
        set_cell_lines(tc, lines)
        tr.append(tc)

    # 머리행
    tr = new_tr()
    put(tr, pr["head_left"], 0, 0, 1, 2, h_head, ["월별 미인정 내역"])
    for i, s in enumerate(students):
        put(tr, pr["head_student"], 0, 2 + i, 1, 1, h_head, ["%s %s" % (s["student_id"], s["name"])])
    # 달마다 2행
    r = 1
    for m in months:
        by = [next((x for x in s.get("months", []) if x["month"] == m), None) for s in students]
        tr = new_tr()
        put(tr, pr["month"], r, 0, 2, 1, h_row * 2, ["%d월" % m])
        put(tr, pr["label"], r, 1, 1, 1, h_row, ["결석"])
        for i, x in enumerate(by):
            put(tr, pr["value"], r, 2 + i, 1, 1, h_row, [x["abs"] if x else "-"])
        tr = new_tr()
        put(tr, pr["label"], r + 1, 1, 1, 1, h_row, ["지각/조퇴/결과"])
        for i, x in enumerate(by):
            put(tr, pr["value"], r + 1, 2 + i, 1, 1, h_row, [x["others"] if x else "- / - / -"])
        r += 2
    # 총합
    tr = new_tr()
    put(tr, pr["total_left"], r, 0, 1, 2, h_total, ["총합"])
    for i, s in enumerate(students):
        put(tr, pr["total_value"], r, 2 + i, 1, 1, h_total, s.get("total_lines") or [""])
    for tr in rows:
        tbl.append(tr)
    tbl.set("rowCnt", str(len(rows)))
    tbl.set("colCnt", str(len(widths)))
    sz = tbl.find(q("sz"))
    sz.set("width", str(sum(widths)))
    sz.set("height", str(h_head + h_row * 2 * len(months) + h_total))
    return tbl


# ================================================================ 표3: 생활지도 대상자

def build_tbl3(proto_tbl: etree._Element, students: List[Dict[str, Any]], zorder: int) -> etree._Element:
    heads = [cell_at(proto_tbl, 0, c) for c in range(3)]
    bodies = [cell_at(proto_tbl, 1, c) for c in range(3)]
    widths = _col_widths(proto_tbl, 3)
    h_head = int(heads[0].find(q("cellSz")).get("height"))
    h_row = int(bodies[0].find(q("cellSz")).get("height"))
    tbl = copy.deepcopy(proto_tbl)
    for tr in tbl.findall(q("tr")):
        tbl.remove(tr)
    tbl.set("id", _new_id())
    tbl.set("zOrder", str(zorder))
    tr = etree.SubElement(tbl, q("tr"))
    for c, (proto, text) in enumerate(zip(heads, ["학번", "이름", "생활지도 내역"])):
        tc = copy.deepcopy(proto)
        set_geom(tc, 0, c, 1, 1, widths[c], h_head)
        set_cell_lines(tc, [text])
        tr.append(tc)
    for i, s in enumerate(students):
        tr = etree.SubElement(tbl, q("tr"))
        for c, text in enumerate([s["student_id"], s["name"], s.get("measure_text", "")]):
            tc = copy.deepcopy(bodies[c])
            set_geom(tc, i + 1, c, 1, 1, widths[c], h_row)
            set_cell_lines(tc, [text])
            tr.append(tc)
    tbl.set("rowCnt", str(1 + len(students)))
    tbl.set("colCnt", "3")
    tbl.find(q("sz")).set("height", str(h_head + h_row * len(students)))
    return tbl


# ================================================================ 전체 만들기

def _replace_tbl(p: etree._Element, new_tbl: etree._Element) -> etree._Element:
    np_ = copy.deepcopy(p)
    old = np_.find(".//" + q("tbl"))
    old.getparent().replace(old, new_tbl)
    _drop_lineseg(np_)
    return np_


def _text_p(proto: etree._Element, text: str) -> etree._Element:
    np_ = copy.deepcopy(proto)
    np_.set("paraPrIDRef", "0")  # 자동 번호 대신 직접 쓴 번호로 통일
    set_para_text(np_, text)
    return np_


def _height_of(p: etree._Element) -> int:
    t = p.find(".//" + q("tbl"))
    if t is not None:
        return int(t.find(q("sz")).get("height")) + 566 + 720
    return LINE_H


def render_section(tpl: Template, p: Dict[str, Any]) -> etree._Element:
    root = tpl.section()
    loc = _locate(root)
    start = int(p.get("start_month") or 3)

    # 제목
    set_para_text(loc["title_p"], p.get("title", ""))

    # 표1
    t1 = loc["t1"]
    set_cell_lines(cell_at(t1, 0, 1), [p.get("datetime_text", "")])
    set_cell_lines(cell_at(t1, 1, 1), [p.get("place", "")])
    set_cell_lines(cell_at(t1, 2, 2), [p.get("chair", "")])
    set_cell_lines(cell_at(t1, 3, 2), [p.get("members", "")])
    set_cell_lines(cell_at(t1, 4, 1), [p.get("agenda", "")])

    # 심의 내용 칸 다시 채우기
    sub = loc["content_sub"]
    pt, pe = loc["p_text"], loc["p_empty"]
    proto2 = loc["p_tbl2"].find(".//" + q("tbl"))
    proto3 = loc["p_tbl3"].find(".//" + q("tbl"))
    p_tbl2, p_tbl3 = loc["p_tbl2"], loc["p_tbl3"]
    students = p.get("students") or []
    guide = [s for s in students if s.get("kind") == "guidance"]
    dept = p.get("dept_name") or "%s학년부" % p.get("grade", "")

    new: List[etree._Element] = []
    new.append(_text_p(pt, "[안건1: %s]" % p.get("agenda", "")))
    new.append(_text_p(pt, "1. 학생선도 소위원회 회부 학생"))
    new.append(_text_p(pt, "  1) " + p.get("referred_line", "")))
    new.append(_text_p(pt, "2. 학생선도 소위원회 회부 학생 위반 사항(%s 기준)" % p.get("basis_date_text", "")))
    z = 10
    if students:
        for i in range(0, len(students), STUDENTS_PER_TABLE):
            chunk = students[i:i + STUDENTS_PER_TABLE]
            new.append(_replace_tbl(p_tbl2, build_tbl2(proto2, chunk, start, z)))
            z += 1
    else:
        new.append(_text_p(pt, "  해당 학생 없음"))
    empty = copy.deepcopy(pe)
    _drop_lineseg(empty)
    new.append(empty)
    new.append(_text_p(pt, "3. 회부학생 지도 방안"))
    new.append(_text_p(pt, "  1) 위기관리학생에 대한 생활지도 방안: " + p.get("crisis_text", "")))
    new.append(_text_p(pt, "  2) %s 생활지도 운영 계획에 따른 생활지도 대상자" % dept))
    if guide:
        new.append(_replace_tbl(p_tbl3, build_tbl3(proto3, guide, z)))
    else:
        new.append(_text_p(pt, "    해당 학생 없음"))
    empty2 = copy.deepcopy(pe)
    _drop_lineseg(empty2)
    new.append(empty2)

    for old in sub.findall(q("p")):
        sub.remove(old)
    for np_ in new:
        sub.append(np_)

    # 표1 높이 맞추기(심의 내용 칸)
    content_h = sum(_height_of(x) for x in new) + 282
    tc = loc["content_tc"]
    tc.find(q("cellSz")).set("height", str(content_h))
    rows_h: Dict[int, int] = {}
    for c in tbl_cells(t1):
        a, sp, sz = c.find(q("cellAddr")), c.find(q("cellSpan")), c.find(q("cellSz"))
        if sp.get("rowSpan") == "1":
            rows_h[int(a.get("rowAddr"))] = int(sz.get("height"))
    t1.find(q("sz")).set("height", str(sum(rows_h.values())))
    # 표1을 담은 문단과 제목 문단의 줄 배치도 다시 계산
    _drop_lineseg(root)
    return root


def preview_text(p: Dict[str, Any]) -> str:
    """Preview/PrvText.txt 내용(한글 미리보기 글자)."""
    lines = [p.get("title", "")]
    lines.append("<일시><%s>" % p.get("datetime_text", ""))
    lines.append("<장소><%s>" % p.get("place", ""))
    lines.append("<참석자><위원장><%s><위원><%s>" % (p.get("chair", ""), p.get("members", "")))
    lines.append("<심의 안건><%s>" % p.get("agenda", ""))
    lines.append("<심의 내용>")
    body = "[안건1: %s] 1. 학생선도 소위원회 회부 학생 1) %s 2. 학생선도 소위원회 회부 학생 위반 사항(%s 기준)" % (
        p.get("agenda", ""), p.get("referred_line", ""), p.get("basis_date_text", ""))
    lines.append("<" + body)
    for s in p.get("students") or []:
        lines.append("<%s %s> %s" % (s["student_id"], s["name"], " ".join(
            "<%s><결석><%s><지각/조퇴/결과><%s>" % (m["label"], m["abs"], m["others"]) for m in s.get("months", []))))
    lines.append("3. 회부학생 지도 방안 1) 위기관리학생에 대한 생활지도 방안: %s 2) 생활지도 대상자" % p.get("crisis_text", ""))
    for s in p.get("students") or []:
        if s.get("kind") == "guidance":
            lines.append("<%s><%s><%s>" % (s["student_id"], s["name"], s.get("measure_text", "")))
    return "\r\n".join(lines) + "\r\n"


def _blank_png(w: int = 724, h: int = 1024) -> bytes:
    """흰 미리보기 그림(양식에 남아 있던 옛 회의록 그림을 지운다)."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + b"\xff" * w for _ in range(h))  # 회색조 8비트, 흰색
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def _update_hpf(data: bytes, title: str) -> bytes:
    try:
        root = etree.fromstring(data)
    except etree.XMLSyntaxError:
        return data
    for t in root.iter("{%s}title" % OPF):
        t.text = title
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def render_hwpx(payload: Dict[str, Any], template: Optional[Template] = None) -> bytes:
    tpl = template or Template()
    sec = render_section(tpl, payload)
    replaced = {
        "Contents/section0.xml": etree.tostring(sec, xml_declaration=True, encoding="UTF-8", standalone=True),
        "Preview/PrvText.txt": preview_text(payload).encode("utf-8"),
    }
    if "Preview/PrvImage.png" in tpl.files:
        replaced["Preview/PrvImage.png"] = _blank_png()
    if "Contents/content.hpf" in tpl.files:
        replaced["Contents/content.hpf"] = _update_hpf(tpl.files["Contents/content.hpf"], payload.get("title", ""))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        # mimetype 은 첫 항목, 무압축
        mt = tpl.files.get("mimetype", b"application/hwp+zip")
        zi = zipfile.ZipInfo("mimetype", date_time=(1980, 1, 1, 0, 0, 0))
        zi.compress_type = zipfile.ZIP_STORED
        z.writestr(zi, mt)
        for info in tpl.infos:
            if info.filename == "mimetype":
                continue
            data = replaced.get(info.filename, tpl.files[info.filename])
            zi = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            zi.compress_type = info.compress_type
            zi.external_attr = info.external_attr
            z.writestr(zi, data)
    return out.getvalue()


# ================================================================ 검증용 덤프

def dump_section(root: etree._Element) -> List[str]:
    """문단 글자와 표 구조를 텍스트로 펼친다(테스트·검증용).

    자동 번호 문단(paraPrIDRef=23)은 '1. '을 붙여 생성본(직접 쓴 번호)과 비교할 수 있게 한다.
    """
    out: List[str] = []

    def walk_p(p: etree._Element, depth: int):
        txt = para_text(p).strip()
        if p.get("paraPrIDRef") == "23" and txt:
            txt = "1. " + txt
        if txt:
            out.append("  " * depth + txt)
        for r in p.findall(q("run")):
            for t in r.findall(q("tbl")):
                walk_tbl(t, depth)

    def walk_tbl(t: etree._Element, depth: int):
        out.append("  " * depth + "TABLE %sx%s" % (t.get("rowCnt"), t.get("colCnt")))
        for tc in tbl_cells(t):
            a, sp = tc.find(q("cellAddr")), tc.find(q("cellSpan"))
            head = "  " * (depth + 1) + "[%s,%s %sx%s]" % (a.get("rowAddr"), a.get("colAddr"), sp.get("rowSpan"), sp.get("colSpan"))
            sub = tc.find(q("subList"))
            ps = sub.findall(q("p"))
            simple = all(p.find(".//" + q("tbl")) is None for p in ps)
            if simple:
                out.append(head + " " + " ⏎ ".join(para_text(p).strip() for p in ps))
            else:
                out.append(head)
                for p in ps:
                    walk_p(p, depth + 2)

    for p in root.findall(q("p")):
        walk_p(p, 0)
    return out


def check_tables(root: etree._Element) -> List[str]:
    """표 구조가 맞는지(rowCnt·colCnt·칸 주소·병합·너비 합) 검사한다. 문제 목록을 돌려준다."""
    problems = []
    for t in root.iter(q("tbl")):
        rc, cc = int(t.get("rowCnt")), int(t.get("colCnt"))
        if len(t.findall(q("tr"))) != rc:
            problems.append("tbl %s: tr 수 %d ≠ rowCnt %d" % (t.get("id"), len(t.findall(q("tr"))), rc))
        grid = [[0] * cc for _ in range(rc)]
        colw: Dict[int, int] = {}
        for tr_i, tr in enumerate(t.findall(q("tr"))):
            for tc in tr.findall(q("tc")):
                a, sp, sz = tc.find(q("cellAddr")), tc.find(q("cellSpan")), tc.find(q("cellSz"))
                r0, c0 = int(a.get("rowAddr")), int(a.get("colAddr"))
                rs, cs = int(sp.get("rowSpan")), int(sp.get("colSpan"))
                if r0 != tr_i:
                    problems.append("tbl %s: 칸 (%d,%d) 이 %d번째 행에 있음" % (t.get("id"), r0, c0, tr_i))
                for r in range(r0, r0 + rs):
                    for c in range(c0, c0 + cs):
                        if r >= rc or c >= cc:
                            problems.append("tbl %s: 칸 (%d,%d) 범위 밖" % (t.get("id"), r, c))
                        else:
                            grid[r][c] += 1
                if cs == 1:
                    w = int(sz.get("width"))
                    if colw.setdefault(c0, w) != w:
                        problems.append("tbl %s: %d열 너비 불일치" % (t.get("id"), c0))
        for r in range(rc):
            for c in range(cc):
                if grid[r][c] != 1:
                    problems.append("tbl %s: (%d,%d) 덮임 %d번" % (t.get("id"), r, c, grid[r][c]))
        if len(colw) == cc:
            tw = int(t.find(q("sz")).get("width"))
            if sum(colw.values()) != tw:
                problems.append("tbl %s: 열 너비 합 %d ≠ 표 너비 %d" % (t.get("id"), sum(colw.values()), tw))
        for tc in tbl_cells(t):
            sp, sz = tc.find(q("cellSpan")), tc.find(q("cellSz"))
            c0 = int(tc.find(q("cellAddr")).get("colAddr"))
            cs = int(sp.get("colSpan"))
            if cs > 1 and len(colw) == cc:
                exp = sum(colw[c] for c in range(c0, c0 + cs))
                if int(sz.get("width")) != exp:
                    problems.append("tbl %s: 병합 칸 (%s) 너비 %s ≠ %d" % (t.get("id"), c0, sz.get("width"), exp))
    return problems


def read_hwpx_section(data: bytes) -> etree._Element:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return etree.fromstring(z.read("Contents/section0.xml"))


def validate_template(data: bytes) -> None:
    """바꿔 끼울 양식이 쓸 수 있는지 시험 삼아 만들어 본다."""
    tpl = Template(data=data)
    sample = {
        "title": "시험", "datetime_text": "", "place": "", "chair": "", "members": "", "agenda": "", "referred_line": "",
        "basis_date_text": "", "crisis_text": "", "grade": 3, "start_month": 3,
        "students": [{"student_id": "30101", "name": "가", "kind": "guidance", "months": [{"month": 3, "label": "3월", "abs": "1", "others": "- / - / -"}],
                      "total_lines": ["x"], "measure_text": "x"}],
    }
    root = render_section(tpl, sample)
    probs = check_tables(root)
    if probs:
        raise TemplateError("양식 표 구조 문제: " + "; ".join(probs[:3]))
