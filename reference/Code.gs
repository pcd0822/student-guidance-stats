/**
 * 출결 통계 — 엑셀 업로드 후 월별 시트 + 대상자(미인정) 분석 + 대시보드
 *
 * [대시보드 레이아웃 — 실제 시트 기준]
 *  · B5:K5  = 월 이름(3월~12월),  B6:K6 = 체크박스
 *  · 1️⃣ 월별 미인정 내역 조회 : B9:H9 머리행 / B10:H(끝까지)          ← 스크립트가 채움
 *  · 2️⃣ 생활지도 대상자 제외 처리 : J9:L9 머리행 / J10:L(끝까지)      ← 사람이 입력
 *        J 학번 · K 이름 · L 제외 사유(자퇴생, 숙려제 등)
 *  · 3️⃣ 생활지도 및 학생선도위원회 대상자 명단 : N9:Q9 머리행 / N10:Q(끝까지) ← 스크립트가 채움
 *        N 학번 · O 이름 · P 미인정내역 누적 · Q 해당 선도 종류
 *  · 4️⃣ 생활지도 및 학생선도 집계(수기 입력) : S9:X9 머리행 / S10:X(끝까지)   ← 사람이 입력
 *        S 학번 · T 이름 · U 생활지도1회 · V 2회 · W 3회 · X 학생선도위원회
 *
 * [이번 수정 요지 — 2026.10.12]
 *  1. 행 제한 해제: 1️⃣~4️⃣ 모든 표가 10행부터 시트 마지막 행까지를 대상으로 함.
 *     · 1️⃣·3️⃣(출력)은 이전 결과를 해당 열에서만 지우고, 필요한 만큼 아래로 채움.
 *       시트 행이 모자라면 행을 자동으로 추가함.
 *     · 2️⃣·4️⃣(입력)은 마지막으로 입력된 행까지 모두 읽음.
 *  2. 3️⃣ 명단을 B46:E54 → N10:Q, 4️⃣ 입력을 G46:L54 → S10:X 로 이동.
 *  3. onEdit 감지 범위도 끝 행 제한 없이 열 기준으로 판단.
 *
 * [선도 종류 규칙] 4️⃣ S:X에서 학번(S)이 있는 행의 진행 월 칸(U~X) 개수로 결정
 *   0개 → 학년부 생활지도(1차) / 1개 → (2차) / 2개 → (3차) / 3개 이상 → 학생선도위원회
 */

var ANALYSIS_HEADERS = [
  '학번',
  '이름',
  '미인정 결석',
  '미인정 지각',
  '미인정 조퇴',
  '미인정 결과',
];

var C = {
  ID: 0,
  NAME: 1,
  ABS: 2,
  LATE: 3,
  LEAVE: 4,
  RESULT: 5,
};

/* =========================================================================
 *  대시보드 레이아웃 설정 — 실제 시트와 다르면 이 값만 수정
 *  (끝 행 설정은 없음 — 모든 표가 시트 마지막 행까지 자동 확장)
 * ========================================================================= */
var DASH = {
  SHEET_NAME: '', // ''이면 자동 감지(6행에 체크박스가 있는 시트). 탭 이름을 알면 넣어두면 더 안전.

  // ── 월 체크박스 ──
  CHECKBOX_ROW: 6, // 체크박스 행 (B6:K6)
  MONTH_LABEL_ROW: 5, // 월 이름 행 (B5:K5 = "3월"~"12월")
  CHECKBOX_FIRST_COL: 2, // B열
  CHECKBOX_LAST_COL: 11, // K열
  CHECKBOX_FIRST_MONTH: 3, // 라벨이 비었을 때만 사용(B=3월)

  // ── 1️⃣ 월별 미인정 내역 조회 (B9 머리행 / B10:H 데이터) ──
  LIST_HEADER_ROW: 9, // 머리행
  LIST_START_ROW: 10, // 데이터 시작
  COL_ID: 2, // B 학번
  COL_NAME: 3, // C 이름
  COL_ABS: 4, // D 미인정 결석
  COL_LATE: 5, // E 미인정 지각
  COL_LEAVE: 6, // F 미인정 조퇴
  COL_RESULT: 7, // G 미인정 결과
  COL_TOTAL: 8, // H 합계
  WRITE_TOTAL: true, // H열에 합계를 쓸지 여부(H가 다른 용도면 false)
  TARGET_THRESHOLD: 3, // 3️⃣ 명단 기준: (가중)미인정 누적이 이 값 이상이면 표시

  // 1️⃣ 표에 어디까지 반영할지 — 둘 다 false면 체크된 달의 원자료를 그대로 보여줌
  LIST_APPLY_EXCLUDE: false, // 2️⃣ 제외 처리된 학생을 1️⃣에서도 뺄지
  //  false = 조회 표에는 그대로 남김(권장). 제외는 3️⃣ 명단에서만 적용
  //  true  = 자퇴생 등을 조회 표에서도 감춤
  LIST_APPLY_RESET: false, // 4️⃣ 생활지도 이력으로 1️⃣도 리셋할지
  //  false = 원자료 그대로(권장)
  //  true  = 마지막 생활지도 월 이하는 빼고 보여줌

  // ── 2️⃣ 생활지도 대상자 제외 처리 (사람이 입력, J10:L) ──
  EXCLUDE_START_ROW: 10, // 데이터 시작 (머리행은 9행)
  EXCLUDE_ID_COL: 10, // J 학번
  EXCLUDE_NAME_COL: 11, // K 이름
  EXCLUDE_REASON_COL: 12, // L 제외 사유

  // ── 3️⃣ 대상자 명단 (스크립트 출력, N10:Q) ──
  TARGET_START_ROW: 10,
  TARGET_ID_COL: 14, // N 학번
  TARGET_NAME_COL: 15, // O 이름
  TARGET_CALC_COL: 16, // P 미인정내역 누적
  TARGET_OUT_COL: 17, // Q 해당 선도 종류

  // ── 4️⃣ 생활지도 및 학생선도 집계 (사람이 입력, S10:X) ──
  SUNDO_START_ROW: 10,
  SUNDO_ID_COL: 19, // S 학번
  SUNDO_NAME_COL: 20, // T 이름
  SUNDO_MONTH_FIRST_COL: 21, // U 생활지도 1회
  SUNDO_MONTH_LAST_COL: 24, // X 학생선도위원회

  SUNDO_CALC_WEIGHTED: true, // true=결석 + INT((지각+조퇴+결과)/3), false=단순합
};

var SUNDO_LABELS = {
  0: '학년부 생활지도(1차)',
  1: '학년부 생활지도(2차)',
  2: '학년부 생활지도(3차)',
  3: '학생선도위원회', // 3개 이상
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('출결관리')
    .addItem('출결 통계 자료 업로드', 'showUploadDialog')
    .addItem('개인별 통계 보기', 'showPersonalStatsDialog')
    .addSeparator()
    .addItem('★ 대시보드 초기화(수식 제거 후 채우기)', 'setupDashboard')
    .addItem('전체 새로고침(제외 처리 반영)', 'refreshAll')
    .addItem('1️⃣ 미인정 내역 새로고침(체크된 월)', 'refreshTargetSum')
    .addItem('3️⃣ 대상자 명단 갱신(N:Q)', 'refreshSundoTypes')
    .addToUi();
}

/* =========================================================================
 *  onEdit — 체크박스 토글 / 제외 처리 / 선도 입력에 반응
 *  (끝 행 제한 없음 — 10행 아래 어디를 편집해도 열 범위로 판단)
 * ========================================================================= */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    if (!isDashboardSheet_(sheet)) return;

    var r1 = e.range.getRow();
    var r2 = e.range.getLastRow();
    var c1 = e.range.getColumn();
    var c2 = e.range.getLastColumn();

    // (1) 월 체크박스 행과 겹치면 → 1️⃣ + 3️⃣ 모두 갱신
    if (
      r1 <= DASH.CHECKBOX_ROW &&
      r2 >= DASH.CHECKBOX_ROW &&
      c1 <= DASH.CHECKBOX_LAST_COL &&
      c2 >= DASH.CHECKBOX_FIRST_COL
    ) {
      recomputeTargetSum_(sheet);
      recomputeSundoTypes_(sheet);
      return;
    }

    // (2) 2️⃣ 제외 처리 영역(J10:L)과 겹치면 → 1️⃣ + 3️⃣ 갱신
    if (
      r2 >= DASH.EXCLUDE_START_ROW &&
      c1 <= DASH.EXCLUDE_REASON_COL &&
      c2 >= DASH.EXCLUDE_ID_COL
    ) {
      if (DASH.LIST_APPLY_EXCLUDE) recomputeTargetSum_(sheet);
      recomputeSundoTypes_(sheet);
      return;
    }

    // (3) 4️⃣ 선도 입력 영역(S10:X)과 겹치면 → 3️⃣ 갱신
    //     1️⃣도 리셋을 쓰도록 설정했다면 함께 갱신
    if (
      r2 >= DASH.SUNDO_START_ROW &&
      c1 <= DASH.SUNDO_MONTH_LAST_COL &&
      c2 >= DASH.SUNDO_ID_COL
    ) {
      if (DASH.LIST_APPLY_RESET) recomputeTargetSum_(sheet);
      recomputeSundoTypes_(sheet);
    }
  } catch (err) {
    // 간단 트리거에서는 조용히 무시
  }
}

/** 메뉴: 대시보드 초기화 — 겹치는 배열 수식(B9·N10) 제거 후 스크립트로 채움 */
function setupDashboard() {
  var sheet = resolveDashboardSheet_();
  if (!sheet) {
    SpreadsheetApp.getUi().alert('대시보드 시트를 찾지 못했습니다. DASH.SHEET_NAME 을 설정하세요.');
    return;
  }
  // 배열 수식의 앵커 셀을 지우면 펼쳐진 결과가 통째로 사라짐
  sheet.getRange(DASH.LIST_HEADER_ROW, DASH.COL_ID).clearContent(); // B9 (명단 수식)
  sheet.getRange(DASH.TARGET_START_ROW, DASH.TARGET_ID_COL).clearContent(); // N10 (대상자 명단 수식)
  SpreadsheetApp.flush();

  recomputeTargetSum_(sheet);
  recomputeSundoTypes_(sheet);
  SpreadsheetApp.getActiveSpreadsheet().toast('배열 수식 제거 후 채우기 완료', '대시보드 초기화', 5);
}

/** 메뉴: 1️⃣ + 3️⃣ 한꺼번에 새로고침 */
function refreshAll() {
  var sheet = resolveDashboardSheet_();
  if (!sheet) {
    SpreadsheetApp.getUi().alert('대시보드 시트를 찾지 못했습니다. DASH.SHEET_NAME 을 설정하세요.');
    return;
  }
  var listCount = recomputeTargetSum_(sheet);
  var sundoCount = recomputeSundoTypes_(sheet);
  var exCount = Object.keys(readExcluded_(sheet)).length;
  SpreadsheetApp.getActiveSpreadsheet().toast(
    '조회 ' + listCount + '명 / 대상자 ' + sundoCount + '명 / 제외 ' + exCount + '명',
    '전체 새로고침',
    5
  );
}

/** 메뉴: 1️⃣ 미인정 내역 수동 새로고침 */
function refreshTargetSum() {
  var sheet = resolveDashboardSheet_();
  if (!sheet) {
    SpreadsheetApp.getUi().alert('대시보드 시트를 찾지 못했습니다. DASH.SHEET_NAME 을 설정하세요.');
    return;
  }
  var n = recomputeTargetSum_(sheet);
  SpreadsheetApp.getActiveSpreadsheet().toast('체크된 월 기준 ' + n + '명 합산 완료', '미인정 합산', 4);
}

/** 메뉴: 3️⃣ 대상자 명단 수동 갱신 */
function refreshSundoTypes() {
  var sheet = resolveDashboardSheet_();
  if (!sheet) {
    SpreadsheetApp.getUi().alert('대시보드 시트를 찾지 못했습니다. DASH.SHEET_NAME 을 설정하세요.');
    return;
  }
  var n = recomputeSundoTypes_(sheet);
  SpreadsheetApp.getActiveSpreadsheet().toast('선도 대상 ' + n + '명 자동 선별 완료', '선도 명단', 4);
}

/* =========================================================================
 *  행 제한 없는 범위 처리 헬퍼
 * ========================================================================= */

/**
 * startRow부터 시트의 마지막 데이터 행까지, firstCol~lastCol 값을 읽음.
 * 데이터가 없으면 [] 반환.
 */
function readOpenBlock_(sheet, startRow, firstCol, lastCol) {
  var lastRow = sheet.getLastRow();
  if (lastRow < startRow) return [];
  var numCols = lastCol - firstCol + 1;
  if (numCols < 1) return [];
  if (firstCol > sheet.getMaxColumns()) return [];
  if (lastCol > sheet.getMaxColumns()) numCols = sheet.getMaxColumns() - firstCol + 1;
  return sheet.getRange(startRow, firstCol, lastRow - startRow + 1, numCols).getValues();
}

/**
 * startRow부터 시트 마지막 데이터 행까지, firstCol부터 width개 열의 내용만 지움.
 * (서식·다른 열은 그대로)
 */
function clearOpenBlock_(sheet, startRow, firstCol, width) {
  var lastRow = sheet.getLastRow();
  if (lastRow < startRow || width < 1) return;
  sheet.getRange(startRow, firstCol, lastRow - startRow + 1, width).clearContent();
}

/** 쓰려는 마지막 행이 시트 최대 행을 넘으면 그만큼 행을 추가 */
function ensureRows_(sheet, needLastRow) {
  var maxRows = sheet.getMaxRows();
  if (needLastRow > maxRows) {
    sheet.insertRowsAfter(maxRows, needLastRow - maxRows);
  }
}

/**
 * 미인정 가중 합계
 *  · 미인정 결석 1회 = 1
 *  · 미인정 지각·조퇴·결과는 합계 3회당 1 (버림)
 *  예) 결석1·지각2·조퇴1·결과0 → 1 + INT(3/3) = 2
 */
function disciplineTotal_(abs, late, leave, result) {
  var a = toCount_(abs);
  var others = toCount_(late) + toCount_(leave) + toCount_(result);
  return a + Math.floor(others / 3);
}

/**
 * 학번 표기 통일 — 숫자만 남기고 5자리로 0을 채움
 *  "30413", 30413, "3-04-13", " 30413 " → "30413"
 */
function normalizeId_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var s = String(v).replace(/[^0-9]/g, '');
  if (!s) return '';
  while (s.length < 5) s = '0' + s;
  return s;
}

/** "5월", "5", 5 → 5 (1~12 사이 유효한 월만). 유효 월이 없으면 0(리셋 없음) */
function parseMonthNum_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  var matches = String(v).match(/\d+/g);
  if (!matches) return 0;
  var i;
  for (i = 0; i < matches.length; i++) {
    var n = parseInt(matches[i], 10);
    if (n >= 1 && n <= 12) return n; // 1~12 인 값만 월로 인정
  }
  return 0;
}

/**
 * 2️⃣ 생활지도 대상자 제외 처리 J10:L(끝까지) → { 학번: {name, reason} }
 *  · J열에 학번이 적혀 있으면 그 학생은 3️⃣ 명단에서 빠짐
 *  · 사유(L)는 비어 있어도 제외됨 — 학번만으로 판단
 */
function readExcluded_(dashSheet) {
  var firstCol = DASH.EXCLUDE_ID_COL;
  var vals = readOpenBlock_(dashSheet, DASH.EXCLUDE_START_ROW, firstCol, DASH.EXCLUDE_REASON_COL);
  var idIdx = DASH.EXCLUDE_ID_COL - firstCol;
  var nameIdx = DASH.EXCLUDE_NAME_COL - firstCol;
  var reasonIdx = DASH.EXCLUDE_REASON_COL - firstCol;

  var map = {};
  var r;
  for (r = 0; r < vals.length; r++) {
    var row = vals[r];
    var id = normalizeId_(row[idIdx]);
    if (!id) continue;
    map[id] = {
      name: nameIdx < row.length ? String(row[nameIdx] == null ? '' : row[nameIdx]).trim() : '',
      reason:
        reasonIdx < row.length ? String(row[reasonIdx] == null ? '' : row[reasonIdx]).trim() : '',
    };
  }
  return map;
}

/**
 * 4️⃣ 선도 기록 S10:X(끝까지) → 학번별 { lastMonth, count }
 *  · lastMonth: U~X 중 가장 늦은 생활지도 월(리셋 기준)
 *  · count: 입력된 생활지도 월 개수(선도 차수 결정)
 */
function readGuidance_(dashSheet) {
  var firstCol = DASH.SUNDO_ID_COL;
  var input = readOpenBlock_(dashSheet, DASH.SUNDO_START_ROW, firstCol, DASH.SUNDO_MONTH_LAST_COL);

  var idIdx = DASH.SUNDO_ID_COL - firstCol;
  var mFirst = DASH.SUNDO_MONTH_FIRST_COL - firstCol;
  var mLast = DASH.SUNDO_MONTH_LAST_COL - firstCol;

  var map = {};
  var r;
  for (r = 0; r < input.length; r++) {
    var row = input[r];
    var id = normalizeId_(row[idIdx]);
    if (!id) continue;
    var maxM = 0;
    var cnt = 0;
    var c;
    for (c = mFirst; c <= mLast && c < row.length; c++) {
      var v = row[c];
      if (v !== '' && v !== null && v !== undefined && String(v).trim() !== '') {
        cnt++;
        var mn = parseMonthNum_(v);
        if (mn > maxM) maxM = mn;
      }
    }
    if (!map[id]) map[id] = { lastMonth: 0, count: 0 };
    if (maxM > map[id].lastMonth) map[id].lastMonth = maxM;
    map[id].count += cnt;
  }
  return map;
}

/* =========================================================================
 *  체크된 월 → 학번별 미인정 합산(공용)
 *  opts = { applyReset: bool, applyExclude: bool }
 * ========================================================================= */
function computeCheckedMonthSum_(dashSheet, opts) {
  var options = opts || {};
  var applyReset = options.applyReset === true;
  var applyExclude = options.applyExclude !== false; // 기본 true

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var checked = getCheckedMonths_(dashSheet); // [{label, month}]
  var guidanceMap = applyReset ? readGuidance_(dashSheet) : {};
  var excluded = applyExclude ? readExcluded_(dashSheet) : {};
  var byId = {};

  var mi;
  for (mi = 0; mi < checked.length; mi++) {
    var monthNum = checked[mi].month;
    var sh = ss.getSheetByName(checked[mi].label);
    if (!sh) continue;
    var matrix = sh.getDataRange().getValues();
    if (!matrix.length) continue;
    var list = buildTargetAnalysis(matrix); // 학번별 미인정(월별) 추출
    var i;
    for (i = 0; i < list.length; i++) {
      var t = list[i];
      var sid = normalizeId_(t.studentId);
      if (!sid) continue;

      // (A) 2️⃣ 제외 처리: 학번이 등록돼 있으면 집계에 넣지 않음
      if (excluded[sid]) continue;

      // (B) 4️⃣ 생활지도 이력 리셋: 마지막 생활지도 월 이하는 제외
      var g = guidanceMap[sid];
      var resetMonth = g ? g.lastMonth : 0;
      if (monthNum <= resetMonth) continue;

      if (!byId[sid]) {
        byId[sid] = { name: String(t.name || ''), abs: 0, late: 0, leave: 0, result: 0 };
      }
      byId[sid].abs += toCount_(t.abs);
      byId[sid].late += toCount_(t.late);
      byId[sid].leave += toCount_(t.leave);
      byId[sid].result += toCount_(t.result);
      if (!byId[sid].name && t.name) byId[sid].name = String(t.name);
    }
  }

  // 가중 누적(H·P 표시값·명단 기준값)
  var k;
  for (k in byId) {
    if (byId.hasOwnProperty(k)) {
      var s = byId[k];
      s.weighted = disciplineTotal_(s.abs, s.late, s.leave, s.result);
    }
  }
  return { checkedMonths: checked, guidanceMap: guidanceMap, excluded: excluded, byId: byId };
}

/** 체크박스(B6:K6) → 체크된 월 [{label, month}] (B5:K5 이름 사용) */
function getCheckedMonths_(dashSheet) {
  var numCols = DASH.CHECKBOX_LAST_COL - DASH.CHECKBOX_FIRST_COL + 1;
  var checks = dashSheet
    .getRange(DASH.CHECKBOX_ROW, DASH.CHECKBOX_FIRST_COL, 1, numCols)
    .getValues()[0];
  var labels = dashSheet
    .getRange(DASH.MONTH_LABEL_ROW, DASH.CHECKBOX_FIRST_COL, 1, numCols)
    .getValues()[0];
  var out = [];
  var i;
  for (i = 0; i < checks.length; i++) {
    if (checks[i] === true) {
      var lab = String(labels[i] == null ? '' : labels[i]).trim();
      var month = parseMonthNum_(lab);
      if (!lab) {
        month = DASH.CHECKBOX_FIRST_MONTH + i;
        lab = month + '월';
      }
      out.push({ label: lab, month: month });
    }
  }
  return out;
}

/* =========================================================================
 *  (1) 체크된 월 → 미인정 합산 → 머리행(B9) + B10:H(끝까지)
 *      · 미인정이 있는 학생 전원을 행 제한 없이 표시
 *      · B:H 열만 지우고 다시 씀 — 2️⃣·3️⃣·4️⃣ 영역은 건드리지 않음
 * ========================================================================= */
function recomputeTargetSum_(dashSheet) {
  var res = computeCheckedMonthSum_(dashSheet, {
    applyReset: DASH.LIST_APPLY_RESET,
    applyExclude: DASH.LIST_APPLY_EXCLUDE,
  });
  var byId = res.byId;

  // 머리행(9행) 항상 기록 — 삭제된 B9 배열 수식을 대체
  var header = ANALYSIS_HEADERS.slice();
  if (DASH.WRITE_TOTAL) header.push('합계');
  dashSheet.getRange(DASH.LIST_HEADER_ROW, DASH.COL_ID, 1, header.length).setValues([header]);

  var ids = Object.keys(byId); // 미인정이 있는 학생 전원(임계값 필터 없음)
  ids.sort(function (a, b) {
    return String(a).localeCompare(String(b));
  });

  var width = (DASH.WRITE_TOTAL ? DASH.COL_TOTAL : DASH.COL_RESULT) - DASH.COL_ID + 1;

  // 이전 결과 비우기(B:H 열, 10행~마지막 행)
  clearOpenBlock_(dashSheet, DASH.LIST_START_ROW, DASH.COL_ID, width);

  if (!ids.length) return 0;

  var out = [];
  var k;
  for (k = 0; k < ids.length; k++) {
    var s = byId[ids[k]];
    var row = [ids[k], s.name, s.abs, s.late, s.leave, s.result];
    if (DASH.WRITE_TOTAL) row.push(disciplineTotal_(s.abs, s.late, s.leave, s.result));
    out.push(row);
  }
  ensureRows_(dashSheet, DASH.LIST_START_ROW + out.length - 1);
  dashSheet.getRange(DASH.LIST_START_ROW, DASH.COL_ID, out.length, width).setValues(out);
  return ids.length;
}

/* =========================================================================
 *  (2) 자동 선도 대상 명단 → N10:Q(끝까지)
 *      · 2️⃣ 제외 처리된 학생은 무조건 빠짐
 *      · 4️⃣ 생활지도 이력 리셋 적용 후 가중 누적 ≥ TARGET_THRESHOLD 인 학생만 표시
 *      · N=학번, O=이름, P=누적, Q=선도 종류(S~X에 기록된 생활지도 횟수 기준)
 *      · S~X(수기 입력 영역)은 스크립트가 건드리지 않음
 * ========================================================================= */
function recomputeSundoTypes_(dashSheet) {
  var res = computeCheckedMonthSum_(dashSheet, { applyReset: true, applyExclude: true });
  var byId = res.byId;
  var excluded = res.excluded;
  var guidance = res.guidanceMap; // {학번: {lastMonth, count}}

  var ids = Object.keys(byId).filter(function (id) {
    if (excluded[id]) return false; // 이중 안전장치
    return byId[id].weighted >= DASH.TARGET_THRESHOLD;
  });
  ids.sort(function (a, b) {
    return String(a).localeCompare(String(b));
  });

  var startRow = DASH.TARGET_START_ROW;
  var firstCol = DASH.TARGET_ID_COL; // N
  var width = DASH.TARGET_OUT_COL - DASH.TARGET_ID_COL + 1; // N~Q = 4

  // 3️⃣ 명단(N:Q)만 비움 — 4️⃣ 입력(S:X)은 유지
  clearOpenBlock_(dashSheet, startRow, firstCol, width);

  if (!ids.length) return 0;

  var out = [];
  var k;
  for (k = 0; k < ids.length; k++) {
    var id = ids[k];
    var s = byId[id];
    var cnt = guidance[id] ? guidance[id].count : 0;
    var label = cnt >= 3 ? SUNDO_LABELS[3] : SUNDO_LABELS[cnt];
    var d = DASH.SUNDO_CALC_WEIGHTED ? s.weighted : s.abs + s.late + s.leave + s.result;
    out.push([id, s.name, d, label]); // N, O, P, Q
  }
  ensureRows_(dashSheet, startRow + out.length - 1);
  dashSheet.getRange(startRow, firstCol, out.length, width).setValues(out);
  return ids.length;
}

/* =========================================================================
 *  대시보드 시트 찾기
 * ========================================================================= */
function isDashboardSheet_(sheet) {
  if (!sheet) return false;
  var name = sheet.getName();
  if (DASH.SHEET_NAME) return name === DASH.SHEET_NAME;
  if (/^\d{1,2}월$/.test(name)) return false;
  if (name === '대상자 분석') return false;
  // 6행에 체크박스(불리언)가 있으면 대시보드로 인식
  try {
    var numCols = DASH.CHECKBOX_LAST_COL - DASH.CHECKBOX_FIRST_COL + 1;
    var rowVals = sheet
      .getRange(DASH.CHECKBOX_ROW, DASH.CHECKBOX_FIRST_COL, 1, numCols)
      .getValues()[0];
    var i;
    for (i = 0; i < rowVals.length; i++) {
      if (typeof rowVals[i] === 'boolean') return true;
    }
  } catch (e) {}
  try {
    var h = sheet.getRange(DASH.LIST_HEADER_ROW, DASH.COL_ID).getValue();
    if (String(h).trim() === '학번') return true;
  } catch (e) {}
  return false;
}

function resolveDashboardSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (DASH.SHEET_NAME) return ss.getSheetByName(DASH.SHEET_NAME);
  var active = ss.getActiveSheet();
  if (isDashboardSheet_(active)) return active;
  var sheets = ss.getSheets();
  var i;
  for (i = 0; i < sheets.length; i++) {
    if (isDashboardSheet_(sheets[i])) return sheets[i];
  }
  return null;
}

/* =========================================================================
 *  ↓↓↓ 이하 업로드 / 개인별 통계 / 헬퍼 (변경 없음)
 * ========================================================================= */

function showUploadDialog() {
  var html = HtmlService.createTemplateFromFile('UploadDialog')
    .evaluate()
    .setWidth(520)
    .setHeight(440)
    .setSandboxMode(HtmlService.SandboxMode.IFRAME);
  SpreadsheetApp.getUi().showModalDialog(html, '출결 통계 자료 업로드');
}

function showPersonalStatsDialog() {
  var html = HtmlService.createHtmlOutputFromFile('PersonalStatsDialog')
    .setWidth(720)
    .setHeight(560)
    .setSandboxMode(HtmlService.SandboxMode.IFRAME);
  SpreadsheetApp.getUi().showModalDialog(html, '개인별 통계');
}

function processAttendanceData(sheetRows, monthLabel) {
  if (!coerceToRowArray_(sheetRows).length) {
    throw new Error('시트 데이터가 비어 있습니다.');
  }
  var rows = normalizeRows(sheetRows);
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var monthName = String(monthLabel || '').trim() || '업로드';
  ensureSheet(ss, monthName);
  var monthSh = ss.getSheetByName(monthName);
  monthSh.clear();
  if (rows.length) {
    setValues2D_(monthSh, 1, 1, rows);
  }

  var targets = buildTargetAnalysis(rows);
  var analysisName = '대상자 분석';
  ensureSheet(ss, analysisName);
  var an = ss.getSheetByName(analysisName);

  var existingMap = readExistingAnalysisMap_(an);
  var analysisRows = mergeAndBuildAnalysisRows_(existingMap, targets);
  analysisRows = trimAnalysisOutputRows_(analysisRows);

  an.clear();
  setValues2D_(an, 1, 1, analysisRows);
  SpreadsheetApp.flush();

  return {
    monthSheet: monthName,
    targetCount: targets.length,
    analysisRows: analysisRows.length - 1,
  };
}

function readExistingAnalysisMap_(sheet) {
  var map = {};
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return map;
  var lastCol = Math.max(sheet.getLastColumn(), ANALYSIS_HEADERS.length);
  var vals = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  if (!vals.length || vals[0].length < 2) return map;
  var header = vals[0];
  var idCol = findHeaderIndex_(header, '학번');
  var nameCol = findHeaderIndex_(header, '이름');
  if (idCol < 0) return map;
  var r;
  for (r = 1; r < vals.length; r++) {
    var row = vals[r];
    var nameCell = nameCol >= 0 ? String(row[nameCol] || '').trim() : '';
    if (isSummaryTotalRow_(nameCell, '', '')) continue;
    var id = String(row[idCol] || '').replace(/\s/g, '');
    if (!id) continue;
    var normalized = normalizeAnalysisRowFromSheet_(header, row);
    map[id] = normalized;
  }
  return map;
}

function findHeaderIndex_(headerRow, name) {
  var i;
  for (i = 0; i < headerRow.length; i++) {
    if (String(headerRow[i]).trim() === name) return i;
  }
  return -1;
}

function normalizeAnalysisRowFromSheet_(headerRow, row) {
  var out = [];
  var i;
  var idCol = findHeaderIndex_(headerRow, '학번');
  var nameCol = findHeaderIndex_(headerRow, '이름');
  var absCol = findHeaderIndex_(headerRow, '미인정 결석');
  var lateCol = findHeaderIndex_(headerRow, '미인정 지각');
  var leaveCol = findHeaderIndex_(headerRow, '미인정 조퇴');
  var resCol = findHeaderIndex_(headerRow, '미인정 결과');
  var byName =
    idCol >= 0 && nameCol >= 0 && absCol >= 0 && lateCol >= 0 && leaveCol >= 0 && resCol >= 0;
  if (byName) {
    out[C.ID] = idCol < row.length ? row[idCol] : '';
    out[C.NAME] = nameCol < row.length ? row[nameCol] : '';
    out[C.ABS] = absCol < row.length ? row[absCol] : '';
    out[C.LATE] = lateCol < row.length ? row[lateCol] : '';
    out[C.LEAVE] = leaveCol < row.length ? row[leaveCol] : '';
    out[C.RESULT] = resCol < row.length ? row[resCol] : '';
    return out;
  }
  for (i = 0; i < ANALYSIS_HEADERS.length; i++) {
    out[i] = i < row.length ? row[i] : '';
  }
  return out;
}

function mergeAndBuildAnalysisRows_(existingById, newTargets) {
  var byId = {};
  var k;
  for (k in existingById) {
    if (existingById.hasOwnProperty(k)) {
      byId[k] = existingById[k].slice();
    }
  }

  var ti;
  for (ti = 0; ti < newTargets.length; ti++) {
    var t = newTargets[ti];
    var sid = String(t.studentId);
    var prev = byId[sid];
    var thisAbs = toCount_(t.abs);
    var thisLate = toCount_(t.late);
    var thisLeave = toCount_(t.leave);
    var thisRes = toCount_(t.result);

    var cumAbs;
    var cumLate;
    var cumLeave;
    var cumRes;

    if (!prev) {
      cumAbs = thisAbs;
      cumLate = thisLate;
      cumLeave = thisLeave;
      cumRes = thisRes;
    } else {
      cumAbs = toCount_(prev[C.ABS]) + thisAbs;
      cumLate = toCount_(prev[C.LATE]) + thisLate;
      cumLeave = toCount_(prev[C.LEAVE]) + thisLeave;
      cumRes = toCount_(prev[C.RESULT]) + thisRes;
    }

    var name = prev ? String(prev[C.NAME] || t.name) : String(t.name);

    byId[sid] = [sid, name, cumAbs, cumLate, cumLeave, cumRes];
  }

  var ids = Object.keys(byId);
  ids.sort(function (a, b) {
    return String(a).localeCompare(String(b));
  });

  var out = [ANALYSIS_HEADERS.slice()];
  var ii;
  for (ii = 0; ii < ids.length; ii++) {
    var src = byId[ids[ii]];
    if (!src) continue;
    var rowOut = src.slice();
    while (rowOut.length < ANALYSIS_HEADERS.length) {
      rowOut.push('');
    }
    out.push(rowOut);
  }
  return out;
}

function trimAnalysisOutputRows_(out) {
  if (!out || out.length < 2) return out;
  while (out.length > 1) {
    var last = out[out.length - 1];
    if (!last) {
      out.pop();
      continue;
    }
    var id = String(last[C.ID] != null ? last[C.ID] : '').replace(/\s/g, '');
    var name = String(last[C.NAME] != null ? last[C.NAME] : '').trim();
    if (isSummaryTotalRow_(name, '', '')) {
      out.pop();
      continue;
    }
    if (!id && !name) {
      out.pop();
      continue;
    }
    break;
  }
  return out;
}

function toCount_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  if (typeof v === 'number' && !isNaN(v)) return Math.max(0, Math.floor(v));
  var s = String(v).replace(/\s/g, '').replace(/,/g, '');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : Math.max(0, Math.floor(n));
}

function normalizeRows(sheetRows) {
  var input = coerceToRowArray_(sheetRows);
  var maxCol = 0;
  var i;
  var rows = [];
  for (i = 0; i < input.length; i++) {
    rows.push(coerceToCellArray_(input[i]));
  }
  for (i = 0; i < rows.length; i++) {
    if (rows[i].length > maxCol) maxCol = rows[i].length;
  }
  if (maxCol < 1) maxCol = 1;
  var out = [];
  for (i = 0; i < rows.length; i++) {
    var line = [];
    var j;
    for (j = 0; j < maxCol; j++) {
      var cell = rows[i][j];
      line[j] = cell === undefined || cell === null ? '' : cell;
    }
    out.push(line);
  }
  return out;
}

function coerceToRowArray_(sheetRows) {
  if (sheetRows == null) return [];
  if (typeof sheetRows === 'string') {
    try {
      sheetRows = JSON.parse(sheetRows);
    } catch (e) {
      return [];
    }
  }
  if (Array.isArray(sheetRows)) {
    return sheetRows;
  }
  if (typeof sheetRows === 'object') {
    var keys = Object.keys(sheetRows).filter(function (k) {
      return /^\d+$/.test(k);
    });
    keys.sort(function (a, b) {
      return Number(a) - Number(b);
    });
    return keys.map(function (k) {
      return sheetRows[k];
    });
  }
  return [];
}

function coerceToCellArray_(row) {
  if (row == null) return [];
  if (Array.isArray(row)) return row;
  if (typeof row === 'object') {
    var keys = Object.keys(row).filter(function (k) {
      return /^\d+$/.test(k);
    });
    keys.sort(function (a, b) {
      return Number(a) - Number(b);
    });
    return keys.map(function (k) {
      return row[k];
    });
  }
  return [row];
}

function toDenseMatrix2D_(values2d) {
  if (values2d == null) return [];
  var raw;
  if (Array.isArray(values2d)) {
    raw = values2d;
  } else {
    raw = coerceToRowArray_(values2d);
  }
  var n = raw.length;
  var rows = [];
  var i;
  for (i = 0; i < n; i++) {
    var r = raw[i];
    if (r == null) {
      rows.push([]);
      continue;
    }
    if (Array.isArray(r)) {
      rows.push(r);
    } else if (typeof r === 'object') {
      rows.push(coerceToCellArray_(r));
    } else {
      rows.push([r]);
    }
  }
  return rows;
}

/** getRange(행, 열, 행 개수, 열 개수)로 값을 씀 */
function setValues2D_(sheet, startRow, startCol, values2d) {
  if (values2d == null) return;
  var rows = toDenseMatrix2D_(values2d);
  if (!rows.length) return;
  var numCols = 0;
  var i;
  var numRows = rows.length;
  for (i = 0; i < numRows; i++) {
    var w = rowWidth_(rows[i]);
    if (w > numCols) numCols = w;
  }
  if (numCols < 1) numCols = 1;
  var rect = [];
  for (i = 0; i < numRows; i++) {
    var line = [];
    var c;
    try {
      for (c = 0; c < numCols; c++) {
        line[c] = getCellVal_(rows[i], c);
      }
    } catch (e) {
      for (c = 0; c < numCols; c++) {
        line[c] = '';
      }
    }
    rect.push(line);
  }
  var rowCount = rect.length;
  if (rowCount < 1) return;
  sheet.getRange(startRow, startCol, rowCount, numCols).setValues(rect);
}

function rowWidth_(row) {
  if (row == null) return 0;
  if (Array.isArray(row)) return row.length;
  if (typeof row === 'object') {
    var keys = Object.keys(row).filter(function (k) {
      return /^\d+$/.test(k);
    });
    var max = 0;
    var i;
    for (i = 0; i < keys.length; i++) {
      var n = Number(keys[i]) + 1;
      if (n > max) max = n;
    }
    return max;
  }
  return 1;
}

function getCellVal_(row, c) {
  if (row == null) return '';
  if (Array.isArray(row)) {
    var va = row[c];
    return va === undefined || va === null ? '' : va;
  }
  if (typeof row === 'object') {
    var vo = row[c];
    if (vo !== undefined && vo !== null) return vo;
    vo = row[String(c)];
    return vo === undefined || vo === null ? '' : vo;
  }
  return c === 0 ? row : '';
}

function cellVal(rows, rowIndex, colIndex) {
  if (!rows[rowIndex]) return '';
  var v = rows[rowIndex][colIndex];
  return v === undefined || v === null ? '' : v;
}

function isSummaryTotalRow_(nameStr, gradeRaw, classRaw) {
  function compact(s) {
    return String(s || '').replace(/\s/g, '');
  }
  var n = compact(nameStr);
  if (n.indexOf('총합계') !== -1) return true;
  if (n === '합계' || n === '소계' || n === '총계' || n === '계') return true;
  var g = compact(gradeRaw);
  var c = compact(classRaw);
  if (g.indexOf('총합계') !== -1 || c.indexOf('총합계') !== -1) return true;
  if (g === '합계' || g === '소계' || c === '합계' || c === '소계') return true;
  return false;
}

function buildTargetAnalysis(rows) {
  var COL_GRADE = 0;
  var COL_CLASS = 2;
  var COL_NUM = 3;
  var COL_NAME = 4;
  var COL_MI_ABS = 7;
  var COL_MI_LATE = 11;
  var COL_MI_LEAVE = 15;
  var COL_MI_RESULT = 19;

  var dataStart = 5;
  var lastGrade = '';
  var lastClass = '';
  var list = [];
  var r;

  for (r = dataStart; r < rows.length; r++) {
    var row = rows[r];
    if (!row || !row.length) continue;

    var gRaw = cellVal(rows, r, COL_GRADE);
    var cRaw = cellVal(rows, r, COL_CLASS);
    if (gRaw !== '' && gRaw !== null && gRaw !== undefined) {
      lastGrade = gRaw;
    }
    if (cRaw !== '' && cRaw !== null && cRaw !== undefined) {
      lastClass = cRaw;
    }

    var num = cellVal(rows, r, COL_NUM);
    var name = String(cellVal(rows, r, COL_NAME)).trim();

    if (name === '' && num === '' && gRaw === '' && cRaw === '') {
      continue;
    }

    if (isSummaryTotalRow_(name, gRaw, cRaw)) {
      continue;
    }

    var grade = parseNumber(lastGrade);
    var klass = parseNumber(lastClass);
    var number = parseNumber(num);

    var studentId = formatStudentId(grade, klass, number);

    var vAbs = normalizeStat(cellVal(rows, r, COL_MI_ABS));
    var vLate = normalizeStat(cellVal(rows, r, COL_MI_LATE));
    var vLeave = normalizeStat(cellVal(rows, r, COL_MI_LEAVE));
    var vRes = normalizeStat(cellVal(rows, r, COL_MI_RESULT));

    var hasAny =
      (vAbs !== '' && vAbs !== 0) ||
      (vLate !== '' && vLate !== 0) ||
      (vLeave !== '' && vLeave !== 0) ||
      (vRes !== '' && vRes !== 0);

    if (!hasAny) continue;

    list.push({
      studentId: studentId,
      name: name,
      abs: vAbs,
      late: vLate,
      leave: vLeave,
      result: vRes,
    });
  }

  list.sort(function (a, b) {
    if (a.studentId !== b.studentId) return String(a.studentId).localeCompare(String(b.studentId));
    return String(a.name).localeCompare(String(b.name));
  });

  return list;
}

function parseNumber(v) {
  if (v === '' || v === null || v === undefined) return 0;
  if (typeof v === 'number' && !isNaN(v)) return Math.floor(v);
  var s = String(v).replace(/\s/g, '').replace(/,/g, '');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : Math.floor(n);
}

function normalizeStat(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (typeof v === 'number') return v;
  var s = String(v).replace(/\s/g, '');
  if (s === '') return '';
  var n = parseFloat(s.replace(/,/g, ''));
  if (!isNaN(n)) return n;
  return s;
}

function formatStudentId(grade, klass, number) {
  var id = grade * 10000 + klass * 100 + number;
  var s = String(Math.max(0, id));
  while (s.length < 5) s = '0' + s;
  return s;
}

function ensureSheet(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    ss.insertSheet(name);
  }
}

function getStudentMonthlyStats(studentIdRaw) {
  var wantId = normalizeId_(studentIdRaw);
  if (!wantId) {
    return { ok: false, message: '학번을 입력하세요.', rows: [] };
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var allSheets = ss.getSheets();
  var result = [];
  var si;
  for (si = 0; si < allSheets.length; si++) {
    var sh = allSheets[si];
    var nm = sh.getName();
    if (!/^(\d{1,2})월$/.test(nm)) continue;
    var matrix = sh.getDataRange().getValues();
    if (!matrix.length) continue;
    var st = extractStudentFromMonthMatrix_(matrix, wantId);
    if (st) {
      result.push({
        month: nm,
        abs: st.abs,
        late: st.late,
        leave: st.leave,
        result: st.result,
      });
    }
  }
  result.sort(function (a, b) {
    var ma = parseInt(/^(\d+)/.exec(a.month)[1], 10);
    var mb = parseInt(/^(\d+)/.exec(b.month)[1], 10);
    return ma - mb;
  });
  return { ok: true, rows: result };
}

function extractStudentFromMonthMatrix_(matrix, wantId) {
  var COL_GRADE = 0;
  var COL_CLASS = 2;
  var COL_NUM = 3;
  var COL_NAME = 4;
  var COL_MI_ABS = 7;
  var COL_MI_LATE = 11;
  var COL_MI_LEAVE = 15;
  var COL_MI_RESULT = 19;

  var dataStart = 5;
  var lastGrade = '';
  var lastClass = '';
  var r;
  for (r = dataStart; r < matrix.length; r++) {
    var row = matrix[r];
    if (!row || !row.length) continue;

    var gRaw = cellVal(matrix, r, COL_GRADE);
    var cRaw = cellVal(matrix, r, COL_CLASS);
    if (gRaw !== '' && gRaw !== null && gRaw !== undefined) {
      lastGrade = gRaw;
    }
    if (cRaw !== '' && cRaw !== null && cRaw !== undefined) {
      lastClass = cRaw;
    }

    var num = cellVal(matrix, r, COL_NUM);
    var name = String(cellVal(matrix, r, COL_NAME)).trim();

    if (name === '' && num === '' && gRaw === '' && cRaw === '') {
      continue;
    }

    if (isSummaryTotalRow_(name, gRaw, cRaw)) {
      continue;
    }

    var grade = parseNumber(lastGrade);
    var klass = parseNumber(lastClass);
    var number = parseNumber(num);
    var sid = formatStudentId(grade, klass, number);
    if (sid !== wantId) continue;

    return {
      abs: toCount_(normalizeStat(cellVal(matrix, r, COL_MI_ABS))),
      late: toCount_(normalizeStat(cellVal(matrix, r, COL_MI_LATE))),
      leave: toCount_(normalizeStat(cellVal(matrix, r, COL_MI_LEAVE))),
      result: toCount_(normalizeStat(cellVal(matrix, r, COL_MI_RESULT))),
    };
  }
  return null;
}