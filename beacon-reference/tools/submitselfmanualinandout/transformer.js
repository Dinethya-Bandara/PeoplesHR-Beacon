(async function (data, args, reqOptions) {

  /* -------------------------------------------------
   * Access gate - runs before anything else, so a user without
   * the screen is refused before any argument or network work.
   * This is the self screen (My Manual In & Out, PageMode 2) -
   * a different menu entry from the admin screen (0) and the
   * team screen (1). Matched with a substring test because the
   * menu entry can carry extra query parameters.
   * ------------------------------------------------- */
  if (
    !BeaconBar.user?.metaData?.menus?.some(menu =>
      menu.includes("TNAV9/ManualInOut/ManualInOut/2?mvc=1")
    )
  ) {
    return { error: true, message: "You do not have access to edit your manual In and Out. Please contact HR Admin." };
  }

  function pad(n) { return String(n).padStart(2, "0"); }

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

  // Rows carry DatInDate as an ISO string - the unambiguous way to match a day.
  function isoDayOf(value) {
    if (!value || typeof value !== "string") return null;
    return value.split("T")[0];
  }

  // Comparable YYYYMMDDHHmm key, for checking a time against the shift window.
  function toMinuteKey(parsed, hhmm) {
    if (!parsed || !hhmm || hhmm.indexOf(":") === -1) return null;
    const [h, m] = hhmm.split(":");
    return Number(`${parsed.yyyy}${parsed.mm}${parsed.dd}${pad(h)}${pad(m)}`);
  }

  /* -------------------------------------------------
   * Everything this tool knows about the shift comes out of the row's
   * own ShiftToolTip - nothing about it is assumed or hard-coded here:
   * "19.00 - 03.00 [Grace Start Time - 01/03/24 14:00 Grace End Time 02/03/24 13:00]"
   * The two-digit dates follow the same culture as everything else.
   *
   * spansNextDay is the fact that settles whether an Out time earlier on
   * the clock than the In time is legal. When the API's own window runs
   * past midnight the Out belongs to the following date, so "In before
   * Out" is only ever true of the full In/Out date-times - never of the
   * bare clock values. The captured UI submit proves it: a 09.00 - 18.00
   * shift with IsMidNightShift 0, window 08/11/24 05:00 -> 09/11/24 03:00,
   * was accepted with In 08/11 06:00 and Out 09/11 02:00.
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
      startDayKey: start.dayKey,
      endDayKey: end.dayKey,
      startText: start.text,
      endText: end.text,
      spansNextDay: end.dayKey > start.dayKey,
      shiftInClock: clock ? `${pad(clock[1])}:${clock[2]}` : null,
      shiftOutClock: clock ? `${pad(clock[3])}:${clock[4]}` : null,
      text: shiftText
    };
  }

  /* -------------------------------------------------
   * Which date a time belongs to is decided by the window the API
   * returned, never by a rule of our own. resolveOutDate mirrors what
   * the UI does when the user types an Out time that sits earlier on the
   * clock than the In time: keep the same date while that is legal, and
   * otherwise roll to the next date when - and only when - the shift the
   * API described actually reaches there.
   * ------------------------------------------------- */
  function addDays(parsed, days) {
    return fromJsDate(new Date(Number(parsed.yyyy), Number(parsed.mm) - 1, Number(parsed.dd) + days));
  }

  function resolveOutDate(inParsed, inHHMM, outHHMM, rowInDateText, rowOutDateText, window, isMidNightShift) {
    const sameDay = { parsed: inParsed, text: formatCultureDate(inParsed), rolled: false, source: "sameDay" };

    // What the grid itself pre-filled, when it already spans two dates.
    let gridDay = null;
    if (rowInDateText && rowOutDateText && rowInDateText !== rowOutDateText) {
      const gridParsed = parseCultureDate(rowOutDateText);
      if (gridParsed) gridDay = { parsed: gridParsed, text: rowOutDateText, rolled: true, source: "grid" };
    }

    const inKey = toMinuteKey(inParsed, inHHMM);
    const sameKey = toMinuteKey(inParsed, outHHMM);
    if (inKey === null || sameKey === null) return gridDay || sameDay;

    if (!window) {
      /* No parsable window - the grid's own dates, then IsMidNightShift,
       * are all the API has said about whether this shift crosses midnight. */
      if (gridDay) return gridDay;
      if (isMidNightShift === 1 && sameKey <= inKey) {
        const next = addDays(inParsed, 1);
        return { parsed: next, text: formatCultureDate(next), rolled: true, source: "isMidNightShift" };
      }
      return sameDay;
    }

    // The same date is right whenever it is both after the In and inside the window.
    if (sameKey > inKey && sameKey >= window.start && sameKey <= window.end) return sameDay;

    // The window itself is what licenses rolling to the next date.
    if (window.spansNextDay) {
      const next = addDays(inParsed, 1);
      const nextKey = toMinuteKey(next, outHHMM);
      if (nextKey !== null && nextKey >= window.start && nextKey <= window.end) {
        return { parsed: next, text: formatCultureDate(next), rolled: true, source: "graceWindow" };
      }
    }

    return gridDay || sameDay;
  }

  /* A single time (a break edge) placed on whichever of the two dates the
   * API's window puts it on. inside:false means it is on neither. */
  function resolveTimeInWindow(baseParsed, hhmm, window) {
    const sameKey = toMinuteKey(baseParsed, hhmm);
    if (!window) return { parsed: baseParsed, key: sameKey, inside: true };
    if (sameKey !== null && sameKey >= window.start && sameKey <= window.end) {
      return { parsed: baseParsed, key: sameKey, inside: true };
    }
    if (window.spansNextDay) {
      const next = addDays(baseParsed, 1);
      const nextKey = toMinuteKey(next, hhmm);
      if (nextKey !== null && nextKey >= window.start && nextKey <= window.end) {
        return { parsed: next, key: nextKey, inside: true };
      }
    }
    return { parsed: baseParsed, key: sameKey, inside: false };
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
    return val !== undefined && val !== null && val !== -1;
  }

  /* SubmitManualAdjustment posts a time as the string "HH.MM" ("06.00",
   * "17.30") - the same clock value the grid returns as the number HH.MM,
   * spelled the way the captured payload spells it. */
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

  async function safeGetJson(url) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "x-requested-with": "XMLHttpRequest" },
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
   * Shapes a grid row the way the Valid Swipes tab posts it:
   * empty lists instead of nulls, plus the Old* before-snapshot
   * and the enablement flags the grid response does not carry.
   * ------------------------------------------------- */
  function toValidSwipeRow(row) {
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
      ReasonCode: row.ReasonCode,
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
      IsEnabled: row.IsEnabled !== undefined ? row.IsEnabled : true,
      IsAdjustmentEnabled: row.IsAdjustmentEnabled !== undefined ? row.IsAdjustmentEnabled : true,
      IsConfirmationRequired: row.IsConfirmationRequired === true,
      IsOutTimeExceedConfirmed: row.IsOutTimeExceedConfirmed === true,
      IsHighlightInTime: row.IsHighlightInTime === true,
      IsHighlightOutTime: row.IsHighlightOutTime === true,
      AbsentDays: row.AbsentDays,
      NopayHours: row.NopayHours,
      IsShiftOffShift: row.IsShiftOffShift === true
    };
  }

  function pickRowDebug(row) {
    if (!row) return null;
    return {
      DatInDate: row.DatInDate,
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
      InOutRecordType: row.InOutRecordType,
      RecordStatus: row.RecordStatus,
      IsEnabled: row.IsEnabled,
      IsAdjustmentEnabled: row.IsAdjustmentEnabled,
      OldBreakCount: row.OldBreakCount,
      BreakCount: row.BreakCount,
      DABreakListCount: Array.isArray(row.DABreakList) ? row.DABreakList.length : 0,
      // The break entries themselves - a break-only edit lives or dies on
      // these, so a failure has to show what actually went out.
      DABreakList: Array.isArray(row.DABreakList) ? row.DABreakList : null
    };
  }

  /* -------------------------------------------------
   * Step 1: identify the date and check access.
   * ------------------------------------------------- */
  if (!args || !args.date) {
    return {
      needsInput: true,
      message: `Please tell me the date (${dateFormatName}) of the manual In and Out you want to edit.`,
      missingFields: ["Date"],
      expectedDateFormat: dateFormatName
    };
  }

  const parsedDate = parseCultureDate(args.date);
  if (!parsedDate) {
    return { error: true, message: `Invalid date format. Please provide the date as ${dateFormatName}.` };
  }
  const dateText = formatCultureDate(parsedDate);
  const targetIsoDay = `${parsedDate.yyyy}-${parsedDate.mm}-${parsedDate.dd}`;

  const sl = reqOptions.sl;
  const baseUrl = getPathBase(sl);
  const jsonHeaders = {
    "accept": "*/*",
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest"
  };
  // The break and summary calls go out as jQuery ajax, with its own accept.
  const ajaxHeaders = {
    "accept": "application/json, text/javascript, */*; q=0.01",
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest"
  };

  /* -------------------------------------------------
   * Load the self ManualInOut page (PageMode 2) through the
   * digest-aware URL and read filterModel / model from it.
   * ------------------------------------------------- */
  const updateUrl = await BeaconBar.executeFunction("updateUrlParams")(
    "TNAV9/ManualInOut/ManualInOut/2?mvc=1"
  );
  const pageUrl = updateUrl && updateUrl.updateUrl
    ? `${baseUrl}/${updateUrl.updateUrl}`
    : `${baseUrl}/TNAV9/ManualInOut/ManualInOut/2?mvc=1`;

  const pageRes = await fetch(pageUrl, {
    method: "GET",
    headers: { "x-requested-with": "XMLHttpRequest" },
    redirect: "follow"
  });
  const pageHtml = await pageRes.text();
  const filterModel = parseJsonLiteral(pageHtml, "filterModel") || {};
  const pageModel = parseJsonLiteral(pageHtml, "model") || {};

  const pageToken = filterModel.LoginEmpNumber || null;
  const selfToolToken = await BeaconBar.executeFunction("selfEmployeeManualInAndOutDetails")();
  // Prefer the page token for this screen's API calls; fall back to the helper token.
  const empNumber = pageToken || selfToolToken;

  if (!empNumber) {
    return {
      error: true,
      message: "Unable to identify the logged-in employee. Please try again.",
      diagnostics: {
        pageUrl,
        pageStatus: pageRes.status,
        hasFilterModel: !!filterModel,
        hasLoginEmpNumber: !!pageToken
      }
    };
  }
  BeaconBar.setSharedData("empNumber", empNumber);

  /* -------------------------------------------------
   * Page-load parity: load the roster list for the roster group
   * and resolve the roster the user named, if any.
   * ------------------------------------------------- */
  const rosterGroup = args.rosterGroup || "1";
  const rosterResult = await safePostJson(
    `${baseUrl}/TNAV9/api/Common/GetRostersByGroupId/`,
    { rosterGroup: String(rosterGroup) },
    { "accept": "application/json, text/javascript, */*; q=0.01", "content-type": "application/json", "x-requested-with": "XMLHttpRequest" }
  );
  const rosterList = Array.isArray(rosterResult.body) ? rosterResult.body : [];

  let rosterCode = args.rosterCode || null;
  if (!rosterCode && args.rosterName) {
    const wanted = String(args.rosterName).toLowerCase().trim();
    const rosterMatch = rosterList.find(function (r) {
      return String(r.RosterName || "").toLowerCase().trim() === wanted;
    }) || rosterList.find(function (r) {
      return String(r.RosterName || "").toLowerCase().includes(wanted);
    });

    if (!rosterMatch) {
      return {
        error: true,
        message: `Could not find a roster named "${args.rosterName}". Please pick one of the available rosters.`,
        availableRosters: rosterList.map(function (r) { return { rosterCode: r.RosterCode, rosterName: r.RosterName }; })
      };
    }
    rosterCode = rosterMatch.RosterCode;
  }
  if (!rosterCode) rosterCode = "000017";

  /* -------------------------------------------------
   * Build the search range from the date-selection mode.
   * ------------------------------------------------- */
  let requestedMode = String(args.dateSelectMode || "period").toLowerCase();
  if (["last7days", "last30days", "period"].indexOf(requestedMode) === -1) {
    return { error: true, message: 'dateSelectMode must be one of "last7days", "last30days" or "period".' };
  }

  const modeRange = getRangeForMode(requestedMode);
  let fromDateText = modeRange.from;
  let toDateText = modeRange.to;

  if (requestedMode === "period") {
    if (args.fromDate) {
      const parsedFrom = parseCultureDate(args.fromDate);
      if (!parsedFrom) return { error: true, message: `Invalid fromDate. Please provide it as ${dateFormatName}.` };
      fromDateText = formatCultureDate(parsedFrom);
    }
    if (args.toDate) {
      const parsedTo = parseCultureDate(args.toDate);
      if (!parsedTo) return { error: true, message: `Invalid toDate. Please provide it as ${dateFormatName}.` };
      toDateText = formatCultureDate(parsedTo);
    }
  }

  const targetKey = toDateKey(parsedDate);
  const fromKey = toDateKey(parseCultureDate(fromDateText));
  const toKey = toDateKey(parseCultureDate(toDateText));

  if (fromKey > toKey) {
    return { error: true, message: `The search range is invalid: From Date (${fromDateText}) is after To Date (${toDateText}).` };
  }
  if (targetKey < fromKey || targetKey > toKey) {
    return {
      error: true,
      message: `${dateText} is outside the selected search range (${fromDateText} - ${toDateText}). Please widen the range so it includes ${dateText}.`,
      searchRange: { dateSelectMode: requestedMode, fromDate: fromDateText, toDate: toDateText }
    };
  }

  /* -------------------------------------------------
   * Step 2: search, then check the day exists at all.
   * ------------------------------------------------- */
  const isGroupByEmployee = args.isGroupByEmployee === true;

  const gridPayload = {
    FromDateText: fromDateText,
    ToDateText: toDateText,
    IsGroupByEmployee: isGroupByEmployee,
    FilterMode: "1",
    EmpNumber: empNumber,
    RosterCode: rosterCode,
    callBackId: 1,
    isShowShiftHoursInShiftAdjEnabled: false,
    IsClientUoc: false,
    PageMode: 2
  };

  const gridResult = await safePostJson(`${baseUrl}/TNAV9/api/ManualInOut/GetGridDataByCriteria/`, gridPayload, jsonHeaders);
  const gridData = gridResult.body;
  const recordList = (gridData && gridData.ManualInOutDetailList) || [];

  /* -------------------------------------------------
   * Page-load parity, in the order the screen itself calls them:
   * GetRostersByGroupId (above) -> GetGridDataByCriteria ->
   * GetManuallyTimeFixedData -> GetManualRejectedData ->
   * GetDynamicEmployeeSummary.
   *
   * GetManuallyTimeFixedData and GetManualRejectedData are both posted
   * the SAME array - the InOutRecordType 1 rows the grid is showing.
   * The captured page load sends exactly that array to both: its first
   * row is 2024-11-08, the first type 1 row, not 2024-11-01, the first
   * row overall. GetManualRejectedData is not a {FilterMode, FromDateText,
   * ToDateText, EmpNumber} search.
   * ------------------------------------------------- */
  const submittableRows = recordList
    .filter(function (r) { return r.InOutRecordType === 1; })
    .map(toValidSwipeRow);

  const fixedResult = await safePostJson(
    `${baseUrl}/TNAV9/api/ManualInOut/GetManuallyTimeFixedData/`,
    submittableRows,
    jsonHeaders
  );
  const fixedList = Array.isArray(fixedResult.body) ? fixedResult.body : [];

  await safePostJson(
    `${baseUrl}/TNAV9/api/ManualInOut/GetManualRejectedData/`,
    submittableRows,
    jsonHeaders
  );

  await safePostJson(`${baseUrl}/TNAV9/api/Common/GetDynamicEmployeeSummary/`, {
    pageId: 1,
    empNumber,
    fromDateText,
    toDateText
  }, jsonHeaders);

  const gridIndex = recordList.findIndex(function (item) {
    return isoDayOf(item.DatInDate) === targetIsoDay;
  });

  if (gridIndex < 0) {
    return {
      error: true,
      message: `${dateText} is not in the system for you - there is no attendance day recorded for that date, so there is nothing to edit. Please check the date and try again.`,
      diagnostics: {
        searchedDate: dateText,
        dateSelectMode: requestedMode,
        fromDateText,
        toDateText,
        rosterCode,
        rowsReturned: recordList.length
      }
    };
  }

  const gridRow = recordList[gridIndex];

  /* -------------------------------------------------
   * Valid Swipes tab: only these rows are editable. The manually-fixed
   * list was already loaded with the rest of the page above.
   * ------------------------------------------------- */
  const validSwipeRows = recordList
    .filter(function (r) { return r.InOutRecordType === 3; })
    .map(toValidSwipeRow);

  const previouslyManuallyFixed = fixedList.some(function (r) {
    return isoDayOf(r.DatInDate) === targetIsoDay
      && (!gridRow.EmpDisplayNumber || r.EmpDisplayNumber === gridRow.EmpDisplayNumber);
  });

  const validIndex = validSwipeRows.findIndex(function (r) {
    return isoDayOf(r.DatInDate) === targetIsoDay;
  });

  if (validIndex < 0) {
    return {
      error: true,
      message: `${dateText} has no valid swipe to edit - it is not in the Valid Swipes list, so its In and Out times cannot be changed here.`,
      current: {
        date: dateText,
        shift: gridRow.ShiftAbbreviation || null,
        status: gridRow.RecordStatusText || null,
        inTime: hasTime(gridRow.InTime) ? (gridRow.InTimeText || hhmmToText(gridRow.InTime)) : null,
        outTime: hasTime(gridRow.OutTime) ? (gridRow.OutTimeText || hhmmToText(gridRow.OutTime)) : null
      },
      editableDates: validSwipeRows.slice(0, 20).map(function (r) { return r.InDateText; })
    };
  }

  const targetRow = validSwipeRows[validIndex];

  /* -------------------------------------------------
   * Locked or disabled rows cannot be changed.
   * ------------------------------------------------- */
  const blockers = [];
  if (targetRow.IsLockedRecord === true) blockers.push("the record is locked");
  if (targetRow.IsTimeAdjLocked === 1) blockers.push("time adjustment is locked");
  if (targetRow.IsPeriodLocked === 1) blockers.push("the attendance period is locked");
  if (targetRow.IsEnabled === false) blockers.push("the record is not editable");
  if (targetRow.IsAdjustmentEnabled === false) blockers.push("adjustments are disabled for this record");

  if (blockers.length > 0) {
    return {
      error: true,
      message: `The manual In and Out for ${dateText} cannot be edited because ${blockers.join(" and ")}. Please contact HR Admin.`,
      current: {
        date: dateText,
        inTime: targetRow.InTimeText || hhmmToText(targetRow.InTime),
        outTime: targetRow.OutTimeText || hhmmToText(targetRow.OutTime)
      }
    };
  }

  /* -------------------------------------------------
   * Step 3: check there are existing values to edit.
   * ------------------------------------------------- */
  const hasExistingIn = hasTime(targetRow.InTime);
  const hasExistingOut = hasTime(targetRow.OutTime);

  const currentInText = hasExistingIn ? (targetRow.InTimeText || hhmmToText(targetRow.InTime)) : null;
  const currentOutText = hasExistingOut ? (targetRow.OutTimeText || hhmmToText(targetRow.OutTime)) : null;

  if (!hasExistingIn && !hasExistingOut) {
    return {
      error: true,
      message: `There is no In or Out time recorded for ${dateText}, so there is nothing to edit. Adding a new manual In and Out is handled by the submitSelfManualInAndOut tool.`,
      current: { date: dateText, inTime: null, outTime: null }
    };
  }

  /* -------------------------------------------------
   * Break cell parity: the grid row carries DABreakList null on every
   * row, so the day's real breaks have to come from
   * GetEmployeeBreaksByDate - which is what the page loads when the
   * break count is clicked. Reading the list off the row instead left
   * it permanently empty, so an existing break was never shown and a
   * second one was appended instead of the first being changed.
   * ------------------------------------------------- */
  const rowEmpToken = targetRow.EmpNumber || empNumber;
  const breaksResult = await safePostJson(
    `${baseUrl}/TNAV9/api/ManualInOut/GetEmployeeBreaksByDate/`,
    { empNumber: rowEmpToken, datInDateText: dateText },
    ajaxHeaders
  );
  const existingBreaks = Array.isArray(breaksResult.body) ? breaksResult.body : [];
  const currentBreak = existingBreaks.length > 0 ? existingBreaks[0] : null;
  const currentBreakInText = currentBreak ? (currentBreak.BStartTimeText || hhmmToText(currentBreak.BStartTime)) : null;
  const currentBreakOutText = currentBreak ? (currentBreak.BEndTimeText || hhmmToText(currentBreak.BEndTime)) : null;

  /* -------------------------------------------------
   * Step 4 and 5: collect In Time, Out Time, reason, and the
   * optional break pair.
   * ------------------------------------------------- */
  const wantsInChange = !!args.inTime;
  const wantsOutChange = !!args.outTime;
  const wantsBreakChange = !!(args.breakInTime || args.breakOutTime);
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

  /* The row's own dates - offered as the defaults when asking. */
  const suggestedInDateText = targetRow.InDateText || dateText;
  const suggestedOutDateText = targetRow.OutDateText || dateText;
  const canEndNextDay = shiftInfo.shiftCanEndNextDay;
  const nextDayNote = canEndNextDay
    ? ` This shift can end on the following day, so the Out Date may be ${formatCultureDate(addDays(parseCultureDate(suggestedInDateText) || parsedDate, 1))} rather than ${suggestedInDateText} - ask, do not assume.`
    : "";

  if (!wantsInChange && !wantsOutChange && !wantsBreakChange) {
    /* The user often arrives here from the submit tool, having been told
     * the day was already submitted - lead with that so the answer is the
     * same whichever way they came in. */
    const alreadySubmitted = hasExistingIn && hasExistingOut
      ? `You have already submitted your manual In and Out for ${dateText} (In: ${currentInText}, Out: ${currentOutText}). `
      : "";
    return {
      needsInput: true,
      message: `${alreadySubmitted}Here is what is currently recorded for ${dateText}. Please give me the new In Date and In Time, and the new Out Date and Out Time, separately - dates are ${dateFormatName} and times are HH:mm - and the reason for the change.${nextDayNote} Break In Time and Break Out Time are optional - add them only if you want to.`,
      suggested: { inDate: suggestedInDateText, outDate: suggestedOutDateText },
      current: Object.assign({
        date: dateText,
        inDate: suggestedInDateText,
        outDate: suggestedOutDateText,
        inTime: currentInText,
        outTime: currentOutText,
        breakInTime: currentBreakInText,
        breakOutTime: currentBreakOutText,
        status: targetRow.RecordStatusText || null,
        previouslyManuallyFixed
      }, shiftInfo),
      missingFields: ["In Date", "In Time", "Out Date", "Out Time", "Reason"]
    };
  }

  /* Whenever a time is being changed, all four of In Date, In Time, Out
   * Date and Out Time are needed together - never one on its own. A shift
   * can end on the date after it started, so the Out Date is a real
   * choice and not something to decide on the user's behalf. A break-only
   * change leaves the times and dates as they are and needs none of them
   * restated. */
  if (wantsInChange || wantsOutChange) {
    const needed = [];
    if (!args.inDate) needed.push("In Date");
    if (!wantsInChange) needed.push("In Time");
    if (!args.outDate) needed.push("Out Date");
    if (!wantsOutChange) needed.push("Out Time");

    if (needed.length > 0) {
      const neededText = needed.length > 1
        ? `${needed.slice(0, -1).join(", ")} and ${needed[needed.length - 1]}`
        : needed[0];
      return {
        needsInput: true,
        message: `Please give me the ${neededText} as well - I need the In Date and In Time, and the Out Date and Out Time, separately for ${dateText}. Dates are ${dateFormatName} and times are HH:mm.${nextDayNote} Currently recorded: In ${suggestedInDateText} ${currentInText || "-"}, Out ${suggestedOutDateText} ${currentOutText || "-"}.`,
        missingFields: needed,
        suggested: { inDate: suggestedInDateText, outDate: suggestedOutDateText },
        current: Object.assign({
          date: dateText,
          inDate: suggestedInDateText,
          outDate: suggestedOutDateText,
          inTime: currentInText,
          outTime: currentOutText
        }, shiftInfo)
      };
    }
  }

  if ((args.breakInTime && !args.breakOutTime) || (!args.breakInTime && args.breakOutTime)) {
    return {
      needsInput: true,
      message: "You gave only one break time. Please provide both Break In Time and Break Out Time (HH:mm), or leave both out to keep the break unchanged.",
      missingFields: [args.breakInTime ? "Break Out Time" : "Break In Time"]
    };
  }

  if (!args.reason) {
    return {
      needsInput: true,
      message: `Please tell me the reason for changing the manual In and Out on ${dateText}.`,
      missingFields: ["Reason"],
      current: { date: dateText, inTime: currentInText, outTime: currentOutText }
    };
  }

  /* -------------------------------------------------
   * Validate the new values (HH:mm in, HH.MM on the wire).
   * ------------------------------------------------- */
  const newIn = wantsInChange ? timeToHHMM(args.inTime) : null;
  if (wantsInChange && newIn === null) {
    return { error: true, message: "In Time must be in HH:mm 24-hour format, e.g. 08:30." };
  }

  const newOut = wantsOutChange ? timeToHHMM(args.outTime) : null;
  if (wantsOutChange && newOut === null) {
    return { error: true, message: "Out Time must be in HH:mm 24-hour format, e.g. 17:30." };
  }

  let breakIn = null;
  let breakOut = null;
  if (args.breakInTime) {
    breakIn = timeToHHMM(args.breakInTime);
    if (breakIn === null) {
      return { error: true, message: "Break In Time must be in HH:mm 24-hour format, e.g. 12:00." };
    }
  }
  if (args.breakOutTime) {
    breakOut = timeToHHMM(args.breakOutTime);
    if (breakOut === null) {
      return { error: true, message: "Break Out Time must be in HH:mm 24-hour format, e.g. 13:00." };
    }
  }

  // A break-only change keeps both recorded times exactly as they are.
  const finalInTime = wantsInChange ? newIn : targetRow.InTime;
  const finalOutTime = wantsOutChange ? newOut : targetRow.OutTime;
  const finalInText = wantsInChange ? args.inTime : (currentInText || "");
  const finalOutText = wantsOutChange ? args.outTime : (currentOutText || "");

  /* -------------------------------------------------
   * Which dates the In and the Out belong to.
   *
   * The In date is the row's own unless the caller overrides it. The Out
   * date is resolved against the window the API returned for this row
   * (ShiftToolTip), falling back to the row's own dates and then to
   * IsMidNightShift - so an Out time earlier on the clock than the In
   * time lands on the next date exactly when this shift reaches there,
   * and stays on the same date when it does not.
   * ------------------------------------------------- */
  let finalInDateText = targetRow.InDateText || dateText;

  if (args.inDate) {
    const parsedInDate = parseCultureDate(args.inDate);
    if (!parsedInDate) return { error: true, message: `Invalid inDate. Please provide it as ${dateFormatName}.` };
    finalInDateText = formatCultureDate(parsedInDate);
  }

  const parsedInDateText = parseCultureDate(finalInDateText) || parsedDate;

  let outDateResolution;
  if (args.outDate) {
    const parsedOutDate = parseCultureDate(args.outDate);
    if (!parsedOutDate) return { error: true, message: `Invalid outDate. Please provide it as ${dateFormatName}.` };
    outDateResolution = { parsed: parsedOutDate, text: formatCultureDate(parsedOutDate), rolled: false, source: "argument" };
  } else {
    outDateResolution = resolveOutDate(
      parsedInDateText,
      finalInText,
      finalOutText,
      targetRow.InDateText,
      targetRow.OutDateText,
      shiftWindow,
      targetRow.IsMidNightShift
    );
  }
  const finalOutDateText = outDateResolution.text;
  const parsedOutDateText = outDateResolution.parsed;

  const inKey = toMinuteKey(parsedInDateText, finalInText);
  const outKey = toMinuteKey(parsedOutDateText, finalOutText);
  const warnings = [];
  let breakInPlacement = null;
  let breakOutPlacement = null;

  /* The only ordering rule applied is the one the shift itself states, and
   * it is checked on the full In/Out date-times rather than the bare clock
   * values - so a shift that ends after midnight is not refused for having
   * an Out "before" its In. When the API's window is single-day the shift
   * really does require the Out later the same day, and that check stays. */
  if (inKey !== null && outKey !== null && outKey <= inKey) {
    if (shiftWindow && !shiftWindow.spansNextDay) {
      return {
        error: true,
        message: `The Out time ${finalOutText} is not after the In time ${finalInText} on ${finalInDateText}. This shift runs ${shiftWindow.text} and has to be swiped between ${shiftWindow.startText} and ${shiftWindow.endText}, which is all within one day, so the Out time cannot be on the following date. Please give an Out time later than the In time.`,
        current: Object.assign({ date: dateText, inTime: finalInText, outTime: finalOutText }, shiftInfo)
      };
    }
    warnings.push(`The Out time ${finalOutText} on ${finalOutDateText} is not after the In time ${finalInText} on ${finalInDateText}. The system will decide whether it accepts this.`);
  }

  if (shiftWindow) {
    if (inKey !== null && (inKey < shiftWindow.start || inKey > shiftWindow.end)) {
      warnings.push(`The In time ${finalInText} on ${finalInDateText} falls outside the shift's allowed window (${targetRow.ShiftToolTip}).`);
    }
    if (outKey !== null && (outKey < shiftWindow.start || outKey > shiftWindow.end)) {
      warnings.push(`The Out time ${finalOutText} on ${finalOutDateText} falls outside the shift's allowed window (${targetRow.ShiftToolTip}).`);
    }
  }

  /* A break outside the shift's allowed window is refused outright - the
   * record must not be saved with it. Each edge is first placed on
   * whichever of the window's dates it falls on, the same way the Out
   * time is, so a break after midnight on a shift that reaches there is
   * not refused. If the window cannot be parsed there is nothing to
   * check against. */
  if (shiftWindow && breakIn !== null && breakOut !== null) {
    breakInPlacement = resolveTimeInWindow(parsedInDateText, args.breakInTime, shiftWindow);
    breakOutPlacement = resolveTimeInWindow(parsedInDateText, args.breakOutTime, shiftWindow);
    const outside = [];
    if (!breakInPlacement.inside) {
      outside.push(`Break In Time ${args.breakInTime}`);
    }
    if (!breakOutPlacement.inside) {
      outside.push(`Break Out Time ${args.breakOutTime}`);
    }
    if (outside.length > 0) {
      return {
        error: true,
        message: `${outside.join(" and ")} ${outside.length > 1 ? "are" : "is"} not within the shift's allowed period, so this cannot be saved. The shift and its allowed window are: ${targetRow.ShiftToolTip}. Please give break times inside that window.`,
        current: Object.assign({
          date: dateText,
          breakInTime: args.breakInTime,
          breakOutTime: args.breakOutTime
        }, shiftInfo)
      };
    }
  }

  const changes = [];
  if (wantsInChange && args.inTime !== currentInText) {
    changes.push({ field: "In Time", from: currentInText, to: args.inTime });
  }
  if (wantsOutChange && args.outTime !== currentOutText) {
    changes.push({ field: "Out Time", from: currentOutText, to: args.outTime });
  }
  if (finalOutDateText !== targetRow.OutDateText) {
    changes.push({ field: "Out Date", from: targetRow.OutDateText, to: finalOutDateText });
  }
  if (finalInDateText !== targetRow.InDateText) {
    changes.push({ field: "In Date", from: targetRow.InDateText, to: finalInDateText });
  }
  if (wantsBreakChange && (args.breakInTime !== currentBreakInText || args.breakOutTime !== currentBreakOutText)) {
    changes.push({ field: "Break In Time", from: currentBreakInText, to: args.breakInTime });
    changes.push({ field: "Break Out Time", from: currentBreakOutText, to: args.breakOutTime });
  }

  if (changes.length === 0) {
    return {
      noChanges: true,
      message: `The values you gave match what is already recorded for ${dateText} (In: ${currentInText || "-"}, Out: ${currentOutText || "-"}). There is nothing to update.`,
      current: { date: dateText, inTime: currentInText, outTime: currentOutText }
    };
  }

  const previewData = {
    date: dateText,
    shift: targetRow.ShiftAbbreviation || null,
    shiftPeriod: shiftWindow ? shiftWindow.text : null,
    inDate: finalInDateText,
    outDate: finalOutDateText,
    /* True when the Out lands on the date after the In - worth showing,
     * because it is the part of the entry a user is most likely to want
     * to correct before confirming. */
    outIsNextDay: finalOutDateText !== finalInDateText,
    outDateSource: outDateResolution.source,
    warnings,
    inTime: { current: currentInText, updated: finalInText || null },
    outTime: { current: currentOutText, updated: finalOutText || null },
    breakInTime: { current: currentBreakInText, updated: args.breakInTime || currentBreakInText },
    breakOutTime: { current: currentBreakOutText, updated: args.breakOutTime || currentBreakOutText },
    reason: args.reason,
    previouslyManuallyFixed,
    changes
  };

  /* -------------------------------------------------
   * Step 6: nothing is written until the user confirms.
   * ------------------------------------------------- */
  if (!args.confirmed) {
    return {
      needsConfirmation: true,
      preview: previewData,
      message: warnings.length > 0
        ? "Please review the changes below - note the warnings - and confirm before I update your manual In and Out."
        : "Please review the changes below and confirm before I update your manual In and Out.",
      confirmationPrompt: "Are you sure you want to save these changes? Reply yes to update, or no to make further changes."
    };
  }

  /* -------------------------------------------------
   * Step 7: submit. The grid checkbox equivalent is IsSelected,
   * true only on the row being changed. Every Old* field keeps
   * its pre-edit value so the server sees the before/after pair.
   * ------------------------------------------------- */
  const updatedRow = Object.assign({}, targetRow, {
    /* InDate/OutDate are the ISO halves of InDateText/OutDateText and have
     * to move with them: on the captured overnight submit the UI sent
     * OutDate "2024-11-09T00:00:00" alongside OutDateText "09/11/2024".
     * Leaving the ISO date on the In date is what makes the server read a
     * legitimate overnight Out as an Out before its own In. The times go
     * out as the strings "HH.MM" the captured payload uses, and the two
     * edited cells carry the UI's ChangeCell_Highlight marker. */
    InDate: formatIsoDateOnly(parsedInDateText),
    OutDate: formatIsoDateOnly(parsedOutDateText),
    InTime: toWireTime(finalInText) || finalInTime,
    OutTime: toWireTime(finalOutText) || finalOutTime,
    InTimeText: finalInText,
    OutTimeText: finalOutText,
    InDateText: finalInDateText,
    OutDateText: finalOutDateText,
    InTimeHighlightCSS: "ChangeCell_Highlight",
    OutTimeHighlightCSS: "ChangeCell_Highlight",
    Comment: args.reason,
    // Preserve existing reason semantics; forcing "-1" can break server validation.
    ReasonCode: (targetRow.ReasonCode === "" ? null : targetRow.ReasonCode),
    IsSelected: true
  });

  /* The row came off the grid with DABreakList null, normalised to [] by
   * toValidSwipeRow while BreakCount kept the day's real count. Posting
   * [] against a BreakCount of 1 reads as "the day lost its break", so
   * the loaded list is always carried, touched or not. */
  updatedRow.DABreakList = existingBreaks.slice();
  updatedRow.BreakCount = existingBreaks.length;

  if (breakIn !== null && breakOut !== null) {
    const datInDate = targetRow.DatInDate || formatIsoDateOnly(parsedDate);
    /* Each break edge keeps the date it was resolved onto, so a break
     * after midnight on a shift that reaches there is stored on the right
     * day instead of being folded back onto the In date. */
    const bStartParsed = (breakInPlacement && breakInPlacement.parsed) || parsedInDateText;
    const bEndParsed = (breakOutPlacement && breakOutPlacement.parsed) || parsedInDateText;

    if (currentBreak) {
      // Change the existing break in place, leaving any others untouched.
      updatedRow.DABreakList = existingBreaks.map(function (br, idx) {
        if (idx !== 0) return br;
        return Object.assign({}, br, {
          BStartTime: breakIn,
          BStartTimeText: args.breakInTime,
          BEndTime: breakOut,
          BEndTimeText: args.breakOutTime,
          ActionType: 1
        });
      });
    } else {
      const baseSeq = existingBreaks.reduce(function (maxVal, br) {
        const seq = Number(br && br.SeqNo);
        return Number.isFinite(seq) && seq > maxVal ? seq : maxVal;
      }, 0);

      /* ActionType is the "was this break touched" flag: 1 for one the
       * user added or changed, 0 for one riding along untouched. A new
       * break sent as 0 is read as unmodified, and when the In and Out
       * are unchanged too the server answers "No modifications to save"
       * and writes nothing - so an added break goes out as 1. */
      updatedRow.DABreakList = existingBreaks.concat([{
        DatInDate: datInDate,
        EmpNumber: targetRow.EmpNumber || empNumber,
        SeqNo: baseSeq + 1,
        BStartDate: formatIsoDateOnly(bStartParsed),
        BStartTime: breakIn,
        BEndDate: formatIsoDateOnly(bEndParsed),
        BEndTime: breakOut,
        BStartOldDate: null,
        BStartOldTime: -1,
        BEndOldDate: null,
        BEndOldTime: -1,
        BStartDateText: formatCultureDate(bStartParsed),
        BEndDateText: formatCultureDate(bEndParsed),
        BStartTimeText: args.breakInTime,
        BEndTimeText: args.breakOutTime,
        ActionType: 1
      }]);
    }
    updatedRow.BreakCount = updatedRow.DABreakList.length;
  }

  // The UI submit posts the full model; keep every row and select only the target.
  const fullDetailList = recordList.map(function (row, idx) {
    if (idx === gridIndex) return updatedRow;
    return Object.assign({}, row, { IsSelected: false });
  });

  async function submitList(detailList) {
    const payload = Object.assign({}, pageModel || {}, {
      PageMode: 2,
      ManualInOutDetailList: detailList
    });
    const raw = await fetch(`${baseUrl}/TNAV9/api/ManualInOut/SubmitManualAdjustment/`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
      redirect: "follow"
    });
    const result = await raw.json().catch(function () { return {}; });
    return { raw, result, payload };
  }

  let submitAttempt = await submitList(fullDetailList);
  let retriedWithValidSwipesOnly = false;

  // A 5xx on the full list can mean the server choked on a non-editable row -
  // retry once with just the Valid Swipes rows, as the tab itself holds them.
  if ((!submitAttempt.raw.ok || !submitAttempt.result || submitAttempt.result.Status !== true)
    && submitAttempt.raw.status >= 500) {
    const validOnlyList = validSwipeRows.map(function (row, idx) {
      if (idx === validIndex) return updatedRow;
      return Object.assign({}, row, { IsSelected: false });
    });
    submitAttempt = await submitList(validOnlyList);
    retriedWithValidSwipesOnly = true;
  }

  const submitRaw = submitAttempt.raw;
  const submitResult = submitAttempt.result;

  if (!submitRaw.ok || !submitResult || submitResult.Status !== true) {
    const instance = submitResult && submitResult.instance ? String(submitResult.instance) : "";
    const instanceTrace = instance.includes(":") ? instance.split(":").pop() : null;
    return {
      error: true,
      message: (submitResult && submitResult.Message) || (submitResult && submitResult.detail) || "Failed to update your manual In and Out. Please verify in the UI.",
      apiResponse: submitResult,
      diagnostics: {
        submitHttpStatus: submitRaw.status,
        retriedWithValidSwipesOnly,
        selectedDate: dateText,
        selectedRowIndex: gridIndex,
        validSwipeCount: validSwipeRows.length,
        previouslyManuallyFixed,
        totalRowsSubmitted: (submitAttempt.payload.ManualInOutDetailList || []).length,
        breakEdited: breakIn !== null && breakOut !== null,
        usedSelfToolToken: !!selfToolToken,
        usedPageTokenFallback: !selfToolToken && !!pageToken,
        pageUrl,
        culture,
        rosterGroup,
        rosterCode,
        dateSelectMode: requestedMode,
        fromDateText,
        toDateText,
        payloadTopLevelKeys: Object.keys(submitAttempt.payload || {}),
        hasPageModel: Object.keys(pageModel || {}).length > 0,
        selectedRowBeforeUpdate: pickRowDebug(targetRow),
        selectedRowAfterUpdate: pickRowDebug(updatedRow),
        traceId: (submitResult && submitResult.traceId) || instanceTrace || null,
        errorCode: (submitResult && submitResult.errorCode) || null
      }
    };
  }

  /* -------------------------------------------------
   * Mirror the post-submit UI refresh sequence (best-effort).
   * ------------------------------------------------- */
  const ts = Date.now();
  await safeGetJson(`${baseUrl}/WorkflowV5/WebAPI/V1/Workflow/GetWorkflowConfigurationsForNotification?_=${ts}`);
  await safeGetJson(`${baseUrl}/WorkflowV5/WebAPI/V1/Workflow/GetModuleWisePendingWorkflowSummaryNotification?_=${ts + 1}`);

  const refreshGrid = await safePostJson(`${baseUrl}/TNAV9/api/ManualInOut/GetGridDataByCriteria/`, gridPayload, jsonHeaders);
  const refreshedList = (refreshGrid.body && refreshGrid.body.ManualInOutDetailList) || [];
  const refreshedSubmittableRows = refreshedList
    .filter(function (r) { return r.InOutRecordType === 1; })
    .map(toValidSwipeRow);

  /* Same array to both, exactly as the page load does. */
  await safePostJson(`${baseUrl}/TNAV9/api/ManualInOut/GetManuallyTimeFixedData/`, refreshedSubmittableRows, jsonHeaders);
  await safePostJson(`${baseUrl}/TNAV9/api/ManualInOut/GetManualRejectedData/`, refreshedSubmittableRows, jsonHeaders);
  await safePostJson(`${baseUrl}/TNAV9/api/Common/GetDynamicEmployeeSummary/`, {
    pageId: 1,
    empNumber,
    fromDateText,
    toDateText
  }, jsonHeaders);

  return {
    success: true,
    message: `Your manual In and Out for ${dateText} has been updated successfully.`,
    updated: previewData,
    apiResponse: submitResult
  };
});
