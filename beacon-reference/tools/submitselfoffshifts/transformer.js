(async function (data, args, reqOptions) {

  /* -------------------------------------------------
   * Access gate - runs before anything else, so a user without
   * the screen is refused before any argument or network work.
   * Off Shifts is a tab of the self Manual In & Out screen
   * (PageMode 2), so it is the same menu entry.
   * ------------------------------------------------- */
  if (
    !BeaconBar.user?.metaData?.menus?.some(menu =>
      menu.includes("TNAV9/ManualInOut/ManualInOut/2?mvc=1")
    )
  ) {
    return { error: true, message: "You do not have access to submit your off shift manual In and Out. Please contact HR Admin." };
  }

  args = args || {};

  function pad(n) { return String(n).padStart(2, "0"); }

  /* -------------------------------------------------
   * A validation problem is an answer for the user, not a tool
   * failure: a wrong date, a day on another tab, a locked record or
   * the server refusing the values all come back through here. Only
   * a broken session or an unreachable server is returned as error.
   * ------------------------------------------------- */
  function invalid(message, extra) {
    return Object.assign({ validationError: true, needsInput: true, message }, extra || {});
  }

  /* -------------------------------------------------
   * Date helpers - the input format follows the culture, the
   * same way the dateFormat tool decides it.
   * ------------------------------------------------- */
  const culture = BeaconBar.user?.metaData?.culture || "en-GB";
  const isUsFormat = culture === "en-US";
  const dateFormatName = isUsFormat ? "MM/DD/YYYY" : "DD/MM/YYYY";

  function parseCultureDate(dateStr) {
    if (!dateStr || typeof dateStr !== "string") return null;
    const parts = dateStr.split("/");
    if (parts.length !== 3) return null;
    const first = parts[0], second = parts[1], yyyy = parts[2];
    const dd = isUsFormat ? second : first;
    const mm = isUsFormat ? first : second;
    const d = Number(dd), m = Number(mm), y = Number(yyyy);
    if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(y)) return null;
    if (d < 1 || d > 31 || m < 1 || m > 12 || String(yyyy).trim().length !== 4) return null;
    return { dd: pad(dd), mm: pad(mm), yyyy: String(yyyy).trim() };
  }

  function formatCultureDate(parsed) {
    return isUsFormat
      ? `${parsed.mm}/${parsed.dd}/${parsed.yyyy}`
      : `${parsed.dd}/${parsed.mm}/${parsed.yyyy}`;
  }

  function fromJsDate(jsDate) {
    return { dd: pad(jsDate.getDate()), mm: pad(jsDate.getMonth() + 1), yyyy: String(jsDate.getFullYear()) };
  }

  // The API expects the range as text in the culture's own format.
  function formatRangeDate(jsDate) {
    return formatCultureDate(fromJsDate(jsDate));
  }

  function formatIsoDateOnly(parsed) {
    return `${parsed.yyyy}-${parsed.mm}-${parsed.dd}T00:00:00`;
  }

  // Comparable YYYYMMDD key so range checks never depend on Date parsing.
  function toDateKey(parsed) {
    return Number(`${parsed.yyyy}${parsed.mm}${parsed.dd}`);
  }

  // Comparable YYYYMMDDHHmm key, for checking a time against a window.
  function toMinuteKey(parsed, hhmm) {
    if (!parsed || !hhmm || hhmm.indexOf(":") === -1) return null;
    const [h, m] = hhmm.split(":");
    return Number(`${parsed.yyyy}${parsed.mm}${parsed.dd}${pad(h)}${pad(m)}`);
  }

  // Rows carry DatInDate as an ISO string - the unambiguous way to match a day.
  function isoDayOf(value) {
    if (!value || typeof value !== "string") return null;
    return value.split("T")[0];
  }

  function addDays(parsed, days) {
    return fromJsDate(new Date(Number(parsed.yyyy), Number(parsed.mm) - 1, Number(parsed.dd) + days));
  }

  /* -------------------------------------------------
   * Everything this tool knows about the day's window comes out of the
   * row's own ShiftToolTip - nothing about it is assumed here. An off
   * shift day reads like
   * "00.00 - 00.00 [Grace Start Time - 09/11/24 00:00 Grace End Time 10/11/24 00:00]"
   * and the two-digit dates follow the same culture as everything else.
   * ------------------------------------------------- */
  function parseGraceWindow(toolTip) {
    if (!toolTip || typeof toolTip !== "string") return null;
    const rx = /Grace Start Time\s*-?\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s+Grace End Time\s*-?\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/;
    const m = toolTip.match(rx);
    if (!m) return null;

    function build(a, b, y, h, min) {
      const dd = isUsFormat ? b : a;
      const mm = isUsFormat ? a : b;
      const yyyy = String(y).length === 2 ? `20${y}` : String(y);
      return {
        dayKey: Number(`${yyyy}${pad(mm)}${pad(dd)}`),
        key: Number(`${yyyy}${pad(mm)}${pad(dd)}${pad(h)}${pad(min)}`),
        text: `${pad(dd)}/${pad(mm)}/${yyyy} ${pad(h)}:${pad(min)}`
      };
    }

    const start = build(m[1], m[2], m[3], m[4], m[5]);
    const end = build(m[6], m[7], m[8], m[9], m[10]);
    if (!Number.isFinite(start.key) || !Number.isFinite(end.key) || start.key > end.key) return null;

    // "00.00 - 00.00" - the shift's own start and end, as the API states them.
    const shiftText = toolTip.split("[")[0].trim();
    const clock = shiftText.match(/(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})/);
    return {
      start: start.key,
      end: end.key,
      startText: start.text,
      endText: end.text,
      spansNextDay: end.dayKey > start.dayKey,
      shiftInClock: clock ? `${pad(clock[1])}:${clock[2]}` : null,
      shiftOutClock: clock ? `${pad(clock[3])}:${clock[4]}` : null,
      text: shiftText
    };
  }

  /* -------------------------------------------------
   * Time helpers - the user always speaks HH:mm, the API stores
   * the same clock time as the number HH.MM, and the submit posts
   * a new time as the string "HH.MM" ("10.00", "23.59").
   * ------------------------------------------------- */
  function isValidHHMM(hhmm) {
    if (!hhmm || typeof hhmm !== "string" || !/^\d{1,2}:\d{2}$/.test(hhmm.trim())) return false;
    const [h, m] = hhmm.split(":").map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }

  function normaliseHHMM(hhmm) {
    const [h, m] = hhmm.trim().split(":");
    return `${pad(h)}:${pad(m)}`;
  }

  function hhmmToText(val) {
    if (val === null || val === undefined || val === -1) return "";
    const num = Number(val);
    if (!Number.isFinite(num) || num < 0) return "";
    const h = Math.floor(num);
    const m = Math.round((num - h) * 100);
    return `${pad(h)}:${pad(m)}`;
  }

  function hasTime(val) {
    return val !== undefined && val !== null && val !== -1 && val !== "";
  }

  function toWireTime(hhmm) {
    if (!hhmm || typeof hhmm !== "string" || !hhmm.includes(":")) return null;
    const [h, m] = hhmm.split(":");
    return `${pad(h)}.${pad(m)}`;
  }

  /* -------------------------------------------------
   * Request helpers
   * ------------------------------------------------- */
  function getPathBase(sl) {
    return `${location.origin}/${sl}`;
  }

  function parseJsonLiteral(html, varName) {
    if (!html) return null;
    const rx = new RegExp(`var\\s+${varName}\\s*=\\s*(\\{[\\s\\S]*?\\});`);
    const match = html.match(rx);
    if (!match || !match[1]) return null;
    try {
      return JSON.parse(match[1]);
    } catch (e) {
      return null;
    }
  }

  async function safePostJson(url, payload, headers) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        redirect: "follow"
      });
      const body = await res.json().catch(function () { return null; });
      return { ok: res.ok, status: res.status, body };
    } catch (e) {
      return { ok: false, status: 0, body: null };
    }
  }

  // Mirrors the Search Criteria radios: rdoLast7Days (0), rdoLast30Days (1), rdoPeriod (2).
  function getRangeForMode(mode) {
    const today = new Date();
    if (mode === "last7days") {
      const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
      return { from: formatRangeDate(from), to: formatRangeDate(today) };
    }
    if (mode === "last30days") {
      const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
      return { from: formatRangeDate(from), to: formatRangeDate(today) };
    }
    // Wide default period, matching what the page falls back to.
    const startOfYear = new Date(today.getFullYear() - 3, 0, 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { from: formatRangeDate(startOfYear), to: formatRangeDate(endOfMonth) };
  }

  /* -------------------------------------------------
   * Shapes a grid row into the edit model that GetManuallyTimeFixedData,
   * GetManualRejectedData and SubmitManualAdjustment all take - the 67
   * keys every captured payload carries.
   *
   * ReasonCode "" is normalised to the reason dropdown's own first option
   * (model.ReasonList[0]) while OldReasonCode keeps the grid's raw value.
   * A row is disabled when it is locked or sits on the Pending tab (the
   * P/A rows the Off Shifts tab also lists): every captured payload
   * sends IsEnabled / IsAdjustmentEnabled false for exactly those.
   * ------------------------------------------------- */
  function toEditRow(row, noReasonCode) {
    const editable = isEditableRow(row);
    return {
      DatInDate: row.DatInDate,
      EmpNumber: row.EmpNumber,
      EmpDisplayNumber: row.EmpDisplayNumber,
      EmpDisplayName: row.EmpDisplayName,
      EmpHeaderName: row.EmpHeaderName,
      ShiftCode: row.ShiftCode,
      ShiftAbbreviation: row.ShiftAbbreviation,
      ShiftColor: row.ShiftColor,
      IsMidNightShift: row.IsMidNightShift,
      AdjShiftCode: row.AdjShiftCode,
      AdjShiftAbbreviation: row.AdjShiftAbbreviation,
      InDate: row.InDate,
      InTime: row.InTime,
      OutDate: row.OutDate,
      OutTime: row.OutTime,
      InOldDate: row.InOldDate,
      InOldTime: row.InOldTime,
      OutOldDate: row.OutOldDate,
      OutOldTime: row.OutOldTime,
      DABreakList: Array.isArray(row.DABreakList) ? row.DABreakList : [],
      DAUpdatedPurchesList: Array.isArray(row.DAUpdatedPurchesList) ? row.DAUpdatedPurchesList : [],
      BreakCount: row.BreakCount,
      PunchesCount: row.PunchesCount,
      ReasonCode: (row.ReasonCode === "" || row.ReasonCode === null || row.ReasonCode === undefined) ? noReasonCode : row.ReasonCode,
      Comment: row.Comment,
      DynamicColumnText: row.DynamicColumnText,
      LeaveDays: row.LeaveDays,
      LeaveType: row.LeaveType,
      ShortLeaveMinutes: row.ShortLeaveMinutes,
      LeaveDaysLabelString: row.LeaveDaysLabelString,
      IsTimeAdjLocked: row.IsTimeAdjLocked,
      IsPeriodLocked: row.IsPeriodLocked,
      NextInDate: row.NextInDate,
      NextInTime: row.NextInTime,
      IsShiftAdjApproved: row.IsShiftAdjApproved,
      IsNextDayLocked: row.IsNextDayLocked,
      InOutRecordType: row.InOutRecordType,
      RecordStatus: row.RecordStatus,
      IsLockedRecord: row.IsLockedRecord,
      RecordStatusText: row.RecordStatusText,
      InDateText: row.InDateText,
      OutDateText: row.OutDateText,
      InTimeText: row.InTimeText,
      OutTimeText: row.OutTimeText,
      ShiftToolTip: row.ShiftToolTip,
      DayCaption: row.DayCaption,
      DayAbbreviation: row.DayAbbreviation,
      // Before-snapshot - the server reads this as the "old" half of the change.
      OldInDateText: row.InDateText,
      OldOutDateText: row.OutDateText,
      OldInTimeText: row.InTimeText,
      OldOutTimeText: row.OutTimeText,
      OldReasonCode: row.ReasonCode,
      OldComment: row.Comment,
      OldBreakCount: row.BreakCount,
      OldPunchesCount: row.PunchesCount,
      IsSelected: false,
      Message: "",
      DynamicGridDataList: Array.isArray(row.DynamicGridDataList) ? row.DynamicGridDataList : [],
      IsEnabled: row.IsEnabled !== undefined ? row.IsEnabled : editable,
      IsAdjustmentEnabled: row.IsAdjustmentEnabled !== undefined ? row.IsAdjustmentEnabled : editable,
      IsConfirmationRequired: row.IsConfirmationRequired === true,
      IsOutTimeExceedConfirmed: row.IsOutTimeExceedConfirmed === true,
      IsHighlightInTime: row.IsHighlightInTime === true,
      IsHighlightOutTime: row.IsHighlightOutTime === true,
      AbsentDays: row.AbsentDays,
      NopayHours: row.NopayHours,
      IsShiftOffShift: row.IsShiftOffShift === true
    };
  }

  /* Once GetManuallyTimeFixedData answers, the grid marks every row whose
   * day it lists as manually fixed: the In cell when the fixed entry has
   * an In time, the Out cell when it has an Out time. */
  function withManualHighlight(row, fixedEntries) {
    const fixed = fixedEntries.find(function (f) {
      return isoDayOf(f.DatInDate) === isoDayOf(row.DatInDate)
        && (!row.EmpDisplayNumber || !f.EmpDisplayNumber || f.EmpDisplayNumber === row.EmpDisplayNumber);
    });
    if (!fixed) return row;
    const marked = Object.assign({}, row);
    if (hasTime(fixed.InTime)) {
      marked.IsHighlightInTime = true;
      marked.InTimeHighlightCSS = "ManualTime_Highlight";
    }
    if (hasTime(fixed.OutTime)) {
      marked.IsHighlightOutTime = true;
      marked.OutTimeHighlightCSS = "ManualTime_Highlight";
    }
    return marked;
  }

  function pickRowDebug(row) {
    if (!row) return null;
    return {
      DatInDate: row.DatInDate,
      InDate: row.InDate,
      OutDate: row.OutDate,
      InDateText: row.InDateText,
      OutDateText: row.OutDateText,
      InTime: row.InTime,
      OutTime: row.OutTime,
      InTimeText: row.InTimeText,
      OutTimeText: row.OutTimeText,
      IsSelected: row.IsSelected,
      Comment: row.Comment,
      ReasonCode: row.ReasonCode,
      InOutRecordType: row.InOutRecordType,
      RecordStatus: row.RecordStatus,
      IsShiftOffShift: row.IsShiftOffShift,
      IsEnabled: row.IsEnabled,
      BreakCount: row.BreakCount,
      DABreakList: Array.isArray(row.DABreakList) ? row.DABreakList : null
    };
  }

  /* -------------------------------------------------
   * Step 1: identify the date.
   * ------------------------------------------------- */
  const wantsTab = !!args.showTab;

  if (!args.date && !wantsTab) {
    return {
      needsInput: true,
      message: `Please tell me the off shift date (${dateFormatName}) you want to submit your manual In and Out for.`,
      missingFields: ["Date"],
      expectedDateFormat: dateFormatName
    };
  }

  const parsedDate = args.date ? parseCultureDate(args.date) : null;
  if (!wantsTab && !parsedDate) {
    return invalid(`Invalid date format. Please provide the date as ${dateFormatName}.`, { missingFields: ["Date"], expectedDateFormat: dateFormatName });
  }
  const dateText = parsedDate ? formatCultureDate(parsedDate) : null;
  const targetIsoDay = parsedDate ? `${parsedDate.yyyy}-${parsedDate.mm}-${parsedDate.dd}` : null;

  const sl = reqOptions.sl;
  const baseUrl = getPathBase(sl);
  const jsonHeaders = {
    "accept": "*/*",
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest"
  };
  // The roster, break, comment and summary calls go out as jQuery ajax, with its own accept.
  const ajaxHeaders = {
    "accept": "application/json, text/javascript, */*; q=0.01",
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest"
  };

  /* -------------------------------------------------
   * Page load, in the order the screen does it:
   *   ManualInOut/ManualInOut/2?mvc=1 (filterModel / model)
   *   -> securityapi/pagehit for that same URL
   *   -> Common/GetRostersByGroupId
   * Every screen default this tool uses - roster groups, the reason
   * dropdown, the grid page size, Group By Employee - comes from
   * filterModel / model, not from constants here.
   * ------------------------------------------------- */
  const updateUrl = await BeaconBar.executeFunction("updateUrlParams")(
    "TNAV9/ManualInOut/ManualInOut/2?mvc=1"
  );
  const pagePath = updateUrl && updateUrl.updateUrl
    ? updateUrl.updateUrl
    : "TNAV9/ManualInOut/ManualInOut/2?mvc=1";
  const pageUrl = `${baseUrl}/${pagePath}`;

  const pageRes = await fetch(pageUrl, {
    method: "GET",
    headers: { "x-requested-with": "XMLHttpRequest" },
    redirect: "follow"
  });
  const pageHtml = await pageRes.text();
  const filterModel = parseJsonLiteral(pageHtml, "filterModel") || {};
  const pageModel = parseJsonLiteral(pageHtml, "model") || {};

  // Page-hit audit the screen records on every load - best-effort, empty response.
  try {
    await fetch(`${baseUrl}/api/securityapi/pagehit?pageUrl=${encodeURIComponent(`../${pagePath}`)}&_=${Date.now()}`, {
      method: "GET",
      headers: {
        "accept": "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/json; charset=utf-8",
        "x-requested-with": "XMLHttpRequest"
      },
      redirect: "follow"
    });
  } catch (e) { /* the audit never blocks the submit */ }

  const pageToken = filterModel.LoginEmpNumber || null;
  const selfToolToken = await BeaconBar.executeFunction("selfEmployeeManualInAndOutDetails")();
  // Prefer the page token for this screen's search calls; fall back to the helper token.
  const empNumber = pageToken || selfToolToken;

  if (!empNumber) {
    return {
      error: true,
      message: "Unable to identify the logged-in employee. Please try again.",
      diagnostics: {
        pageUrl,
        pageStatus: pageRes.status,
        hasFilterModel: Object.keys(filterModel).length > 0,
        hasLoginEmpNumber: !!pageToken
      }
    };
  }
  BeaconBar.setSharedData("empNumber", empNumber);

  // The page mode the screen itself declares - the /2 of the URL loaded above.
  const pageMode = filterModel.PageMode !== undefined ? filterModel.PageMode : pageModel.PageMode;

  // The reason dropdown's first option is its "nothing selected" value.
  const reasonList = Array.isArray(pageModel.ReasonList) ? pageModel.ReasonList : [];
  const noReasonCode = reasonList.length > 0 ? reasonList[0].ReasonCode : null;

  /* The grid pages its rows, and the fixed / rejected / submit calls post
   * only the page on screen. A model with no page size means no paging. */
  const pageSize = Number(pageModel.GridPageData && pageModel.GridPageData.PageSize) || 0;
  function pageOf(rows, pageIndex) {
    if (!pageSize) return rows;
    return rows.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
  }

  /* -------------------------------------------------
   * The grid's tabs, read off the screen rather than assumed. Each tab
   * link is bound to InOutRecordType.<Member>, shows its label, and
   * counts from ManualVM.<CountField>; a link can be hidden by a
   * ConfigData flag (Off Shifts is, by EnableManualInOutOffShiftTab).
   * ------------------------------------------------- */
  function readTabLinks(html) {
    const links = [];
    const rx = /<li\b([^>]*)>\s*<a\b[^>]*InOutRecordType\.(\w+)[^>]*>\s*([^<]*?)\s*<span[^>]*text:\s*ManualVM\.(\w+)/g;
    let m;
    while ((m = rx.exec(html || "")) !== null) {
      const flag = (m[1].match(/visible\s*:\s*ManualVM\.ConfigData\(\)\.(\w+)/) || [])[1] || null;
      links.push({ member: m[2], label: m[3].trim(), countField: m[4], visibleFlag: flag });
    }
    return links;
  }

  /* The number behind each InOutRecordType member, from the scripts the
   * page itself loads - the screen's own script first. A plain object
   * literal and a compiled enum are both understood. */
  async function readRecordTypeValues(html) {
    const pageSegments = pageUrl.split("?")[0].split("/").filter(Boolean);
    function score(src) {
      return (/\/Scripts\/app\//i.test(src) ? 1 : 0)
        + (pageSegments.some(function (s) { return src.indexOf(`/${s}.js`) !== -1; }) ? 2 : 0);
    }
    const srcs = [];
    const rx = /<script\b[^>]*\bsrc="([^"]+)"/g;
    let m;
    while ((m = rx.exec(html || "")) !== null) srcs.push(m[1]);
    // Only the screen's own scripts (/Scripts/app/), de-duplicated - not the shared libraries;
    // the tab counts are the fallback when the enum is not found there.
    const own = srcs.filter(function (src, i) { return score(src) > 0 && srcs.indexOf(src) === i; });
    own.sort(function (a, b) { return score(b) - score(a); });

    for (const src of own) {
      let js = "";
      try {
        const res = await fetch(new URL(src, pageUrl).href, { method: "GET", redirect: "follow" });
        if (!res.ok) continue;
        js = await res.text();
      } catch (e) { continue; }

      const values = {};
      const literal = js.match(/InOutRecordType\s*=\s*(?:Object\.freeze\(\s*)?\{([^}]*)\}/);
      if (literal) {
        const pair = /["']?(\w+)["']?\s*:\s*(-?\d+)/g;
        let p;
        while ((p = pair.exec(literal[1])) !== null) values[p[1]] = Number(p[2]);
      }
      const compiled = /InOutRecordType\[\s*InOutRecordType\[\s*["'](\w+)["']\s*\]\s*=\s*(-?\d+)\s*\]/g;
      let c;
      while ((c = compiled.exec(js)) !== null) values[c[1]] = Number(c[2]);
      if (Object.keys(values).length > 0) return values;
    }
    return {};
  }

  /* Which rows each tab holds. A tab holds the rows of its record type
   * when that is what the count the grid reports for it adds up to;
   * otherwise, when the count is the number of off shift days, it holds
   * the off shift days whatever their record type - Off Shifts does
   * (self capture: 9 open + 1 pending = 10; team capture: 22 of the 52
   * type 0 rows, the other 30 being REST days on no tab but View All).
   * A record type the scripts did not give is inferred from the counts -
   * the one type whose rows add up to the tab's count. A tab whose rows
   * cannot be told apart (View All) is left out. */
  function buildTabs(links, typeValues, gridBody, rows) {
    const config = pageModel.ConfigData || {};
    const typeCount = {};
    rows.forEach(function (r) { typeCount[r.InOutRecordType] = (typeCount[r.InOutRecordType] || 0) + 1; });

    const offShiftCount = rows.filter(function (r) { return r.IsShiftOffShift === true; }).length;

    function fit(type, reported) {
      if (typeof reported !== "number") return type === null ? null : "type";
      if (type !== null && (typeCount[type] || 0) === reported) return "type";
      return offShiftCount === reported ? "offShift" : null;
    }

    const built = links
      .filter(function (l) { return !l.visibleFlag || config[l.visibleFlag] !== false; })
      .map(function (l) {
        const value = typeValues[l.member];
        return {
          member: l.member,
          label: l.label,
          countField: l.countField,
          value: value === undefined ? null : value,
          reported: gridBody ? gridBody[l.countField] : undefined
        };
      });

    let progress = true;
    while (progress) {
      progress = false;
      const taken = built.filter(function (t) { return t.value !== null; }).map(function (t) { return t.value; });
      built.filter(function (t) { return t.value === null && typeof t.reported === "number"; }).forEach(function (t) {
        const candidates = Object.keys(typeCount).map(Number).filter(function (type) {
          return taken.indexOf(type) === -1 && typeCount[type] === t.reported;
        });
        if (candidates.length === 1) {
          t.value = candidates[0];
          taken.push(t.value);
          progress = true;
        }
      });
    }

    return built
      // A tab the screen counts as 0 is kept as an empty tab - nothing on it, but it is still a tab.
      .map(function (t) { return Object.assign(t, { mode: fit(t.value, t.reported) || (t.reported === 0 ? "empty" : null) }); })
      .filter(function (t) { return t.mode !== null; });
  }
  const tabLinks = readTabLinks(pageHtml);
  const typeValues = await readRecordTypeValues(pageHtml);
  let tabs = [];

  function inTab(row, tab) {
    if (!tab) return false;
    if (tab.mode === "empty") return false;
    return tab.mode === "offShift" ? row.IsShiftOffShift === true : row.InOutRecordType === tab.value;
  }
  function tabsOf(row) { return tabs.filter(function (t) { return inTab(row, t); }); }
  function tabByMember(member) { return tabs.find(function (t) { return t.member === member; }) || null; }

  // The page's own names for the tabs this tool cares about.
  const OWN_TAB = "Offshift";
  const PENDING_TAB = "Pending";
  const TOOL_FOR_TAB = { Regularize: "submitSelfManualInAndOut", Valid: "editSelfManualInAndOut", Offshift: "submitSelfOffShifts" };

  function isEditableRow(row) {
    return row.IsLockedRecord !== true && !inTab(row, tabByMember(PENDING_TAB));
  }

  // One day as the screen shows it - the tab(s) it sits on and what is recorded.
  function describeDay(row) {
    return {
      date: row.InDateText || null,
      tabs: tabsOf(row).map(function (t) { return t.label; }),
      status: row.RecordStatusText || null,
      shift: row.ShiftAbbreviation || null,
      dayType: row.DayAbbreviation || null,
      isOffShift: row.IsShiftOffShift === true,
      inDate: row.InDateText || null,
      inTime: hasTime(row.InTime) ? (row.InTimeText || hhmmToText(row.InTime)) : null,
      outDate: row.OutDateText || null,
      outTime: hasTime(row.OutTime) ? (row.OutTimeText || hhmmToText(row.OutTime)) : null,
      breakCount: row.BreakCount,
      comment: row.Comment || null,
      locked: row.IsLockedRecord === true,
      shiftToolTip: row.ShiftToolTip || null
    };
  }

  /* -------------------------------------------------
   * The shift as the API describes it for the day - shown to the user
   * before any time is asked for. Everything comes from the row and its
   * ShiftToolTip; the day's breaks come from GetEmployeeBreaksByDate.
   * ------------------------------------------------- */
  function breakText(br) {
    const s = br.BStartTimeText || hhmmToText(br.BStartTime);
    const e = br.BEndTimeText || hhmmToText(br.BEndTime);
    return { breakIn: s || null, breakOut: e || null, startDate: br.BStartDateText || null, endDate: br.BEndDateText || null };
  }

  /* -------------------------------------------------
   * The request behind a Pending day, as the screen shows it when the
   * day's pending details are opened (captured GetEmployeePendingApprovalData, posted
   * {empNumber, datInDateText} with the row's own EmpNumber token). One
   * entry per requested change: which time (TimeModeText), New or Change
   * (ActionTypeText), the old and new date/time (MClockData), the comment,
   * and - when the API names one - the approver it is waiting for.
   * ------------------------------------------------- */
  async function loadPendingRequest(row) {
    const res = await safePostJson(`${baseUrl}/TNAV9/api/ManualInOut/GetEmployeePendingApprovalData/`, {
      empNumber: row.EmpNumber || empNumber,
      datInDateText: row.InDateText || dateText
    }, ajaxHeaders);
    const list = Array.isArray(res.body) ? res.body : [];

    function whenText(isoDate, time) {
      if (!hasTime(time)) return null;
      const parsed = isoToParsed(isoDate);
      return `${parsed ? formatCultureDate(parsed) + " " : ""}${hhmmToText(time)}`;
    }

    const changes = list.map(function (p) {
      const m = p.MClockData || {};
      return {
        field: p.TimeModeText || null,
        action: p.ActionTypeText || null,
        from: whenText(m.OldDate, m.OldTime),
        to: whenText(m.NewDate, m.NewTime),
        comment: m.Comment || null,
        approvalComment: m.ApprovalComment || null,
        approver: p.AppEmpDisplayName ? `${p.AppEmpDisplayNumber ? p.AppEmpDisplayNumber + " - " : ""}${String(p.AppEmpDisplayName).trim()}` : null,
        workflowId: p.WFMainId || null
      };
    });
    const unique = function (values) { return values.filter(function (v, i) { return v && values.indexOf(v) === i; }); };
    const approvers = unique(changes.map(function (c) { return c.approver; }));
    const comments = unique(changes.map(function (c) { return c.comment; }));
    const approvalComments = unique(changes.map(function (c) { return c.approvalComment; }));

    const requested = changes.map(function (c) {
      return c.from
        ? `${c.field}: ${c.from} -> ${c.to || "-"} (${c.action || "Change"})`
        : `${c.field}: ${c.to || "-"} (${c.action || "New"})`;
    });
    const text = changes.length > 0
      ? ` Requested: ${requested.join("; ")}.${comments.length ? ` Comment: "${comments.join('", "')}".` : ""}${approvers.length ? ` Waiting for approval by ${approvers.join(", ")}.` : ""}${approvalComments.length ? ` Approver comment: "${approvalComments.join('", "')}".` : ""}`
      : " No details of the pending request were returned.";

    return { status: row.RecordStatusText || null, changes, approvers, text };
  }
  function shiftDetailsOf(row, window, existing) {
    return {
      date: row.InDateText || null,
      dayType: row.DayAbbreviation || null,
      dayDescription: row.DayCaption || null,
      shift: row.ShiftAbbreviation || null,
      shiftTime: window ? (window.shiftInClock ? `${window.shiftInClock} - ${window.shiftOutClock}` : window.text) : null,
      swipesAllowedFrom: window ? window.startText : null,
      swipesAllowedTo: window ? window.endText : null,
      canEndNextDay: window ? window.spansNextDay : (row.IsMidNightShift === 1),
      isOffShift: row.IsShiftOffShift === true,
      tabs: tabsOf(row).map(function (t) { return t.label; }),
      status: row.RecordStatusText || null,
      recordedIn: hasTime(row.InTime) ? `${row.InDateText} ${row.InTimeText || hhmmToText(row.InTime)}` : null,
      recordedOut: hasTime(row.OutTime) ? `${row.OutDateText} ${row.OutTimeText || hhmmToText(row.OutTime)}` : null,
      recordedBreaks: existing.map(function (br, i) { return Object.assign({ breakNo: i + 1 }, breakText(br)); })
    };
  }

  function shiftDetailsText(d) {
    const parts = [`Shift details for ${d.date}${d.dayType ? ` (${d.dayType})` : ""}: shift ${d.shift || "-"}`];
    if (d.shiftTime) parts.push(`shift time ${d.shiftTime}`);
    if (d.swipesAllowedFrom) parts.push(`swipes allowed from ${d.swipesAllowedFrom} to ${d.swipesAllowedTo}`);
    if (d.canEndNextDay) parts.push("the shift can end on the following day");
    parts.push(`recorded In ${d.recordedIn || "-"}, Out ${d.recordedOut || "-"}`);
    parts.push(d.recordedBreaks.length > 0
      ? `recorded breaks ${d.recordedBreaks.map(function (b) { return `${b.breakNo}) ${b.breakIn} - ${b.breakOut}`; }).join(", ")}`
      : "no breaks recorded");
    return parts.join("; ") + ".";
  }

  /* -------------------------------------------------
   * Breaks. The user can give any number of them, or none: as the
   * breaks list, or as one breakInTime/breakOutTime pair. A break with a
   * breakNo changes that recorded break; any other is added. Each one is
   * checked the way the screen checks it - both edges, HH:mm, end after
   * start, inside the In -> Out span ("Break Start/End Dates should be
   * within In/Out Dates"), inside the shift's allowed window - and no
   * break may overlap another break of the day.
   * ------------------------------------------------- */
  function requestedBreaksOf(a) {
    const list = Array.isArray(a.breaks)
      ? a.breaks.filter(function (b) { return b && (b.breakInTime || b.breakOutTime); })
      : [];
    if (a.breakInTime || a.breakOutTime) list.push({ breakInTime: a.breakInTime, breakOutTime: a.breakOutTime });
    return list;
  }

  function isClockTime(hhmm) {
    if (!hhmm || typeof hhmm !== "string" || !/^\d{1,2}:\d{2}$/.test(hhmm.trim())) return false;
    const [h, m] = hhmm.trim().split(":").map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }

  // The shape of every break, before anything is placed.
  function checkBreakShapes(list, existing) {
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const name = `Break ${i + 1}`;
      if (!b.breakInTime || !b.breakOutTime) {
        return {
          needsInput: true,
          message: `${name} has only one time. Please give both its Break In Time and Break Out Time (HH:mm), or leave that break out.`,
          missingFields: [b.breakInTime ? `${name} Out Time` : `${name} In Time`]
        };
      }
      if (!isClockTime(b.breakInTime) || !isClockTime(b.breakOutTime)) {
        return invalid(`${name} times must be in HH:mm 24-hour format, e.g. 12:00 and 13:00.`, { missingFields: [`${name} In Time`, `${name} Out Time`] });
      }
      if (b.breakNo !== undefined && b.breakNo !== null) {
        const n = Number(b.breakNo);
        if (!Number.isInteger(n) || n < 1 || n > existing.length) {
          return invalid(existing.length > 0
            ? `${name} refers to recorded break ${b.breakNo}, but the day has breaks 1 to ${existing.length}. Leave breakNo out to add a new break.`
            : `${name} refers to recorded break ${b.breakNo}, but the day has no recorded breaks. Leave breakNo out to add a new break.`, {
            recordedBreaks: existing.map(function (br, k) { return Object.assign({ breakNo: k + 1 }, breakText(br)); })
          });
        }
        if (list.some(function (o, k) { return k !== i && Number(o.breakNo) === n; })) {
          return invalid(`Recorded break ${n} is changed twice. Give it only once.`);
        }
      }
    }
    return null;
  }

  function isoToParsed(iso) {
    const day = isoDayOf(iso);
    if (!day) return null;
    const [yyyy, mm, dd] = day.split("-");
    return { yyyy, mm, dd };
  }

  /* The first date from the In date to the Out date on which the clock
   * time sits inside the In -> Out span and after notBefore. */
  function placeOnSpan(hhmm, span, notBefore) {
    const lastDay = toDateKey(span.outParsed);
    for (let day = span.inParsed; toDateKey(day) <= lastDay; day = addDays(day, 1)) {
      const key = toMinuteKey(day, hhmm);
      if (key !== null && key > notBefore && key >= span.inKey && key <= span.outKey) return { parsed: day, key };
    }
    return null;
  }

  /* Places and checks every requested break against the In -> Out span,
   * the shift's window and every other break that will stand on the day.
   * Returns { response } for the first problem, or { placed }. */
  function placeBreaks(list, span, window, existing) {
    /* Only an In or only an Out was given: the missing edge is the day's
     * own allowed window (the row's ShiftToolTip), so a break is placed
     * against what the API states rather than against nothing. */
    span = Object.assign({}, span);
    if (span.inKey === null) span.inKey = window ? window.start : toMinuteKey(span.inParsed, "00:00");
    if (span.outKey === null) {
      span.outKey = window ? window.end : toMinuteKey(span.outParsed, "23:59");
      if (window) {
        const endDay = String(Math.floor(window.end / 10000));
        const endParsed = { yyyy: endDay.slice(0, 4), mm: endDay.slice(4, 6), dd: endDay.slice(6, 8) };
        if (toDateKey(endParsed) > toDateKey(span.outParsed)) span.outParsed = endParsed;
      }
    }
    const inEdge = span.inText ? `${span.inDateText} ${span.inText}` : (window ? `${window.startText} (no In given - start of the allowed window)` : `${span.inDateText} -`);
    const outEdge = span.outText ? `${span.outDateText} ${span.outText}` : (window ? `${window.endText} (no Out given - end of the allowed window)` : `${span.outDateText} -`);
    const spanText = `${inEdge} - ${outEdge}`;
    const changed = list.map(function (b) { return Number(b.breakNo); });
    const standing = existing
      .map(function (br, k) {
        const s = isoToParsed(br.BStartDate);
        const e = isoToParsed(br.BEndDate);
        const t = breakText(br);
        return {
          breakNo: k + 1,
          label: `recorded break ${k + 1} (${t.breakIn} - ${t.breakOut})`,
          start: s && t.breakIn ? toMinuteKey(s, t.breakIn) : null,
          end: e && t.breakOut ? toMinuteKey(e, t.breakOut) : null
        };
      })
      .filter(function (t) { return changed.indexOf(t.breakNo) === -1 && t.start !== null && t.end !== null; });

    const placed = [];
    for (let i = 0; i < list.length; i++) {
      const bIn = normaliseHHMM(list[i].breakInTime);
      const bOut = normaliseHHMM(list[i].breakOutTime);
      const name = `Break ${i + 1} (${bIn} - ${bOut})`;
      const fields = [`Break ${i + 1} In Time`, `Break ${i + 1} Out Time`];

      const start = placeOnSpan(bIn, span, span.inKey - 1);
      if (!start) {
        return { response: invalid(`${name} does not start within your In and Out (${spanText}). Break start and end must be within the In/Out dates and times.`, { missingFields: fields }) };
      }
      const end = placeOnSpan(bOut, span, start.key);
      if (!end) {
        return { response: invalid(`${name} must end after it starts and no later than your Out (${spanText}). Break start and end must be within the In/Out dates and times.`, { missingFields: fields }) };
      }
      if (window && (start.key < window.start || end.key > window.end)) {
        return { response: invalid(`${name} is not within the shift's allowed period (${window.startText} - ${window.endText}). Please give break times inside that period.`, { missingFields: fields }) };
      }
      const clash = standing.find(function (t) { return start.key < t.end && end.key > t.start; });
      if (clash) {
        return { response: invalid(`${name} overlaps ${clash.label}. Breaks cannot overlap - please change the times.`, { missingFields: fields }) };
      }
      standing.push({ label: `break ${i + 1} (${bIn} - ${bOut})`, start: start.key, end: end.key });
      placed.push({
        breakNo: list[i].breakNo ? Number(list[i].breakNo) : null,
        inText: bIn,
        outText: bOut,
        start: start.parsed,
        end: end.parsed
      });
    }
    return { placed };
  }

  /* The day's break list as it goes out: the recorded breaks carried
   * as they are, a changed one updated in place, a new one appended with
   * the next SeqNo. ActionType is the "was this break touched" flag - 1
   * for one the user added or changed (a new break sent as 0 is read as
   * unmodified, "No modifications to save"), the captured 0/1 otherwise. */
  function mergeBreaks(existing, placed, row) {
    let seq = existing.reduce(function (maxVal, br) {
      const n = Number(br && br.SeqNo);
      return Number.isFinite(n) && n > maxVal ? n : maxVal;
    }, 0);
    const list = existing.map(function (br) { return Object.assign({}, br); });
    placed.forEach(function (b) {
      const edges = {
        BStartDate: formatIsoDateOnly(b.start),
        BStartTime: toWireTime(b.inText),
        BEndDate: formatIsoDateOnly(b.end),
        BEndTime: toWireTime(b.outText)
      };
      const texts = {
        BStartDateText: formatCultureDate(b.start),
        BEndDateText: formatCultureDate(b.end),
        BStartTimeText: b.inText,
        BEndTimeText: b.outText,
        ActionType: 1
      };
      if (b.breakNo) {
        list[b.breakNo - 1] = Object.assign(list[b.breakNo - 1], edges, texts);
        return;
      }
      seq += 1;
      list.push(Object.assign({
        DatInDate: row.DatInDate || formatIsoDateOnly(parsedDate),
        EmpNumber: row.EmpNumber || empNumber,
        SeqNo: seq
      }, edges, {
        BStartOldDate: null,
        BStartOldTime: -1,
        BEndOldDate: null,
        BEndOldTime: -1
      }, texts));
    });
    return list;
  }

  /* Rosters: the groups come from filterModel.RosterGroupList, the rosters
   * of a group from GetRostersByGroupId. With nothing chosen the page's own
   * dropdowns sit on their first option - the captured search posted
   * RosterCode 000058, the first roster of the first group (6). */
  const rosterGroupList = Array.isArray(filterModel.RosterGroupList) ? filterModel.RosterGroupList : [];

  function availableGroups() {
    return rosterGroupList.map(function (g) { return { groupId: g.GroupId, groupName: g.GroupName }; });
  }

  let rosterGroupEntry = null;
  if (args.rosterGroup) {
    const w = String(args.rosterGroup).toLowerCase().trim();
    rosterGroupEntry = rosterGroupList.find(function (g) { return String(g.GroupId).toLowerCase() === w; })
      || rosterGroupList.find(function (g) { return String(g.GroupName || "").toLowerCase().trim() === w; })
      || rosterGroupList.find(function (g) { return String(g.GroupName || "").toLowerCase().includes(w); })
      || null;
    if (!rosterGroupEntry) {
      return invalid(`Could not find a roster group "${args.rosterGroup}". Please pick one of the available roster groups.`, {
        availableRosterGroups: availableGroups()
      });
    }
  } else if (rosterGroupList.length > 0) {
    rosterGroupEntry = rosterGroupList[0];
  }
  const rosterGroup = rosterGroupEntry ? String(rosterGroupEntry.GroupId) : null;

  let rosterList = [];
  if (rosterGroup !== null) {
    const rosterResult = await safePostJson(
      `${baseUrl}/TNAV9/api/Common/GetRostersByGroupId/`,
      { rosterGroup },
      ajaxHeaders
    );
    rosterList = Array.isArray(rosterResult.body) ? rosterResult.body : [];
  }

  let rosterCode = args.rosterCode || null;
  if (!rosterCode && args.rosterName) {
    const wanted = String(args.rosterName).toLowerCase().trim();
    const rosterMatch = rosterList.find(function (r) {
      return String(r.RosterName || "").toLowerCase().trim() === wanted;
    }) || rosterList.find(function (r) {
      return String(r.RosterName || "").toLowerCase().includes(wanted);
    });

    if (!rosterMatch) {
      return invalid(`Could not find a roster named "${args.rosterName}"${rosterGroupEntry ? ` in roster group ${rosterGroupEntry.GroupName}` : ""}. Please pick one of the available rosters.`, {
        availableRosters: rosterList.map(function (r) { return { rosterCode: r.RosterCode, rosterName: r.RosterName }; }),
        availableRosterGroups: availableGroups()
      });
    }
    rosterCode = rosterMatch.RosterCode;
  }
  if (!rosterCode && rosterList.length > 0) rosterCode = rosterList[0].RosterCode;

  /* -------------------------------------------------
   * Build the search range from the date-selection mode.
   * ------------------------------------------------- */
  const requestedMode = String(args.dateSelectMode || "period").toLowerCase();
  if (["last7days", "last30days", "period"].indexOf(requestedMode) === -1) {
    return invalid('dateSelectMode must be one of "last7days", "last30days" or "period".');
  }

  const modeRange = getRangeForMode(requestedMode);
  let fromDateText = modeRange.from;
  let toDateText = modeRange.to;

  if (requestedMode === "period") {
    if (args.fromDate) {
      const parsedFrom = parseCultureDate(args.fromDate);
      if (!parsedFrom) return invalid(`Invalid fromDate. Please provide it as ${dateFormatName}.`, { missingFields: ["From Date"] });
      fromDateText = formatCultureDate(parsedFrom);
    }
    if (args.toDate) {
      const parsedTo = parseCultureDate(args.toDate);
      if (!parsedTo) return invalid(`Invalid toDate. Please provide it as ${dateFormatName}.`, { missingFields: ["To Date"] });
      toDateText = formatCultureDate(parsedTo);
    }
  }

  const targetKey = parsedDate ? toDateKey(parsedDate) : null;
  const fromKey = toDateKey(parseCultureDate(fromDateText));
  const toKey = toDateKey(parseCultureDate(toDateText));

  if (fromKey > toKey) {
    return invalid(`The search range is invalid: From Date (${fromDateText}) is after To Date (${toDateText}).`, { missingFields: ["From Date", "To Date"] });
  }
  if (targetKey !== null && (targetKey < fromKey || targetKey > toKey)) {
    return invalid(`${dateText} is outside the selected search range (${fromDateText} - ${toDateText}). Please widen the range so it includes ${dateText}.`, {
      searchRange: { dateSelectMode: requestedMode, fromDate: fromDateText, toDate: toDateText }
    });
  }

  /* -------------------------------------------------
   * Step 2: Search, as the button does it (captured "when click the
   * search button"):
   *   GetGridDataByCriteria -> GetManuallyTimeFixedData
   *   -> GetManualRejectedData -> GetDynamicEmployeeSummary
   * The grid opens on its first tab, so fixed and rejected both get the
   * on-screen page of that tab's rows, and the summary is keyed by the
   * EmpNumber token those rows carry.
   * ------------------------------------------------- */
  const isGroupByEmployee = typeof args.isGroupByEmployee === "boolean"
    ? args.isGroupByEmployee
    : filterModel.IsGroupByEmployee === true;

  const gridPayload = {
    FromDateText: fromDateText,
    ToDateText: toDateText,
    IsGroupByEmployee: isGroupByEmployee,
    FilterMode: "1",
    EmpNumber: empNumber,
    RosterCode: rosterCode,
    callBackId: 1,
    isShowShiftHoursInShiftAdjEnabled: false,
    IsClientUoc: filterModel.IsClientUOC === true,
    PageMode: pageMode
  };

  function rowsOf(gridBody) {
    return (gridBody && Array.isArray(gridBody.ManualInOutDetailList)) ? gridBody.ManualInOutDetailList : [];
  }

  // The on-screen page of the tab the grid opens on - its first tab.
  function firstTabPage(list) {
    const firstTab = tabs[0] || null;
    return pageOf(
      list.filter(function (r) { return inTab(r, firstTab); }).map(function (r) { return toEditRow(r, noReasonCode); }),
      0
    );
  }

  function summaryTokenOf(gridBody, list) {
    const fromRow = list.find(function (r) { return r && r.EmpNumber; });
    if (fromRow) return fromRow.EmpNumber;
    const emp = gridBody && Array.isArray(gridBody.EmployeeList) ? gridBody.EmployeeList[0] : null;
    return (emp && emp.EmpNumber) || empNumber;
  }

  async function postFixedAndRejected(rows) {
    const fixedRes = await safePostJson(`${baseUrl}/TNAV9/api/ManualInOut/GetManuallyTimeFixedData/`, rows, jsonHeaders);
    const rejectedRes = await safePostJson(`${baseUrl}/TNAV9/api/ManualInOut/GetManualRejectedData/`, rows, jsonHeaders);
    return {
      fixedList: Array.isArray(fixedRes.body) ? fixedRes.body : [],
      rejectedList: Array.isArray(rejectedRes.body) ? rejectedRes.body : []
    };
  }

  async function postSummary(token) {
    const res = await safePostJson(`${baseUrl}/TNAV9/api/Common/GetDynamicEmployeeSummary/`, {
      pageId: 1,
      empNumber: token,
      fromDateText,
      toDateText
    }, ajaxHeaders);
    return res.body && typeof res.body === "object" ? res.body : null;
  }

  // Flattens SummaryData_01, _02, ... into one readable list.
  function shapeSummary(summary) {
    if (!summary) return null;
    const fields = [];
    Object.keys(summary)
      .filter(function (k) { return k.indexOf("SummaryData_") === 0 && Array.isArray(summary[k]); })
      .sort()
      .forEach(function (k) {
        summary[k].forEach(function (f) {
          fields.push({ field: String(f.FieldName || "").trim(), value: f.FieldValue });
        });
      });
    return { period: summary.SummaryPeriod || null, fields };
  }

  const gridResult = await safePostJson(`${baseUrl}/TNAV9/api/ManualInOut/GetGridDataByCriteria/`, gridPayload, jsonHeaders);
  const recordList = rowsOf(gridResult.body);
  tabs = buildTabs(tabLinks, typeValues, gridResult.body, recordList);

  await postFixedAndRejected(firstTabPage(recordList));
  await postSummary(summaryTokenOf(gridResult.body, recordList));

  /* -------------------------------------------------
   * One tab's dates (showTab): "what are the dates in the Pending tab"
   * and the like. The tab is opened the way the screen opens it
   * (GetManuallyTimeFixedData -> GetManualRejectedData with its page),
   * and only the days on that tab are returned - nothing is asked for
   * and nothing is sent. The tab is matched by the screen's own label.
   * ------------------------------------------------- */
  if (wantsTab) {
    const norm = function (s) { return String(s || "").toLowerCase().replace(/[^a-z]/g, ""); };
    const wanted = norm(args.showTab);
    const tab = tabs.find(function (t) {
      const label = norm(t.label), member = norm(t.member);
      return member === wanted || label === wanted || (wanted.length >= 3 && (label.indexOf(wanted) === 0 || wanted.indexOf(label) === 0 || wanted.indexOf(member) === 0));
    }) || null;
    if (!tab) {
      return invalid(`There is no "${args.showTab}" tab on the Manual In and Out screen. The tabs are: ${tabs.map(function (t) { return t.label; }).join(", ")}.`, {
        missingFields: ["Tab"],
        availableTabs: tabs.map(function (t) { return t.label; })
      });
    }
    await openTab(tab);

    const who = typeof employeeLabel !== "undefined" ? employeeLabel : null;
    const days = recordList.filter(function (r) { return inTab(r, tab); }).map(function (r) {
      return {
        date: r.InDateText,
        day: r.DayAbbreviation || null,
        shift: r.ShiftAbbreviation || null,
        inTime: hasTime(r.InTime) ? (r.InTimeText || hhmmToText(r.InTime)) : null,
        outDate: hasTime(r.OutTime) ? (r.OutDateText || null) : null,
        outTime: hasTime(r.OutTime) ? (r.OutTimeText || hhmmToText(r.OutTime)) : null,
        status: r.RecordStatusText || null
      };
    });
    const SHOWN = 60;
    const listed = days.slice(0, SHOWN).map(function (d) { return d.date; }).join(", ");
    return {
      tab: tab.label,
      employee: who,
      count: days.length,
      searchRange: { fromDate: fromDateText, toDate: toDateText },
      days,
      message: days.length > 0
        ? `${who ? `${who} has` : "There are"} ${days.length} date${days.length === 1 ? "" : "s"} on the ${tab.label} tab between ${fromDateText} and ${toDateText}: ${listed}${days.length > SHOWN ? ` ... and ${days.length - SHOWN} more` : ""}.`
        : `There are no dates on the ${tab.label} tab${who ? ` for ${who}` : ""} between ${fromDateText} and ${toDateText}.`
    };
  }
  const gridRow = recordList.find(function (item) {
    return isoDayOf(item.DatInDate) === targetIsoDay;
  });

  if (!gridRow) {
    return invalid(`${dateText} is not in your Manual In and Out grid between ${fromDateText} and ${toDateText} - there is no attendance day recorded for that date. Please check the date and try again.`, {
      missingFields: ["Date"],
      searchRange: { dateSelectMode: requestedMode, fromDate: fromDateText, toDate: toDateText },
      diagnostics: { rosterGroup, rosterCode, rowsReturned: recordList.length }
    });
  }

  if (tabs.length === 0) {
    return {
      error: true,
      message: "Could not read the tabs of your Manual In and Out screen, so the day cannot be placed. Please try again, or use the screen directly.",
      diagnostics: { tabLinksFound: tabLinks.length, recordTypeValues: typeValues, pageUrl }
    };
  }

  /* -------------------------------------------------
   * Opening a tab, the way the screen does it (captured on loading the
   * Pending, Valid Swipes and Off Shifts tabs): GetManuallyTimeFixedData
   * -> GetManualRejectedData, both posted the SAME array - the tab's
   * on-screen page of rows. The page opened is the one holding the day.
   * ------------------------------------------------- */
  async function openTab(tab) {
    const source = recordList.filter(function (r) { return inTab(r, tab); });
    const index = source.findIndex(function (r) { return isoDayOf(r.DatInDate) === targetIsoDay; });
    const pageIndex = index >= 0 && pageSize ? Math.floor(index / pageSize) : 0;
    const pageRows = pageOf(source.map(function (r) { return toEditRow(r, noReasonCode); }), pageIndex);
    const opened = await postFixedAndRejected(pageRows);
    return {
      source,
      pageIndex,
      rows: pageRows.map(function (r) { return withManualHighlight(r, opened.fixedList); }),
      indexOnPage: index < 0 ? -1 : (pageSize ? index - (pageIndex * pageSize) : index),
      fixedList: opened.fixedList,
      rejectedList: opened.rejectedList
    };
  }

  function historyOf(opened) {
    return {
      previouslyManuallyFixed: opened.fixedList.some(function (r) {
        return isoDayOf(r.DatInDate) === targetIsoDay
          && (!gridRow.EmpDisplayNumber || !r.EmpDisplayNumber || r.EmpDisplayNumber === gridRow.EmpDisplayNumber);
      }),
      previouslyRejected: opened.rejectedList.some(function (r) { return isoDayOf(r.DatInDate) === targetIsoDay; })
    };
  }

  const pendingTab = tabByMember(PENDING_TAB);
  const ownTab = tabByMember(OWN_TAB);

  /* A day on the Pending tab is in the approval process - the screen
   * disables every cell of it, so nothing further is loaded or sent.
   * A pending off shift day is listed on Off Shifts too; Pending wins. */
  if (inTab(gridRow, pendingTab)) {
    const pendingRequest = await loadPendingRequest(gridRow);
    return {
      pending: true,
      message: `${dateText} is in the pending process (status ${pendingRequest.status || "-"}), so you cannot edit or submit a manual In and Out for this date.${pendingRequest.text}`,
      day: describeDay(gridRow),
      pendingRequest
    };
  }

  /* A day on another tab belongs to the tool that drives that tab. */
  if (!inTab(gridRow, ownTab)) {
    const rowTabs = tabsOf(gridRow);
    const home = rowTabs.find(function (t) { return TOOL_FOR_TAB[t.member]; }) || rowTabs[0] || null;
    const day = describeDay(gridRow);
    if (home) Object.assign(day, historyOf(await openTab(home)));
    const useTool = home ? (TOOL_FOR_TAB[home.member] || null) : null;
    return {
      wrongTab: true,
      useTool,
      message: home
        ? `${dateText} is on the ${home.label} tab (In: ${day.inDate || dateText} ${day.inTime || "-"}, Out: ${day.outDate || dateText} ${day.outTime || "-"}, status ${day.status || "-"}), not on the ${ownTab ? ownTab.label : OWN_TAB} tab.${useTool ? ` Use the ${useTool} tool for it.` : ""}`
        : `${dateText} is not on any tab of your Manual In and Out screen, so nothing can be submitted for it.`,
      day
    };
  }

  /* -------------------------------------------------
   * Step 3: the day is on the Off Shifts tab - open it (captured "after
   * click the off shifts tab") on the page holding the day.
   * ------------------------------------------------- */
  const opened = await openTab(ownTab);
  const offSourceRows = opened.source;
  const offPageIndex = opened.pageIndex;
  const tabRows = opened.rows;
  const rowIndexOnPage = opened.indexOnPage;
  const targetRow = tabRows[rowIndexOnPage];
  const history = historyOf(opened);
  const previouslyManuallyFixed = history.previouslyManuallyFixed;
  const previouslyRejected = history.previouslyRejected;

  const currentInText = hasTime(targetRow.InTime) ? (targetRow.InTimeText || hhmmToText(targetRow.InTime)) : null;
  const currentOutText = hasTime(targetRow.OutTime) ? (targetRow.OutTimeText || hhmmToText(targetRow.OutTime)) : null;

  /* Locked or disabled rows cannot be written to. */
  const blockers = [];
  if (targetRow.IsLockedRecord === true) blockers.push("the record is locked");
  if (targetRow.IsTimeAdjLocked === 1) blockers.push("time adjustment is locked");
  if (targetRow.IsPeriodLocked === 1) blockers.push("the attendance period is locked");
  if (targetRow.IsEnabled === false) blockers.push("the record is not editable");
  if (targetRow.IsAdjustmentEnabled === false) blockers.push("adjustments are disabled for this record");

  if (blockers.length > 0) {
    return invalid(`An off shift manual In and Out cannot be submitted for ${dateText} because ${blockers.join(" and ")}. Please contact HR Admin.`, {
      needsInput: false,
      locked: true,
      day: Object.assign(describeDay(gridRow), history)
    });
  }

  /* -------------------------------------------------
   * Step 4: the day's shift, shown before anything is asked. Filling
   * the record loads the day's breaks (captured "when fill the record
   * details": GetEmployeeBreaksByDate -> GetCommentHistoryByDate, both
   * keyed by the row's own EmpNumber token and date); the recorded
   * breaks are part of the shift details and are carried on the submit.
   * ------------------------------------------------- */
  const dayWindow = parseGraceWindow(targetRow.ShiftToolTip);
  const dayInfo = {
    shift: targetRow.ShiftAbbreviation || null,
    dayType: targetRow.DayAbbreviation || null,
    allowedFrom: dayWindow ? dayWindow.startText : null,
    allowedTo: dayWindow ? dayWindow.endText : null,
    canEndNextDay: dayWindow ? dayWindow.spansNextDay : (targetRow.IsMidNightShift === 1),
    shiftToolTip: targetRow.ShiftToolTip || null
  };

  const rowEmpToken = targetRow.EmpNumber || empNumber;
  const rowDateText = targetRow.InDateText || dateText;

  const breaksResult = await safePostJson(
    `${baseUrl}/TNAV9/api/ManualInOut/GetEmployeeBreaksByDate/`,
    { empNumber: rowEmpToken, datInDateText: rowDateText },
    ajaxHeaders
  );
  const existingBreaks = Array.isArray(breaksResult.body) ? breaksResult.body : [];
  const shiftDetails = shiftDetailsOf(targetRow, dayWindow, existingBreaks);

  /* -------------------------------------------------
   * Step 5: In Date, In Time, Out Date and Out Time are always asked
   * for, all four, with anything already recorded offered as a
   * suggestion - never assumed. An off shift day's window can reach
   * into the next day, so the Out Date is the user's call. Breaks are
   * optional - none, one or several.
   * ------------------------------------------------- */
  const suggestedInDateText = targetRow.InDateText || dateText;
  const suggestedOutDateText = targetRow.OutDateText || dateText;
  const requestedBreaks = requestedBreaksOf(args);

  /* The screen submits an In on its own, an Out on its own, or both - so
   * one side is enough. A side is its date and its time together: a time
   * given without its date, or a date without its time, is asked for. The
   * side left out keeps what the grid has for it. */
  const givesIn = !!(args.inDate || args.inTime);
  const givesOut = !!(args.outDate || args.outTime);
  const missing = [];
  if (!givesIn && !givesOut && requestedBreaks.length === 0) {
    missing.push("In Date and In Time, and/or Out Date and Out Time");
  } else {
    if (givesIn && !args.inDate) missing.push("In Date");
    if (givesIn && !args.inTime) missing.push("In Time");
    if (givesOut && !args.outDate) missing.push("Out Date");
    if (givesOut && !args.outTime) missing.push("Out Time");
  }
  if (!args.reason) missing.push("Reason");

  if (missing.length > 0) {
    return {
      needsInput: true,
      message: `${dateText} is on the ${ownTab.label} tab. ${shiftDetailsText(shiftDetails)} Please give me the following to submit your manual In and Out for it: ${missing.join(", ")}. You can give only the In (date and time), only the Out, or both. Dates are ${dateFormatName} and times are HH:mm.${dayInfo.canEndNextDay ? ` The day's window runs ${dayInfo.allowedFrom} to ${dayInfo.allowedTo}, so the Out Date may be the following day - ask, do not assume.` : ""} You can also add one or more breaks, each with a Break In Time and a Break Out Time - breaks are optional.`,
      missingFields: missing,
      shiftDetails,
      suggested: { inDate: suggestedInDateText, inTime: currentInText, outDate: suggestedOutDateText, outTime: currentOutText },
      current: Object.assign({
        date: dateText,
        tabs: tabsOf(gridRow).map(function (t) { return t.label; }),
        inDate: suggestedInDateText,
        outDate: suggestedOutDateText,
        inTime: currentInText,
        outTime: currentOutText,
        status: targetRow.RecordStatusText || null,
        previouslyManuallyFixed,
        previouslyRejected
      }, dayInfo)
    };
  }

  /* -------------------------------------------------
   * Validate the values.
   * ------------------------------------------------- */
  if (args.inTime && !isValidHHMM(args.inTime)) {
    return invalid("In Time must be in HH:mm 24-hour format, e.g. 08:30.", { missingFields: ["In Time"], shiftDetails });
  }
  if (args.outTime && !isValidHHMM(args.outTime)) {
    return invalid("Out Time must be in HH:mm 24-hour format, e.g. 17:30.", { missingFields: ["Out Time"], shiftDetails });
  }

  const parsedInDateText = args.inDate ? parseCultureDate(args.inDate) : parseCultureDate(suggestedInDateText);
  if (!parsedInDateText) return invalid(`Invalid In Date. Please provide it as ${dateFormatName}.`, { missingFields: ["In Date"], shiftDetails });
  const parsedOutDateText = args.outDate ? parseCultureDate(args.outDate) : parseCultureDate(suggestedOutDateText);
  if (!parsedOutDateText) return invalid(`Invalid Out Date. Please provide it as ${dateFormatName}.`, { missingFields: ["Out Date"], shiftDetails });

  const breakShapeProblem = checkBreakShapes(requestedBreaks, existingBreaks);
  if (breakShapeProblem) return Object.assign(breakShapeProblem, { shiftDetails });

  const finalInText = args.inTime ? normaliseHHMM(args.inTime) : (currentInText || "");
  const finalOutText = args.outTime ? normaliseHHMM(args.outTime) : (currentOutText || "");
  const finalInDateText = formatCultureDate(parsedInDateText);
  const finalOutDateText = formatCultureDate(parsedOutDateText);
  const inKey = toMinuteKey(parsedInDateText, finalInText);
  const outKey = toMinuteKey(parsedOutDateText, finalOutText);
  const warnings = [];

  const inChanged = finalInText !== (currentInText || "") || finalInDateText !== suggestedInDateText;
  const outChanged = finalOutText !== (currentOutText || "") || finalOutDateText !== suggestedOutDateText;

  if (!inChanged && !outChanged && requestedBreaks.length === 0) {
    return {
      noChanges: true,
      message: `The values you gave match what is already recorded for ${dateText} (In: ${finalInDateText} ${currentInText || "-"}, Out: ${finalOutDateText} ${currentOutText || "-"}). There is nothing to submit - give a different In or Out, or add a break.`,
      shiftDetails,
      current: Object.assign({ date: dateText, inTime: currentInText, outTime: currentOutText }, dayInfo)
    };
  }

  // The Out has to come after the In, on their full date-times.
  /* -------------------------------------------------
   * Midnight crossover. A shift can end after midnight, on the next day's
   * date. The screen then refuses an In that is not later than the
   * previous day's Out, or an Out that is not earlier than the next day's
   * In, and saves neither day (captured: 25/11 In 00:00, Out 26/11 03:00
   * with 26/11 In 26/11 00:00 -> Status false, "Employee In-Time should
   * be greater than shift start cutoff time", nothing submitted). The
   * neighbouring days' times come from the grid; a neighbour still in the
   * approval process shows no times there (-1), so its requested times
   * come from its pending request (GetEmployeePendingApprovalData, the Pending
   * tab's own details call).
   * ------------------------------------------------- */
  /* The other days the user asked for in the same request and that are
   * not submitted yet (otherEntries). The screen submits such days together
   * and refuses them all when two of them overlap across midnight, so their
   * values count here as those days' own - each day's preview shows the
   * overlap before anything is confirmed or submitted. */
  function parseEntryDate(value) {
    const text = String(value || "").trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    return parseCultureDate(text) || (iso ? { yyyy: iso[1], mm: iso[2], dd: iso[3] } : null);
  }

  function sameRequestEntry(day) {
    const list = Array.isArray(args.otherEntries) ? args.otherEntries : [];
    const isClock = function (v) {
      const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || "").trim());
      return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59;
    };
    for (const e of list) {
      if (!e || typeof e !== "object") continue;
      const entryDay = parseEntryDate(e.date || e.inDate);
      if (!entryDay || toDateKey(entryDay) !== toDateKey(day)) continue;
      const side = function (dateValue, timeValue) {
        const parsed = parseEntryDate(dateValue) || (timeValue ? entryDay : null);
        if (!parsed || !isClock(timeValue)) return null;
        const clock = normaliseHHMM(timeValue);
        const key = toMinuteKey(parsed, clock);
        return key === null ? null : { key, parsed, dateText: formatCultureDate(parsed), time: clock };
      };
      return { in: side(e.inDate, e.inTime), out: side(e.outDate, e.outTime) };
    }
    return null;
  }

  async function neighbourTimes(offset, fromDay) {
    const base = fromDay || parsedDate;
    const day = base ? addDays(base, offset) : null;
    if (!day) return null;
    const row = recordList.find(function (r) { return isoDayOf(r.DatInDate) === `${day.yyyy}-${day.mm}-${day.dd}`; });
    const entry = sameRequestEntry(day);
    if (!row && !entry) return null;
    if (!row) return { day, dateText: formatCultureDate(day), in: entry.in, out: entry.out, pending: false, sameRequest: true };
    function edge(dateIso, time, text) {
      const parsed = isoToParsed(dateIso);
      if (!parsed || !hasTime(time)) return null;
      const clock = text || hhmmToText(time);
      const key = toMinuteKey(parsed, clock);
      return key === null ? null : { key, parsed, dateText: formatCultureDate(parsed), time: clock };
    }
    const found = {
      day,
      dateText: row.InDateText || formatCultureDate(day),
      in: edge(row.InDate, row.InTime, row.InTimeText),
      out: edge(row.OutDate, row.OutTime, row.OutTimeText),
      pending: false
    };
    const window = parseGraceWindow(row.ShiftToolTip);
    if (inTab(row, pendingTab)) {
      const res = await safePostJson(`${baseUrl}/TNAV9/api/ManualInOut/GetEmployeePendingApprovalData/`, {
        empNumber: row.EmpNumber || empNumber,
        datInDateText: row.InDateText || formatCultureDate(day)
      }, ajaxHeaders);
      (Array.isArray(res.body) ? res.body : []).forEach(function (p) {
        const m = p.MClockData || {};
        const requested = edge(m.NewDate, m.NewTime, null);
        // Only a time inside that day's own allowed window (its ShiftToolTip) belongs to that day.
        if (!requested || (window && (requested.key < window.start || requested.key > window.end))) return;
        // Which time it is, as the request names it (TimeModeText: "In Time" / "Out Time").
        const mode = String(p.TimeModeText || "");
        if (/out/i.test(mode)) found.out = requested;
        else if (/in/i.test(mode)) found.in = requested;
        else return;
        found.pending = true;
      });
    }
    // A value given for that day in the same request replaces what is recorded or requested.
    if (entry) {
      if (entry.in) found.in = entry.in;
      if (entry.out) found.out = entry.out;
      found.sameRequest = !!(entry.in || entry.out);
    }
    return found;
  }

  /* A neighbouring day with no time yet to compare with can still be
   * overlapped: its own allowed window (its ShiftToolTip) shows where its
   * swipes may fall. The preview says so before anything is confirmed, so a
   * day is not submitted that would make the neighbour's submit refused. */
  /* The dates checked are only the ones the user entered in this request -
   * the day being submitted and otherEntries - nothing is assumed about any
   * other date. Each entered date is checked against the day before and the
   * day after it: another entered date when there is one, otherwise what
   * that day already holds (recorded in the grid, or requested and waiting
   * for approval). A shift that ends on the following date is therefore
   * checked against that date. Every pair is checked here, before the
   * preview, so no entered date is submitted while two of them overlap. */
  const dayTimesCache = {};
  async function timesOf(day) {
    const k = toDateKey(day);
    if (Object.prototype.hasOwnProperty.call(dayTimesCache, k)) return dayTimesCache[k];
    let value;
    if (parsedDate && k === toDateKey(parsedDate)) {
      value = {
        day,
        dateText,
        in: inKey !== null ? { key: inKey, parsed: parsedInDateText, dateText: finalInDateText, time: finalInText } : null,
        out: outKey !== null ? { key: outKey, parsed: parsedOutDateText, dateText: finalOutDateText, time: finalOutText } : null,
        source: "current"
      };
    } else {
      const found = await neighbourTimes(0, day);
      value = found ? Object.assign(found, { source: found.sameRequest ? "entered" : (found.pending ? "pending" : "recorded") }) : null;
    }
    dayTimesCache[k] = value;
    return value;
  }
  function sourceText(times) {
    if (times.source === "current") return "the date you are submitting";
    if (times.source === "entered") return "which you entered in this same request";
    if (times.source === "pending") return "submitted and waiting for approval";
    return "already recorded";
  }

  const enteredDays = [];
  if (parsedDate) enteredDays.push(parsedDate);
  (Array.isArray(args.otherEntries) ? args.otherEntries : []).forEach(function (e) {
    const d = e && typeof e === "object" ? parseEntryDate(e.date || e.inDate) : null;
    if (d && !enteredDays.some(function (x) { return toDateKey(x) === toDateKey(d); })) enteredDays.push(d);
  });
  enteredDays.sort(function (a, b) { return toDateKey(a) - toDateKey(b); });
  const otherEnteredDates = enteredDays
    .filter(function (d) { return !parsedDate || toDateKey(d) !== toDateKey(parsedDate); })
    .map(formatCultureDate);

  for (const day of enteredDays) {
    const pairs = [[addDays(day, -1), day], [day, addDays(day, 1)]];
    for (const pair of pairs) {
      const earlier = await timesOf(pair[0]);
      const later = await timesOf(pair[1]);
      if (!earlier || !later || !earlier.out || !later.in || later.in.key > earlier.out.key) continue;
      const pastMidnight = toDateKey(earlier.out.parsed) > toDateKey(earlier.day);
      const enteredBoth = earlier.source !== "recorded" && earlier.source !== "pending"
        && later.source !== "recorded" && later.source !== "pending";
      // What the user is asked to change: the side that belongs to the date being submitted, else the entered one.
      const fixLater = later.source === "current" || (earlier.source !== "current" && later.source === "entered");
      return invalid(`The In of ${later.dateText} (${later.in.dateText} ${later.in.time}, ${sourceText(later)}) is not later than the Out of ${earlier.dateText} (${earlier.out.dateText} ${earlier.out.time}, ${sourceText(earlier)}${pastMidnight ? " - that shift runs past midnight" : ""}). The two days overlap across midnight, which the system does not accept ("Employee In-Time should be greater than shift start cutoff time")${enteredBoth ? ", so neither day is submitted" : ""}. Please give ${fixLater ? `an In for ${later.dateText} later than ${earlier.out.dateText} ${earlier.out.time}` : `an Out for ${earlier.dateText} earlier than ${later.in.dateText} ${later.in.time}`}.`, Object.assign({
        missingFields: fixLater ? [`In Date (${later.dateText})`, `In Time (${later.dateText})`] : [`Out Date (${earlier.dateText})`, `Out Time (${earlier.dateText})`],
        midnightCrossover: true,
        overlap: {
          earlierDay: { date: earlier.dateText, outDate: earlier.out.dateText, outTime: earlier.out.time, source: earlier.source },
          laterDay: { date: later.dateText, inDate: later.in.dateText, inTime: later.in.time, source: later.source }
        },
        checkedDates: enteredDays.map(formatCultureDate),
        // Nothing is submitted for any entered date while two of them overlap.
        submitNeither: enteredBoth
      }, { shiftDetails }));
    }
  }

  if (inKey !== null && outKey !== null && outKey <= inKey) {
    return invalid(`The Out time ${finalOutText} on ${finalOutDateText} is not after the In time ${finalInText} on ${finalInDateText}. Please check the In and Out dates and times.`, {
      missingFields: ["Out Date", "Out Time"],
      shiftDetails,
      current: Object.assign({ date: dateText, inTime: finalInText, outTime: finalOutText }, dayInfo)
    });
  }

  let outTimeExceedsGrace = false;
  if (dayWindow) {
    if (inKey !== null && (inKey < dayWindow.start || inKey > dayWindow.end)) {
      warnings.push(`The In time ${finalInText} on ${finalInDateText} falls outside the day's allowed window (${targetRow.ShiftToolTip}).`);
    }
    if (outKey !== null && (outKey < dayWindow.start || outKey > dayWindow.end)) {
      outTimeExceedsGrace = true;
      warnings.push(`The Out time ${finalOutText} on ${finalOutDateText} falls outside the day's allowed window (${targetRow.ShiftToolTip}). Confirming will submit it anyway, the same as accepting the warning in the UI.`);
    }
  }

  // Every break has to sit inside the In -> Out span and the day's window, clear of every other break.
  const breakCheck = placeBreaks(requestedBreaks, {
    inParsed: parsedInDateText,
    outParsed: parsedOutDateText,
    inKey,
    outKey,
    inText: finalInText,
    outText: finalOutText,
    inDateText: finalInDateText,
    outDateText: finalOutDateText
  }, dayWindow, existingBreaks);
  if (breakCheck.response) return Object.assign(breakCheck.response, { shiftDetails });
  const placedBreaks = breakCheck.placed;

  const commentHistoryResult = await safePostJson(
    `${baseUrl}/TNAV9/api/ManualInOut/GetCommentHistoryByDate/`,
    { empNumber: rowEmpToken, datInDateText: rowDateText },
    ajaxHeaders
  );
  const commentHistory = (Array.isArray(commentHistoryResult.body) ? commentHistoryResult.body : [])
    .map(function (c) {
      return {
        time: hhmmToText(c.NewTime) || null,
        timeType: c.TimeModeText || null,
        action: c.ActionTypeText || null,
        status: c.Status || null,
        submitComment: c.SubmitComment || null,
        approvalComment: c.ApprovalComment || null,
        editedOn: c.EditDateTime || null
      };
    });

  const previewData = Object.assign({
    date: dateText,
    inDate: finalInDateText,
    inTime: { current: currentInText, submitted: finalInText },
    outDate: finalOutDateText,
    outTime: { current: currentOutText, submitted: finalOutText },
    outIsNextDay: finalOutDateText !== finalInDateText,
    breaks: placedBreaks.map(function (b) {
      return {
        changesRecordedBreak: b.breakNo,
        breakInTime: b.inText,
        breakOutTime: b.outText,
        startDate: formatCultureDate(b.start),
        endDate: formatCultureDate(b.end)
      };
    }),
    recordedBreaks: shiftDetails.recordedBreaks,
    reason: args.reason,
    commentHistory,
    previouslyManuallyFixed,
    previouslyRejected,
    warnings
  }, dayInfo);

  /* -------------------------------------------------
   * Step 6: nothing is written until the user confirms.
   * ------------------------------------------------- */
  /* The submit only goes ahead for the exact values the user saw in a
   * preview: the preview carries a token made from those values, and
   * confirmed:true without that token - or with one for other values -
   * returns the preview again instead of submitting. Every check above has
   * then run and been shown before the user is asked to confirm. */
  const previewToken = (function (text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(36);
  })(JSON.stringify(previewData));
  const confirmedThisPreview = args.confirmed === true && String(args.previewToken || "") === previewToken;

  if (!confirmedThisPreview) {
    return {
      needsConfirmation: true,
      previewToken,
      // confirmed:true came without this preview's token: nothing was submitted - show this preview and ask again.
      notSubmitted: args.confirmed === true ? "Nothing was submitted - these values have not been confirmed by the user yet. Show this preview and ask for confirmation." : undefined,
      preview: previewData,
      shiftDetails,
      // The shift is shown with the preview too - the user may have given every value up front.
      message: shiftDetailsText(shiftDetails) + (otherEnteredDates.length > 0 ? ` Checked for midnight overlap together with the other date(s) you entered: ${otherEnteredDates.join(", ")} - no overlap.` : "") + " " + (warnings.length > 0
        ? `Please review your off shift manual In and Out for ${dateText} below - note the warnings - and confirm before I submit it.`
        : `Please review your off shift manual In and Out for ${dateText} below and confirm before I submit it.`),
      confirmationPrompt: "Are you sure the data above is correct? Reply yes to submit, or no to make changes."
    };
  }

  /* -------------------------------------------------
   * Step 7: submit. The captured submit posts the Off Shifts page on
   * screen as {PageMode, ManualInOutDetailList}; on the selected row the
   * ISO InDate/OutDate move with the texts, a changed time goes as an
   * "HH.MM" string, each changed cell is marked ChangeCell_Highlight,
   * and the day's breaks go as one list - the recorded ones carried, the
   * new ones appended (captured: SeqNo 1 and 2, both ActionType 1). An
   * unchanged time keeps the value the grid gave it.
   * ------------------------------------------------- */
  function buildUpdatedRow(row, forceOutTimeExceedConfirmed) {
    const updated = Object.assign({}, row, {
      InDate: formatIsoDateOnly(parsedInDateText),
      OutDate: formatIsoDateOnly(parsedOutDateText),
      InTime: inChanged ? toWireTime(finalInText) : row.InTime,
      OutTime: outChanged ? toWireTime(finalOutText) : row.OutTime,
      InTimeText: finalInText || row.InTimeText,
      OutTimeText: finalOutText || row.OutTimeText,
      InDateText: finalInDateText,
      OutDateText: finalOutDateText,
      Comment: args.reason,
      IsSelected: true,
      IsOutTimeExceedConfirmed: forceOutTimeExceedConfirmed === true ? true : row.IsOutTimeExceedConfirmed === true
    });
    if (inChanged) updated.InTimeHighlightCSS = "ChangeCell_Highlight";
    if (outChanged) updated.OutTimeHighlightCSS = "ChangeCell_Highlight";

    updated.DABreakList = mergeBreaks(existingBreaks, placedBreaks, row);
    updated.BreakCount = updated.DABreakList.length > 0 ? updated.DABreakList.length : row.BreakCount;
    return updated;
  }

  // The captured payload carries exactly these two keys.
  async function submitList(list) {
    const payload = { PageMode: pageMode, ManualInOutDetailList: list };
    try {
      const raw = await fetch(`${baseUrl}/TNAV9/api/ManualInOut/SubmitManualAdjustment/`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify(payload),
        redirect: "follow"
      });
      const result = await raw.json().catch(function () { return {}; });
      return { raw, result, payload };
    } catch (e) {
      return { raw: { ok: false, status: 0 }, result: {}, payload };
    }
  }

  /* The server's own verdict. Status true with failCount above zero is a
   * partial failure; its reason is the DataList entry for this day. */
  function succeeded(attempt) {
    return attempt.raw.ok
      && attempt.result
      && attempt.result.Status === true
      && !(Number(attempt.result.failCount) > 0);
  }

  function rowResultOf(result) {
    const list = result && Array.isArray(result.DataList) ? result.DataList : [];
    return list.find(function (d) { return isoDayOf(d && d.DatInDate) === targetIsoDay; }) || null;
  }

  function listWith(updatedRow) {
    return tabRows.map(function (row, idx) {
      if (idx === rowIndexOnPage) return updatedRow;
      return Object.assign({}, row, { IsSelected: false });
    });
  }

  let updatedRow = buildUpdatedRow(targetRow, outTimeExceedsGrace);
  let submitAttempt = await submitList(listWith(updatedRow));
  let retriedWithGraceConfirmed = false;
  let retriedWithSingleRow = false;

  /* The page shows an "out time exceeds the configured grace" dialog and
   * resubmits with the flag set once the user clicks OK. Our confirm step
   * is that OK, so replay it if the server asks for it. */
  if (!succeeded(submitAttempt) && !outTimeExceedsGrace) {
    const askedForConfirmation = (submitAttempt.result && (submitAttempt.result.IsConfirmationRequired === true || submitAttempt.result.IsConfirmMessage === true))
      || (Array.isArray(submitAttempt.result && submitAttempt.result.ManualInOutDetailList)
        && submitAttempt.result.ManualInOutDetailList.some(function (r) { return r && r.IsConfirmationRequired === true; }));
    if (askedForConfirmation || gridRow.IsTimeExceedsConfiguredGrace === true || gridRow.IsConfirmationRequired === true) {
      updatedRow = buildUpdatedRow(targetRow, true);
      submitAttempt = await submitList(listWith(updatedRow));
      retriedWithGraceConfirmed = true;
    }
  }

  // A 5xx on the full page can mean the server choked on an unrelated
  // row - retry once with only the row being written to.
  if (!succeeded(submitAttempt) && submitAttempt.raw.status >= 500) {
    submitAttempt = await submitList([updatedRow]);
    retriedWithSingleRow = true;
  }

  const submitRaw = submitAttempt.raw;
  const submitResult = submitAttempt.result;
  const submitRowResult = rowResultOf(submitResult);

  if (!succeeded(submitAttempt)) {
    const instance = submitResult && submitResult.instance ? String(submitResult.instance) : "";
    const instanceTrace = instance.includes(":") ? instance.split(":").pop() : null;
    const serverMessage = (submitRowResult && submitRowResult.Message)
      || (submitResult && submitResult.Message)
      || (submitResult && submitResult.detail)
      || null;
    const diagnostics = {
      submitHttpStatus: submitRaw.status,
      retriedWithGraceConfirmed,
      retriedWithSingleRow,
      selectedDate: dateText,
      tab: ownTab.label,
      offShiftRowCount: offSourceRows.length,
      offPageIndex,
      pageSize,
      rowIndexOnPage,
      totalRowsSubmitted: (submitAttempt.payload.ManualInOutDetailList || []).length,
      breaksAdded: placedBreaks.length,
      existingBreakCount: existingBreaks.length,
      pageUrl,
      culture,
      rosterGroup,
      rosterCode,
      dateSelectMode: requestedMode,
      fromDateText,
      toDateText,
      selectedRowBeforeUpdate: pickRowDebug(targetRow),
      selectedRowAfterUpdate: pickRowDebug(updatedRow),
      traceId: (submitResult && submitResult.traceId) || instanceTrace || null,
      errorCode: (submitResult && submitResult.errorCode) || null
    };

    // The server answered and said why - a validation answer, relayed as is.
    if (serverMessage && submitRaw.status > 0 && submitRaw.status < 500) {
      return invalid(serverMessage, {
        submitted: false,
        preview: previewData,
        apiResponse: submitResult,
        warnings,
        diagnostics
      });
    }

    return {
      error: true,
      message: serverMessage || "Your off shift manual In and Out could not be submitted because the server did not respond. Please verify in the UI.",
      apiResponse: submitResult,
      warnings,
      diagnostics
    };
  }

  /* -------------------------------------------------
   * Post-submit refresh, in the order the screen calls it (captured
   * "after click submit button"):
   *   GetGridDataByCriteria (short form) -> GetManuallyTimeFixedData
   *   -> GetManualRejectedData -> GetDynamicEmployeeSummary
   * The grid comes back on its first tab, so fixed and rejected get page
   * 1 of that tab's rows. Best-effort: the submit already succeeded.
   * ------------------------------------------------- */
  const refreshGrid = await safePostJson(`${baseUrl}/TNAV9/api/ManualInOut/GetGridDataByCriteria/`, {
    FilterMode: 1,
    FromDateText: fromDateText,
    ToDateText: toDateText,
    EmpNumber: empNumber
  }, jsonHeaders);
  const refreshedList = rowsOf(refreshGrid.body);
  if (refreshedList.length > 0) tabs = buildTabs(tabLinks, typeValues, refreshGrid.body, refreshedList);

  await postFixedAndRejected(firstTabPage(refreshedList));
  const summary = shapeSummary(await postSummary(summaryTokenOf(refreshGrid.body, refreshedList)));

  // Read back the day so the confirmation reports what the server stored.
  const savedRow = refreshedList.find(function (r) { return isoDayOf(r.DatInDate) === targetIsoDay; });

  return {
    success: true,
    // No status here: the server's per-day text ("Record submitted for approval." ...) and the
    // day's tab/status are left out of the success answer; the status is asked for separately.
    message: `Your off shift manual In and Out for ${dateText} has been submitted successfully.`,
    submitted: (function (values) { delete values.commentHistory; delete values.tab; return values; })(Object.assign({}, previewData)),
    // What the grid now holds for the day - without its status or tab; the status is asked for separately.
    saved: savedRow ? (function (day) { delete day.status; delete day.tabs; return day; })(describeDay(savedRow)) : null,
    summary,
    apiResponse: { successCount: submitResult.successCount, failCount: submitResult.failCount }
  };
});