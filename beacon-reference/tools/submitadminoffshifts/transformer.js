(async function (data, args, reqOptions) {

  /* -------------------------------------------------
   * Access gate - runs before anything else, so a user without
   * the screen is refused before any argument or network work.
   * This is the admin screen (Manual In & Out, PageMode 0) - a
   * different menu entry from the team screen (1) and the self
   * screen (2). Matched with a substring test because the menu
   * entry can carry extra query parameters.
   * ------------------------------------------------- */
  if (
    !BeaconBar.user?.metaData?.menus?.some(menu =>
      menu.includes("TNAV9/ManualInOut/ManualInOut/0?mvc=1")
    )
  ) {
    return { error: true, message: "You do not have access to submit off shift manual In and Out for employees. Please contact HR Admin." };
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

  // Comparable YYYYMMDDHHmm key, for checking a time against the grace window.
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
   * Everything this tool knows about the shift comes out of the row's
   * own ShiftToolTip - nothing about it is assumed or hard-coded here:
   * "19.00 - 03.00 [Grace Start Time - 01/03/24 14:00 Grace End Time 02/03/24 13:00]"
   * The two-digit dates follow the same culture as everything else.
   * spansNextDay is what settles whether an Out on the following date
   * is legal - the captured submit shows In 18/11 02:00, Out 19/11 09:00
   * accepted on a window running 18/11/24 00:00 -> 19/11/24 10:00.
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

    // "09.00 - 18.00" - the shift's own start and end, as the API states them.
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
   * the same clock time as the number HH.MM (16:52 -> 16.52,
   * 17:30 -> 17.3), which is not decimal hours.
   * ------------------------------------------------- */
  function timeToHHMM(hhmm) {
    if (!hhmm || typeof hhmm !== "string" || !hhmm.includes(":")) return null;
    const [h, m] = hhmm.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return Number((h + (m / 100)).toFixed(2));
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

  /* SubmitManualAdjustment posts a time as the string "HH.MM" ("02.00",
   * "22.00") - the same clock value the grid returns as the number HH.MM,
   * spelled the way the captured payload spells it, for the In/Out times
   * and for the break edges alike. */
  function toWireTime(hhmm) {
    if (!hhmm || typeof hhmm !== "string" || !hhmm.includes(":")) return null;
    const [h, m] = hhmm.split(":");
    return `${pad(h)}.${pad(m)}`;
  }

  // "8:5" and "08:05" are the same time - compare and show them one way.
  function normaliseHHMM(hhmm) {
    const [h, m] = String(hhmm).trim().split(":");
    return `${pad(h)}:${pad(m)}`;
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


  /* -------------------------------------------------
   * Shapes a grid row into the row the Submit button posts.
   * GetGridDataByCriteria returns a read model; SubmitManualAdjustment,
   * GetManuallyTimeFixedData and GetManualRejectedData all take the edit
   * model - the captured payloads of all three carry exactly these 67
   * keys. The grid carries ShiftHTCode / RosterCode / SubmitStatus /
   * WFMainId / IsTimeExceedsConfiguredGrace / IsShiftAdjustmentLocked /
   * ErrMessage, none of which go back, and omits the Old* snapshot and
   * the enablement flags, all of which do.
   *
   * ReasonCode "" is normalised to the reason dropdown's own first
   * option (model.ReasonList[0], "Select a reason") while OldReasonCode
   * keeps the grid's raw "" - they differ on purpose in the capture.
   * ------------------------------------------------- */
  function toSubmitRow(row, noReasonCode) {
    const shaped = {
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
      // A locked or pending record's checkbox and cells are disabled - every captured payload sends both false for it.
      IsEnabled: row.IsEnabled !== undefined ? row.IsEnabled : isEditableRow(row),
      IsAdjustmentEnabled: row.IsAdjustmentEnabled !== undefined ? row.IsAdjustmentEnabled : isEditableRow(row),
      IsConfirmationRequired: row.IsConfirmationRequired === true,
      IsOutTimeExceedConfirmed: row.IsOutTimeExceedConfirmed === true,
      IsHighlightInTime: row.IsHighlightInTime === true,
      IsHighlightOutTime: row.IsHighlightOutTime === true,
      AbsentDays: row.AbsentDays,
      NopayHours: row.NopayHours,
      IsShiftOffShift: row.IsShiftOffShift === true
    };

    if (shaped.IsHighlightInTime) shaped.InTimeHighlightCSS = "ManualTime_Highlight";
    if (shaped.IsHighlightOutTime) shaped.OutTimeHighlightCSS = "ManualTime_Highlight";
    return shaped;
  }

  /* Once GetManuallyTimeFixedData answers, the grid marks every row whose
   * day it lists as manually fixed: the In cell when the fixed entry has
   * an In time, the Out cell when it has an Out time. The captured submit
   * carries exactly those flags, so the submitted page is marked the same way. */
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
      OldInTimeText: row.OldInTimeText,
      OldOutTimeText: row.OldOutTimeText,
      IsSelected: row.IsSelected,
      Comment: row.Comment,
      ReasonCode: row.ReasonCode,
      OldReasonCode: row.OldReasonCode,
      InOutRecordType: row.InOutRecordType,
      RecordStatus: row.RecordStatus,
      IsEnabled: row.IsEnabled,
      IsAdjustmentEnabled: row.IsAdjustmentEnabled,
      IsOutTimeExceedConfirmed: row.IsOutTimeExceedConfirmed,
      BreakCount: row.BreakCount,
      DABreakList: Array.isArray(row.DABreakList) ? row.DABreakList : null
    };
  }

  /* -------------------------------------------------
   * Step 1: who and which day. Both are needed before anything else -
   * the day is placed on its tab as soon as it is known.
   * ------------------------------------------------- */
  if (!args.employeeNumber && !args.employeeName) {
    return {
      needsInput: true,
      message: "Please tell me which employee this manual In and Out is for - their employee number or name.",
      missingFields: ["Employee"]
    };
  }

  const wantsTab = !!args.showTab;

  if (!args.date && !wantsTab) {
    return {
      needsInput: true,
      message: `Please tell me the date (${dateFormatName}) of the manual In and Out.`,
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
  // The roster, summary, message, break and comment calls go out as jQuery ajax, with its own accept.
  const ajaxHeaders = {
    "accept": "application/json, text/javascript, */*; q=0.01",
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest"
  };

  /* -------------------------------------------------
   * Page load (captured pageload1): the admin "Manual In & Out"
   * (PageMode 0) through the digest-aware URL, read for filterModel /
   * model. Every screen default this tool uses - roster groups, the
   * search component URLs, the reason dropdown, the grid page size,
   * Group By Employee - comes from these two objects.
   * ------------------------------------------------- */
  const updateUrl = await BeaconBar.executeFunction("updateUrlParams")(
    "TNAV9/ManualInOut/ManualInOut/0?mvc=1"
  );
  const pageUrl = updateUrl && updateUrl.updateUrl
    ? `${baseUrl}/${updateUrl.updateUrl}`
    : `${baseUrl}/TNAV9/ManualInOut/ManualInOut/0?mvc=1`;

  const pageRes = await fetch(pageUrl, {
    method: "GET",
    headers: { "x-requested-with": "XMLHttpRequest" },
    redirect: "follow"
  });
  const pageHtml = await pageRes.text();
  const filterModel = parseJsonLiteral(pageHtml, "filterModel") || {};
  const pageModel = parseJsonLiteral(pageHtml, "model") || {};

  // Page-hit audit the screen records on every load (captured pageLoad2) - best-effort, empty response.
  try {
    const pagePath = pageUrl.slice(baseUrl.length + 1);
    await fetch(`${baseUrl}/api/securityapi/pagehit?pageUrl=${encodeURIComponent(`../${pagePath}`)}&_=${Date.now()}`, {
      method: "GET",
      headers: {
        "accept": "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/json; charset=utf-8",
        "x-requested-with": "XMLHttpRequest"
      },
      redirect: "follow"
    });
  } catch (e) { /* the audit never blocks the tool */ }

  if (!filterModel.LoginEmpNumber) {
    return {
      error: true,
      message: "Unable to open the Manual In and Out screen. Please try again.",
      diagnostics: {
        pageUrl,
        pageStatus: pageRes.status,
        hasFilterModel: Object.keys(filterModel).length > 0,
        looksLikeLoginPage: /login/i.test(pageHtml.slice(0, 500))
      }
    };
  }

  // The employee's search token, once the search component has issued it.
  let empNumber = null;

  // The page mode the screen itself declares - the /0 of the URL loaded above.
  const pageMode = filterModel.PageMode !== undefined ? filterModel.PageMode : pageModel.PageMode;

  // The reason dropdown's first option is its "nothing selected" value.
  const reasonList = Array.isArray(pageModel.ReasonList) ? pageModel.ReasonList : [];
  const noReasonCode = reasonList.length > 0 ? reasonList[0].ReasonCode : null;

  /* The grid pages its rows, and the fixed / rejected / submit calls post
   * only the page on screen: every captured payload is exactly PageSize
   * (20) rows of one tab. A model with no page size means no paging. */
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
  const OWN_TABS = ["Offshift"];
  const PENDING_TAB = "Pending";
  const TOOL_FOR_TAB = { Regularize: "submitManualInAndOutByAdmin", Offshift: "submitAdminOffShifts", Valid: "editManualInAndOutByAdmin" };

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
        return { response: invalid(`${name} does not start within the In and Out (${spanText}). Break start and end must be within the In/Out dates and times.`, { missingFields: fields }) };
      }
      const end = placeOnSpan(bOut, span, start.key);
      if (!end) {
        return { response: invalid(`${name} must end after it starts and no later than the Out (${spanText}). Break start and end must be within the In/Out dates and times.`, { missingFields: fields }) };
      }
      if (window && (start.key < window.start || end.key > window.end)) {
        return { response: invalid(`${name} is not within the shift's allowed period (${window.startText} - ${window.endText}). Please give break times inside that period.`, { missingFields: fields }) };
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

  /* -------------------------------------------------
   * Rosters (captured GetRostersByGroupId): the groups come from
   * filterModel.RosterGroupList, the rosters of a group from
   * GetRostersByGroupId. With nothing chosen the page's own dropdowns sit
   * on their first option - the capture posted group "6" (the first
   * listed) and searched with "000058" (MAK01), its first roster.
   * ------------------------------------------------- */
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
   * The employee search component, loaded the way the page loads it
   * (captured api1): filterModel's EmployeeSearchURL renders the
   * typeahead. The typeahead element carries the two values the
   * employee calls are keyed by - data-key and data-empnumber (the
   * captured selection used exactly those, not LoginEmpNumber and not
   * the empNumber in the URL).
   * ------------------------------------------------- */
  function resolvePageRelative(rawUrl) {
    if (!rawUrl) return null;
    // Stored relative to /<sl>/TNAV9/ - "../CommonComponents/..." is /<sl>/CommonComponents/...
    const path = String(rawUrl).replace(/^(\.\.\/)+/, "").replace(/^\/+/, "");
    return `${baseUrl}/${path}`;
  }

  async function getText(url) {
    if (!url) return { status: 0, text: "" };
    try {
      const res = await fetch(`${url}${url.indexOf("?") === -1 ? "?" : "&"}_=${Date.now()}`, {
        method: "GET",
        headers: { "x-requested-with": "XMLHttpRequest" },
        redirect: "follow"
      });
      return { status: res.status, text: await res.text() };
    } catch (e) {
      return { status: 0, text: "" };
    }
  }

  async function getJson(url) {
    try {
      const res = await fetch(url, { method: "GET", headers: { "x-requested-with": "XMLHttpRequest" }, redirect: "follow" });
      const body = await res.json().catch(function () { return null; });
      return { ok: res.ok, status: res.status, body };
    } catch (e) {
      return { ok: false, status: 0, body: null };
    }
  }

  function attrOf(html, name) {
    const m = String(html || "").match(new RegExp(`${name}="([^"]+)"`));
    return m ? m[1] : null;
  }

  const searchComponent = await getText(resolvePageRelative(filterModel.EmployeeSearchURL));


  const searchKey = attrOf(searchComponent.text, "data-key")
    || ((searchComponent.text.match(/"KeyValue"\s*:\s*"([^"]+)"/) || [])[1] || null);
  const searchEmpNumber = attrOf(searchComponent.text, "data-empnumber");

  if (!searchKey || !searchEmpNumber) {
    return {
      error: true,
      message: "Unable to open the employee search. Please try again.",
      diagnostics: {
        searchComponentStatus: searchComponent.status,
        foundKey: !!searchKey,
        foundEmpNumber: !!searchEmpNumber
      }
    };
  }

  /* -------------------------------------------------
   * Selecting the employee (captured selectEmployee, selectEmployee2):
   *   GetPaginatedTypeaheadList?empNumber=<data-empnumber>&key=<data-key>
   *   -> {"results":[{"id":"000006","text":"000006 - Liam Taylor"}, ...],
   *       "pagination":{"more":true}}
   *   GetEmpNumberFromTypeahead?loggedEmpNumber=<data-empnumber>&empNumber=<id>&key=<data-key>
   *   -> {"Message":"<the employee's search token>","Status":true}
   * The feed takes no search term - it hands the admin's whole scope back
   * a page at a time (pagination.more), and the dropdown filters it. So
   * the match is made here, page by page: page 1 exactly as captured,
   * later pages as the dropdown's scroll continuation (page=N). An
   * employee number is unique and ends the search; a name keeps reading
   * so a second person of the same name is never missed.
   * ------------------------------------------------- */
  // "000006 - Liam Taylor": the number is before " - ", the name after it.
  function displayNumberOf(r) {
    const text = String(r && r.text || "");
    const sep = text.indexOf(" - ");
    return (sep === -1 ? text : text.slice(0, sep)).trim();
  }
  function displayNameOf(r) {
    const text = String(r && r.text || "");
    const sep = text.indexOf(" - ");
    return (sep === -1 ? text : text.slice(sep + 3)).trim();
  }
  function stripZeros(value) {
    return String(value || "").replace(/^0+/, "").toLowerCase();
  }

  const wantedNumber = String(args.employeeNumber || "").toLowerCase().trim();
  const wantedName = String(args.employeeName || "").toLowerCase().trim();

  function findMatches(pool) {
    let found = [];
    if (wantedNumber) {
      found = pool.filter(function (r) { return displayNumberOf(r).toLowerCase() === wantedNumber; });
      if (found.length === 0) found = pool.filter(function (r) { return stripZeros(displayNumberOf(r)) === stripZeros(wantedNumber); });
      if (found.length === 0) found = pool.filter(function (r) { return String(r.id || "").toLowerCase().trim() === wantedNumber; });
    }
    if (found.length === 0 && wantedName) {
      found = pool.filter(function (r) { return displayNameOf(r).toLowerCase() === wantedName; });
      if (found.length === 0) found = pool.filter(function (r) { return String(r.text || "").toLowerCase().includes(wantedName); });
    }
    return found;
  }

  async function typeaheadPage(page) {
    const res = await getJson(
      `${baseUrl}/CommonComponents/Search/GetPaginatedTypeaheadList/?empNumber=${encodeURIComponent(searchEmpNumber)}&key=${encodeURIComponent(searchKey)}${page > 1 ? `&page=${page}` : ""}&_=${Date.now()}`
    );
    const body = res.body || {};
    return {
      status: res.status,
      results: Array.isArray(body.results) ? body.results : [],
      more: !!(body.pagination && body.pagination.more)
    };
  }

  const seenIds = {};
  const employees = [];
  let matches = [];
  let listStatus = 0;
  for (let page = 1; page <= 100; page++) {
    const result = await typeaheadPage(page);
    if (page === 1) listStatus = result.status;
    let added = 0;
    result.results.forEach(function (r) {
      const id = String(r.id || "");
      if (id && seenIds[id]) return;
      if (id) seenIds[id] = true;
      employees.push(r);
      added++;
    });
    // A page that only repeats what is held means the feed ignored the page number.
    if (added === 0) break;
    matches = findMatches(employees);
    if (wantedNumber && matches.length > 0) break;
    if (matches.length > 1) break;
    if (!result.more) break;
  }

  if (employees.length === 0) {
    return invalid("No employees are available to you on the Manual In and Out screen. Please contact HR Admin if you expected to see employees here.", {
      needsInput: false,
      diagnostics: { listStatus }
    });
  }

  if (matches.length === 0) {
    return invalid(`Could not find "${args.employeeNumber || args.employeeName}" among the employees available to you. Please check the employee number or name.`, {
      missingFields: ["Employee"],
      diagnostics: { employeesRead: employees.length }
    });
  }

  // Never guess between people - a wrong pick writes the wrong person's attendance.
  if (matches.length > 1) {
    return {
      needsInput: true,
      message: `"${args.employeeNumber || args.employeeName}" matches more than one employee. Please tell me which one.`,
      missingFields: ["Employee"],
      candidates: matches.slice(0, 25).map(function (r) { return { employeeNumber: displayNumberOf(r), employee: r.text }; })
    };
  }
  const match = matches[0];
  let employeeLabel = String(match.text || "").trim();
  let employeeDisplayNumber = displayNumberOf(match);
  let employeeDesignation = null;

  const tokenResult = await getJson(
    `${baseUrl}/CommonComponents/Search/GetEmpNumberFromTypeahead/?loggedEmpNumber=${encodeURIComponent(searchEmpNumber)}&empNumber=${encodeURIComponent(match.id)}&key=${encodeURIComponent(searchKey)}&_=${Date.now()}`
  );
  const empToken = tokenResult.body && tokenResult.body.Status !== false ? (tokenResult.body.Message || null) : null;

  if (!empToken) {
    return {
      error: true,
      message: `Unable to open ${employeeLabel}'s Manual In and Out. Please try again.`,
      diagnostics: { tokenStatus: tokenResult.status, apiMessage: (tokenResult.body && tokenResult.body.Message) || null }
    };
  }
  empNumber = empToken;

  /* -------------------------------------------------
   * The search range. The captured search ran 01/01/2023 - 06/10/2026:
   * the first day of the year three years back, to today. It is widened
   * only as far as needed to contain the date asked about.
   * ------------------------------------------------- */
  const today = new Date();
  const targetJsDate = parsedDate ? new Date(Number(parsedDate.yyyy), Number(parsedDate.mm) - 1, Number(parsedDate.dd)) : today;
  const rangeStartJsDate = new Date(Math.min(parsedDate ? Number(parsedDate.yyyy) : today.getFullYear(), today.getFullYear() - 3), 0, 1);
  const rangeEndJsDate = targetJsDate > today ? targetJsDate : today;
  const fromDateText = formatRangeDate(rangeStartJsDate);
  const toDateText = formatRangeDate(rangeEndJsDate);

  /* -------------------------------------------------
   * Step 2: Search, as the button does it (captured "when click the
   * search button"): GetGridDataByCriteria -> GetManuallyTimeFixedData
   * -> GetManualRejectedData (both posted the SAME array: the grid's
   * first tab, first page - 20 Regularize rows) -> GetLocalizedMessage
   * (CommonSelectAllBtn) -> GetDynamicEmployeeSummary (keyed by the
   * token the grid rows come back with).
   * ------------------------------------------------- */
  const gridPayload = {
    FromDateText: fromDateText,
    ToDateText: toDateText,
    IsGroupByEmployee: typeof args.isGroupByEmployee === "boolean" ? args.isGroupByEmployee : filterModel.IsGroupByEmployee === true,
    FilterMode: "1",
    EmpNumber: empToken,
    RosterCode: rosterCode,
    callBackId: filterModel.CallBackId !== undefined ? filterModel.CallBackId : 1,
    isShowShiftHoursInShiftAdjEnabled: filterModel.isShowShiftHoursInShiftAdjEnabled === true,
    IsClientUoc: filterModel.IsClientUOC === true,
    PageMode: pageMode
  };

  function rowsOf(gridBody) {
    return (gridBody && Array.isArray(gridBody.ManualInOutDetailList)) ? gridBody.ManualInOutDetailList : [];
  }

  // The on-screen page of the tab the grid opens on - its first tab.
  function regularizePage(list) {
    const firstTab = tabs[0] || null;
    return pageOf(
      list.filter(function (r) { return inTab(r, firstTab); }).map(function (r) { return toSubmitRow(r, noReasonCode); }),
      0
    );
  }

  // The employee token the summary is keyed by - the one on the rows.
  function summaryTokenOf(gridBody, list) {
    const fromRow = list.find(function (r) { return r && r.EmpNumber; });
    if (fromRow) return fromRow.EmpNumber;
    const emp = gridBody && Array.isArray(gridBody.EmployeeList) ? gridBody.EmployeeList[0] : null;
    return (emp && emp.EmpNumber) || empToken;
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

  // The day's employee as the summary names them.
  function adoptEmployee(summaryBody) {
    const employeeData = summaryBody && summaryBody.EmployeeData;
    if (!employeeData) return;
    employeeLabel = employeeData.EmpCompleteName || employeeData.EmpDisplayName || employeeLabel;
    employeeDisplayNumber = employeeData.EmpDisplayNumber || employeeDisplayNumber;
    employeeDesignation = employeeData.Designation || employeeDesignation;
  }

  const gridResult = await safePostJson(`${baseUrl}/TNAV9/api/ManualInOut/GetGridDataByCriteria/`, gridPayload, jsonHeaders);
  const gridData = gridResult.body || {};
  const recordList = rowsOf(gridResult.body);
  tabs = buildTabs(tabLinks, typeValues, gridData, recordList);

  await postFixedAndRejected(regularizePage(recordList));

  await safePostJson(`${baseUrl}/TNAV9/api/Common/GetLocalizedMessage/`, {
    resourceKey: "CommonSelectAllBtn",
    parameter: "",
    classKey: "Common"
  }, ajaxHeaders);

  const searchSummaryBody = await postSummary(summaryTokenOf(gridData, recordList));
  adoptEmployee(searchSummaryBody);
  const summary = shapeSummary(searchSummaryBody);
  if (recordList.length === 0) {
    return invalid(`There are no attendance days for ${employeeLabel} between ${fromDateText} and ${toDateText}, so there is nothing to show or submit${dateText ? ` for ${dateText}` : ""}.`, {
      needsInput: false,
      searchRange: { fromDate: fromDateText, toDate: toDateText },
      diagnostics: gridResult.ok ? { rosterGroup, rosterCode } : { gridHttpStatus: gridResult.status, rosterGroup, rosterCode }
    });
  }

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

  /* -------------------------------------------------
   * The day-state gate. Which tab the date landed on decides
   * everything that follows, so it is settled here - before any time
   * or reason is asked for - rather than after the user has typed them.
   * ------------------------------------------------- */
  if (!gridRow) {
    return invalid(`${dateText} is not in ${employeeLabel}'s Manual In and Out grid between ${fromDateText} and ${toDateText} - there is no attendance day recorded for that date. Please check the date and try again.`, {
      missingFields: ["Date"],
      employee: employeeLabel,
      searchRange: { fromDate: fromDateText, toDate: toDateText },
      diagnostics: { rosterGroup, rosterCode, rowsReturned: recordList.length }
    });
  }

  if (tabs.length === 0) {
    return {
      error: true,
      message: "Could not read the tabs of the Manual In and Out screen, so the day cannot be placed. Please try again, or use the screen directly.",
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
    const pageRows = pageOf(source.map(function (r) { return toSubmitRow(r, noReasonCode); }), pageIndex);
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
  const rowTabs = tabsOf(gridRow);

  /* A day on the Pending tab is in the approval process - the screen
   * disables every cell of it. Opening the tab is all the screen does
   * (captured Pending Tab: GetManuallyTimeFixedData ->
   * GetManualRejectedData with the pending row, disabled); nothing is
   * asked for and nothing is sent. */
  if (inTab(gridRow, pendingTab)) {
    const day = Object.assign(describeDay(gridRow), historyOf(await openTab(pendingTab)), { employee: employeeLabel });
    const pendingRequest = await loadPendingRequest(gridRow);
    return {
      pending: true,
      message: `${dateText} is in the pending process for ${employeeLabel} (status ${pendingRequest.status || "-"}), so you cannot edit or submit a manual In and Out for this date.${pendingRequest.text}`,
      day,
      pendingRequest
    };
  }

  /* This tool drives the Off Shifts tab (captured "when click the off
   * shifts tab"). A day on another tab belongs to the tool that drives it. */
  const ownTab = rowTabs.find(function (t) { return OWN_TABS.indexOf(t.member) !== -1; }) || null;
  if (!ownTab) {
    const home = rowTabs.find(function (t) { return TOOL_FOR_TAB[t.member]; }) || rowTabs[0] || null;
    const day = Object.assign(describeDay(gridRow), { employee: employeeLabel });
    if (home) Object.assign(day, historyOf(await openTab(home)));
    const useTool = home ? (TOOL_FOR_TAB[home.member] || null) : null;
    return {
      wrongTab: true,
      useTool,
      message: home
        ? `${dateText} is on the ${home.label} tab for ${employeeLabel} (In: ${day.inDate || dateText} ${day.inTime || "-"}, Out: ${day.outDate || dateText} ${day.outTime || "-"}, status ${day.status || "-"}), not on the Off Shifts tab, so it is not submitted here.${useTool ? ` Use the ${useTool} tool for it.` : ""}`
        : `${dateText} is not on the Regularize, Pending, Valid Swipes or Off Shifts tab for ${employeeLabel} (shift ${day.shift || "-"}), so there is nothing to submit for it.`,
      day
    };
  }

  /* -------------------------------------------------
   * The day is on this tool's tab. The Submit button posts only the
   * on-screen page of the tab you are on - mixing tabs in one submit is
   * what the server rejects - so the page holding the day is opened.
   * ------------------------------------------------- */
  const opened = await openTab(ownTab);
  const tabSourceRows = opened.source;
  const tabPageIndex = opened.pageIndex;
  const tabRows = opened.rows;
  const rowIndexOnPage = opened.indexOnPage;
  const targetRow = tabRows[rowIndexOnPage];
  const history = historyOf(opened);
  const previouslyManuallyFixed = history.previouslyManuallyFixed;
  const previouslyRejected = history.previouslyRejected;

  /* -------------------------------------------------
   * Locked or disabled rows cannot be written to. Say so here so the
   * user gets the reason instead of a server refusal after confirming.
   * ------------------------------------------------- */
  const blockers = [];
  if (targetRow.IsLockedRecord === true) blockers.push("the record is locked");
  if (targetRow.IsTimeAdjLocked === 1) blockers.push("time adjustment is locked");
  if (targetRow.IsPeriodLocked === 1) blockers.push("the attendance period is locked");
  if (targetRow.IsEnabled === false) blockers.push("the record is not editable");
  if (targetRow.IsAdjustmentEnabled === false) blockers.push("adjustments are disabled for this record");

  if (blockers.length > 0) {
    return invalid(`An off shift manual In and Out cannot be submitted for ${employeeLabel} on ${dateText} because ${blockers.join(" and ")}. Please contact HR Admin.`, {
      needsInput: false,
      locked: true,
      day: Object.assign(describeDay(gridRow), history, { employee: employeeLabel })
    });
  }

  /* -------------------------------------------------
   * Step 3: the day's shift, shown before anything is asked. The day's
   * recorded breaks are part of it, so GetEmployeeBreaksByDate is loaded
   * here - keyed by the row's own EmpNumber token - and that list is
   * carried on the submit, so no recorded break is dropped.
   * ------------------------------------------------- */
  const currentInText = hasTime(targetRow.InTime) ? (targetRow.InTimeText || hhmmToText(targetRow.InTime)) : null;
  const currentOutText = hasTime(targetRow.OutTime) ? (targetRow.OutTimeText || hhmmToText(targetRow.OutTime)) : null;

  const shiftWindow = parseGraceWindow(targetRow.ShiftToolTip);

  /* What the API says about this shift, handed to the caller so the user
   * is asked for times against the real period rather than a guess. */
  const shiftInfo = {
    shift: targetRow.ShiftAbbreviation || null,
    shiftPeriod: shiftWindow ? shiftWindow.text : null,
    shiftStart: shiftWindow ? shiftWindow.shiftInClock : null,
    shiftEnd: shiftWindow ? shiftWindow.shiftOutClock : null,
    shiftAllowedFrom: shiftWindow ? shiftWindow.startText : null,
    shiftAllowedTo: shiftWindow ? shiftWindow.endText : null,
    shiftCanEndNextDay: shiftWindow ? shiftWindow.spansNextDay : (targetRow.IsMidNightShift === 1),
    isMidNightShift: targetRow.IsMidNightShift,
    shiftToolTip: targetRow.ShiftToolTip || null
  };

  const rowEmpToken = targetRow.EmpNumber || empNumber;
  const rowDateText = targetRow.InDateText || dateText;
  const requestedBreaks = requestedBreaksOf(args);

  let existingBreaks = [];
  if (requestedBreaks.length > 0 || Number(targetRow.BreakCount) > 0) {
    const breaksResult = await safePostJson(
      `${baseUrl}/TNAV9/api/ManualInOut/GetEmployeeBreaksByDate/`,
      { empNumber: rowEmpToken, datInDateText: rowDateText },
      ajaxHeaders
    );
    existingBreaks = Array.isArray(breaksResult.body) ? breaksResult.body : [];
  }
  const shiftDetails = shiftDetailsOf(targetRow, shiftWindow, existingBreaks);

  /* -------------------------------------------------
   * Step 4: In Date, In Time, Out Date and Out Time are always asked
   * for, all four, whatever is already recorded - the recorded values
   * are offered as suggestions, never assumed. A shift can end on the
   * date after it started, so the Out Date is the user's call. Breaks
   * are optional - none, one or several.
   * ------------------------------------------------- */
  const suggestedInDateText = targetRow.InDateText || dateText;
  const suggestedOutDateText = targetRow.OutDateText || dateText;
  const nextDayNote = shiftInfo.shiftCanEndNextDay
    ? ` This shift can end on the following day, so the Out Date may be ${formatCultureDate(addDays(parseCultureDate(suggestedInDateText) || parsedDate, 1))} rather than ${suggestedInDateText} - ask, do not assume.`
    : "";

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
      message: `${employeeLabel}: ${shiftDetailsText(shiftDetails)} Please give me the following to submit the off shift manual In and Out for ${employeeLabel} on ${dateText}: ${missing.join(", ")}. You can give only the In (date and time), only the Out, or both. Dates are ${dateFormatName} and times are HH:mm.${nextDayNote} You can also add one or more breaks, each with a Break In Time and a Break Out Time - breaks are optional.`,
      missingFields: missing,
      shiftDetails: Object.assign({ employee: employeeLabel, employeeNumber: employeeDisplayNumber, designation: employeeDesignation }, shiftDetails),
      employeeSummary: summary,
      suggested: { inDate: suggestedInDateText, inTime: currentInText, outDate: suggestedOutDateText, outTime: currentOutText },
      current: Object.assign({
        employee: employeeLabel,
        employeeNumber: employeeDisplayNumber,
        designation: employeeDesignation,
        date: dateText,
        tabs: tabsOf(gridRow).map(function (t) { return t.label; }),
        inDate: suggestedInDateText,
        outDate: suggestedOutDateText,
        inTime: currentInText,
        outTime: currentOutText,
        status: targetRow.RecordStatusText || null,
        previouslyManuallyFixed,
        previouslyRejected
      }, shiftInfo)
    };
  }

  /* -------------------------------------------------
   * Validate the values (HH:mm in, HH.MM on the wire).
   * ------------------------------------------------- */
  if (args.inTime && timeToHHMM(args.inTime) === null) {
    return invalid("In Time must be in HH:mm 24-hour format, e.g. 08:30.", { missingFields: ["In Time"], shiftDetails });
  }
  if (args.outTime && timeToHHMM(args.outTime) === null) {
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

  const inChanged = finalInText !== (currentInText || "") || finalInDateText !== suggestedInDateText;
  const outChanged = finalOutText !== (currentOutText || "") || finalOutDateText !== suggestedOutDateText;

  if (!inChanged && !outChanged && requestedBreaks.length === 0) {
    return {
      noChanges: true,
      message: `The values you gave match what is already recorded for ${dateText} (In: ${finalInDateText} ${currentInText || "-"}, Out: ${finalOutDateText} ${currentOutText || "-"}). There is nothing to submit - give a different In or Out, or add a break.`,
      shiftDetails,
      current: Object.assign({ date: dateText, inTime: currentInText, outTime: currentOutText }, shiftInfo)
    };
  }

  /* -------------------------------------------------
   * Check the times against the shift's grace window. The server
   * enforces this, so surface it in the preview rather than
   * letting the user confirm into a rejection.
   * ------------------------------------------------- */
  const warnings = [];
  let outTimeExceedsGrace = false;

  const inKey = toMinuteKey(parsedInDateText, finalInText);
  const outKey = toMinuteKey(parsedOutDateText, finalOutText);

  /* "Out after In" is the shift's own rule only when its allowed window
   * (the row's ShiftToolTip) lies within one day - then the Out cannot be
   * on a later date and is checked against the In. A window that runs past
   * midnight lets the Out sit on the next date (captured: In 16/01 06:00,
   * Out 17/01 10:00), so no ordering is applied there; the server decides. */
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
    if (shiftWindow && !shiftWindow.spansNextDay) {
      return invalid(`The Out time ${finalOutText} on ${finalOutDateText} is not after the In time ${finalInText} on ${finalInDateText}. This shift runs ${shiftWindow.text} and has to be swiped between ${shiftWindow.startText} and ${shiftWindow.endText}, which is all within one day. Please give an Out time later than the In time.`, {
        missingFields: ["Out Date", "Out Time"],
        shiftDetails,
        current: Object.assign({ date: dateText, inTime: finalInText, outTime: finalOutText }, shiftInfo)
      });
    }
    warnings.push(`The Out time ${finalOutText} on ${finalOutDateText} is not after the In time ${finalInText} on ${finalInDateText}. The system will decide whether it accepts this.`);
  }

  if (shiftWindow) {
    if (inKey !== null && (inKey < shiftWindow.start || inKey > shiftWindow.end)) {
      warnings.push(`The In time ${finalInText} on ${finalInDateText} falls outside the shift's allowed window (${targetRow.ShiftToolTip}).`);
    }
    if (outKey !== null && (outKey < shiftWindow.start || outKey > shiftWindow.end)) {
      outTimeExceedsGrace = true;
      warnings.push(`The Out time ${finalOutText} on ${finalOutDateText} falls outside the shift's allowed window (${targetRow.ShiftToolTip}). Confirming will submit it anyway, the same as accepting the warning in the UI.`);
    }
  }

  // Every break has to sit inside the In -> Out span and the shift's window, clear of every other break.
  const breakCheck = placeBreaks(requestedBreaks, {
    inParsed: parsedInDateText,
    outParsed: parsedOutDateText,
    inKey,
    outKey,
    inText: finalInText,
    outText: finalOutText,
    inDateText: finalInDateText,
    outDateText: finalOutDateText
  }, shiftWindow, existingBreaks);
  if (breakCheck.response) return Object.assign(breakCheck.response, { shiftDetails });
  const placedBreaks = breakCheck.placed;


  const previewData = Object.assign({
    employee: employeeLabel,
    employeeNumber: employeeDisplayNumber,
    designation: employeeDesignation,
    tab: ownTab.label,
    date: dateText,
    inDate: finalInDateText,
    outDate: finalOutDateText,
    // True when the Out lands on a later date than the In - worth showing.
    outIsNextDay: finalOutDateText !== finalInDateText,
    inTime: { current: currentInText, submitted: finalInText },
    outTime: { current: currentOutText, submitted: finalOutText },
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
    previouslyManuallyFixed,
    previouslyRejected,
    warnings
  }, shiftInfo);

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
        ? `Here is what will be submitted for ${employeeLabel} - note the warnings - please confirm before I submit it.`
        : `Here are the details that will be submitted for ${employeeLabel}. Please confirm they are correct before I submit the manual In and Out.`),
      confirmationPrompt: `Are you sure the data above is correct for ${employeeLabel}? Reply yes to submit, or no to make changes.`
    };
  }

  /* -------------------------------------------------
   * Step 7: submit. IsSelected is the row checkbox and is true
   * only on the row being written to. Every Old* field keeps its
   * pre-submit value so the server sees the before/after pair.
   * The captured selected row moves InDate/OutDate (ISO) with the
   * date texts, sends a changed time as an "HH.MM" string, and marks
   * each changed cell ChangeCell_Highlight; an unchanged time keeps
   * the value the grid gave it. The day's breaks go as one list - the
   * recorded ones carried, the new ones appended (captured Off Shifts
   * submit: SeqNo 1 and 2, both ActionType 1).
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

    if (placedBreaks.length > 0 || existingBreaks.length > 0) {
      updated.DABreakList = mergeBreaks(existingBreaks, placedBreaks, row);
      updated.BreakCount = updated.DABreakList.length;
    }
    return updated;
  }

  // The captured payload carries exactly these two keys - nothing else.
  async function submitList(detailList) {
    const payload = { PageMode: pageMode, ManualInOutDetailList: detailList };
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
  function rowResultOf(result) {
    const list = result && Array.isArray(result.DataList) ? result.DataList : [];
    return list.find(function (d) { return isoDayOf(d && d.DatInDate) === targetIsoDay; }) || null;
  }

  function succeeded(attempt) {
    return attempt.raw.ok
      && attempt.result
      && attempt.result.Status === true
      && !(Number(attempt.result.failCount) > 0);
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
   * resubmits with the flag set once the user clicks OK. Our own confirm
   * step is that OK, so replay it if the server asks and we have not
   * already set the flag from the grace check above. */
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
      outTimeExceedsGrace,
      selectedDate: dateText,
      tab: ownTab.label,
      tabRowCount: tabSourceRows.length,
      tabPageIndex,
      pageSize,
      rowIndexOnPage,
      gridRowCount: recordList.length,
      previouslyManuallyFixed,
      previouslyRejected,
      totalRowsSubmitted: (submitAttempt.payload.ManualInOutDetailList || []).length,
      breaksSubmitted: placedBreaks.length,
      existingBreakCount: existingBreaks.length,
      employee: employeeLabel,
      employeeNumber: employeeDisplayNumber,
      pageUrl,
      culture,
      rosterGroup,
      rosterCode,
      fromDateText,
      toDateText,
      payloadTopLevelKeys: Object.keys(submitAttempt.payload || {}),
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
      message: serverMessage || `The off shift manual In and Out for ${employeeLabel} could not be submitted because the server did not respond. Please verify in the UI.`,
      apiResponse: submitResult,
      warnings,
      diagnostics
    };
  }

  /* -------------------------------------------------
   * Post-submit refresh (captured Off Shifts Admin, after the submit):
   *   GetGridDataByCriteria -> GetManuallyTimeFixedData
   *   -> GetManualRejectedData -> GetDynamicEmployeeSummary
   * The refresh search is the short {FilterMode: 1, FromDateText,
   * ToDateText, EmpNumber} form; fixed / rejected both get the first
   * page of the grid's first tab (captured: the 20 Regularize rows); the
   * summary is keyed by the token the refreshed rows carry.
   * Best-effort: the submit has already succeeded.
   * ------------------------------------------------- */
  const refreshGrid = await safePostJson(`${baseUrl}/TNAV9/api/ManualInOut/GetGridDataByCriteria/`, {
    FilterMode: 1,
    FromDateText: fromDateText,
    ToDateText: toDateText,
    EmpNumber: empNumber
  }, jsonHeaders);
  const refreshedList = rowsOf(refreshGrid.body);
  if (refreshedList.length > 0) tabs = buildTabs(tabLinks, typeValues, refreshGrid.body, refreshedList);

  await postFixedAndRejected(regularizePage(refreshedList));
  const refreshedSummary = shapeSummary(await postSummary(summaryTokenOf(refreshGrid.body, refreshedList)));

  // Read back the day so the caller reports what the server actually stored.
  const savedRow = refreshedList.find(function (r) { return isoDayOf(r.DatInDate) === targetIsoDay; });

  return {
    success: true,
    // No status here: the server's per-day text ("Record submitted for approval." ...) and the
    // day's tab/status are left out of the success answer; the status is asked for separately.
    message: `The off shift manual In and Out for ${employeeLabel} on ${dateText} has been submitted successfully.`,
    submitted: (function (values) { delete values.commentHistory; delete values.tab; return values; })(Object.assign({}, previewData)),
    // What the grid now holds for the day - without its status or tab; the status is asked for separately.
    saved: savedRow ? (function (day) { delete day.status; delete day.tabs; return day; })(describeDay(savedRow)) : null,
    summary: refreshedSummary,
    apiResponse: { successCount: submitResult.successCount, failCount: submitResult.failCount }
  };
});