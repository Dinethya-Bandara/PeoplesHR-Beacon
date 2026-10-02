(async function (data, args, reqOptions) {

  /* -------------------------------------------------
   * Access gate - runs before anything else, so a user without
   * the screen is refused before any argument or network work.
   * This is the team screen (My Team Manual In & Out,
   * PageMode 1) - a different menu entry from the admin screen
   * (0) and the self screen (2). Matched with a substring test
   * because the menu entry can carry extra query parameters.
   * ------------------------------------------------- */
  if (
    !BeaconBar.user?.metaData?.menus?.some(menu =>
      menu.includes("TNAV9/ManualInOut/ManualInOut/1?mvc=1")
    )
  ) {
    return { error: true, message: "You do not have access to edit manual In and Out for your team. Please contact HR Admin." };
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

  /* -------------------------------------------------
   * ShiftToolTip carries the window the server actually enforces:
   * "19.00 - 03.00 [Grace Start Time - 01/03/24 14:00 Grace End Time 02/03/24 13:00]"
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

    /* spansNextDay is the fact that settles whether an Out time earlier on
     * the clock than the In time is legal. When the API's own window runs
     * past midnight the Out belongs to the following date, so "In before
     * Out" is only ever true of the full In/Out date-times - never of the
     * bare clock values. 149 of the 171 rows in the captured team grid have
     * a window like that, so it is the normal case, not the exception. */
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
   * returned, never by a rule of our own. resolveOutDate mirrors what the
   * UI does when an Out time is typed that sits earlier on the clock than
   * the In time: keep the same date while that is legal, and otherwise
   * roll to the next date when - and only when - the shift the API
   * described actually reaches there.
   * ------------------------------------------------- */
  function addDays(parsed, days) {
    const d = new Date(Number(parsed.yyyy), Number(parsed.mm) - 1, Number(parsed.dd) + days);
    return { dd: pad(d.getDate()), mm: pad(d.getMonth() + 1), yyyy: String(d.getFullYear()) };
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
   * Time helpers - the user always speaks HH:mm, the wire carries
   * the same clock time as HH.MM (16:52 -> 16.52), which is not
   * decimal hours.
   *
   * A value the user just typed goes out as the zero-padded STRING
   * "07.00", not the number 7 - that is what the page sends for the
   * edited row, while every untouched row keeps the number the server
   * gave it (-1 for empty, 14.43 for a punch). Sending the number is
   * what the server rejects with "In-Time should be greater than shift
   * start cutoff time", because 7 loses the minutes the parser expects.
   * ------------------------------------------------- */
  function timeToHHMM(hhmm) {
    if (!hhmm || typeof hhmm !== "string" || !hhmm.includes(":")) return null;
    const [h, m] = hhmm.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return `${pad(h)}.${pad(m)}`;
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

  /* -------------------------------------------------
   * Request helpers
   * ------------------------------------------------- */
  function getPathBase(sl) {
    return `${location.origin}/${sl}`;
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
    const startOfYear = new Date(today.getFullYear() - 3, 0, 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { from: formatRangeDate(startOfYear), to: formatRangeDate(endOfMonth) };
  }

  /* -------------------------------------------------
   * Shapes a grid row into the row the Submit button posts.
   * GetGridDataByCriteria returns a read model; SubmitManualAdjustment
   * wants the edit model, and they are not the same shape - the grid
   * carries ShiftHTCode / RosterCode / SubmitStatus / WFMainId /
   * IsTimeExceedsConfiguredGrace / IsShiftAdjustmentLocked / ErrMessage,
   * none of which the real submit sends, and it omits the Old* snapshot
   * and the enablement flags, all of which the real submit does send.
   *
   * ReasonCode is normalised to "-1" (the "no reason" dropdown value)
   * while OldReasonCode keeps the grid's raw "" - they differ on purpose.
   * ------------------------------------------------- */
  function isRowUnlocked(row) {
    return !(row.IsLockedRecord === true || row.IsTimeAdjLocked === 1 || row.IsPeriodLocked === 1);
  }

  function toSubmitRow(row) {
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
      ReasonCode: (row.ReasonCode === "" || row.ReasonCode === null || row.ReasonCode === undefined) ? "-1" : row.ReasonCode,
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
      /* The grid read model carries neither flag - the client derives both
       * from the lock state. Rows with IsLockedRecord true or
       * IsTimeAdjLocked 1 go out as false on both, unlocked rows as true. */
      IsEnabled: row.IsEnabled !== undefined ? row.IsEnabled : isRowUnlocked(row),
      IsAdjustmentEnabled: row.IsAdjustmentEnabled !== undefined ? row.IsAdjustmentEnabled : isRowUnlocked(row),
      IsConfirmationRequired: row.IsConfirmationRequired === true,
      IsOutTimeExceedConfirmed: row.IsOutTimeExceedConfirmed === true,
      IsHighlightInTime: row.IsHighlightInTime === true,
      IsHighlightOutTime: row.IsHighlightOutTime === true,
      AbsentDays: row.AbsentDays,
      NopayHours: row.NopayHours,
      IsShiftOffShift: row.IsShiftOffShift === true
    };

    // A row the server flagged as manually fixed carries the highlight
    // classes back with it - both halves, not just the In.
    if (shaped.IsHighlightInTime) shaped.InTimeHighlightCSS = "ManualTime_Highlight";
    if (shaped.IsHighlightOutTime) shaped.OutTimeHighlightCSS = "ManualTime_Highlight";
    return shaped;
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
      OldReasonCode: row.OldReasonCode,
      InOutRecordType: row.InOutRecordType,
      RecordStatus: row.RecordStatus,
      IsEnabled: row.IsEnabled,
      IsAdjustmentEnabled: row.IsAdjustmentEnabled,
      IsOutTimeExceedConfirmed: row.IsOutTimeExceedConfirmed,
      BreakCount: row.BreakCount,
      DABreakListCount: Array.isArray(row.DABreakList) ? row.DABreakList.length : 0
    };
  }

  /* -------------------------------------------------
   * Step 1: identify the subordinate and the date.
   * ------------------------------------------------- */
  if (!args || (!args.employeeNumber && !args.employeeName)) {
    return {
      needsInput: true,
      message: "Please tell me which team member's manual In and Out you want to edit - their employee number or name.",
      missingFields: ["Employee"]
    };
  }

  if (!args.date) {
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
  const ajaxHeaders = {
    "accept": "application/json, text/javascript, */*; q=0.01",
    "content-type": "application/json",
    "x-requested-with": "XMLHttpRequest"
  };

  /* -------------------------------------------------
   * Step 2: load "My Team Manual In & Out" (PageMode 1).
   * updateUrlParams appends the digest the route needs - calling
   * the raw path returns an incomplete page.
   * ------------------------------------------------- */
  const updateUrl = await BeaconBar.executeFunction("updateUrlParams")(
    "TNAV9/ManualInOut/ManualInOut/1?mvc=1"
  );
  const pageUrl = updateUrl && updateUrl.updateUrl
    ? `${baseUrl}/${updateUrl.updateUrl}`
    : `${baseUrl}/TNAV9/ManualInOut/ManualInOut/1?mvc=1`;

  const pageRes = await fetch(pageUrl, {
    method: "GET",
    headers: { "x-requested-with": "XMLHttpRequest" },
    redirect: "follow"
  });
  const pageHtml = await pageRes.text();

  // filterModel is the page's own search state - it carries the login token
  // and the URL the search widget is built from.
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

  const filterModel = parseJsonLiteral(pageHtml, "filterModel") || {};
  const loginEmpMatch = pageHtml.match(/"LoginEmpNumber"\s*:\s*"([^"]+)"/);
  const loggedEmpNumber = filterModel.LoginEmpNumber || (loginEmpMatch ? loginEmpMatch[1] : null);

  if (!loggedEmpNumber) {
    return {
      error: true,
      message: "Unable to initialize your team search. Please try again.",
      // Structural signals only - no cookies or tokens.
      diagnostics: {
        pageUrl,
        updateUrlProvidedDigest: !!(updateUrl && updateUrl.updateUrl),
        httpStatus: pageRes.status,
        htmlLength: pageHtml.length,
        containsFilterModel: pageHtml.includes("filterModel"),
        containsLoginEmpNumber: pageHtml.includes("LoginEmpNumber"),
        looksLikeLoginPage: /login/i.test(pageHtml.slice(0, 500))
      }
    };
  }

  /* -------------------------------------------------
   * The search dropdown is not part of the page HTML - divSearch comes
   * back empty and the page fills it by loading filterModel's
   * EmployeeSearchURL. That render is what issues the key the feed is
   * keyed by, and it carries its own empNumber token, which is a
   * different nonce from filterModel.LoginEmpNumber. Inventing a key
   * gets a 200 with an empty result set - which reads as "you have no
   * team" - so the component has to be loaded the way the page loads it.
   * ------------------------------------------------- */
  function resolveSearchUrl(rawUrl) {
    if (!rawUrl) return null;
    // The model stores it relative to window.$ROOT (/<sl>/TNAV9/).
    const path = String(rawUrl).replace(/^(\.\.\/)+/, "").replace(/^\/+/, "");
    return `${baseUrl}/${path}`;
  }

  function getQueryParam(url, name) {
    const m = String(url || "").match(new RegExp("[?&]" + name + "=([^&]*)"));
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch (e) {
      return m[1];
    }
  }

  function parseSearchKey(html) {
    if (!html) return null;
    const patterns = [
      /data-key="([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"/,
      /"KeyValue"\s*:\s*"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"/,
      /\bkey\s*[:=]\s*['"]([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})['"]/,
      /[?&]key=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/
    ];
    for (let i = 0; i < patterns.length; i++) {
      const m = html.match(patterns[i]);
      if (m) return m[1];
    }
    // The component renders exactly one guid - take it rather than fail.
    const anyGuid = html.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
    return anyGuid ? anyGuid[0] : null;
  }

  const searchComponentUrl = resolveSearchUrl(filterModel.EmployeeSearchURL || filterModel.EmployeeSearchModalUrl);
  let searchHtml = "";
  let searchStatus = 0;

  if (searchComponentUrl) {
    try {
      const searchRes = await fetch(searchComponentUrl, {
        method: "GET",
        headers: { "x-requested-with": "XMLHttpRequest" },
        redirect: "follow"
      });
      searchStatus = searchRes.status;
      searchHtml = await searchRes.text();
    } catch (e) {
      searchHtml = "";
    }
  }

  const componentKey = parseSearchKey(searchHtml);
  const pageSearchKey = componentKey || parseSearchKey(pageHtml);
  const searchKey = pageSearchKey
    || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  // The component's own empNumber is the token the feed expects; the
  // page-level LoginEmpNumber is the fallback.
  const searchEmpNumber = getQueryParam(filterModel.EmployeeSearchURL || filterModel.EmployeeSearchModalUrl, "empNumber")
    || loggedEmpNumber;

  /* -------------------------------------------------
   * Page-load parity: load the roster list for the roster group and
   * resolve the roster the user named, if any.
   *
   * Which roster group is loaded varies from user to user, so it is read
   * off the page's own RosterGroupList rather than assumed - the captured
   * page listed group "6" first and that is the group the UI asked for.
   * ------------------------------------------------- */
  const rosterGroupList = Array.isArray(filterModel.RosterGroupList) ? filterModel.RosterGroupList : [];
  const rosterGroup = args.rosterGroup
    || (rosterGroupList[0] && rosterGroupList[0].GroupId)
    || "1";
  const rosterResult = await safePostJson(
    `${baseUrl}/TNAV9/api/Common/GetRostersByGroupId/`,
    { rosterGroup: String(rosterGroup) },
    ajaxHeaders
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

  // The search modal's criteria list, fetched the way the screen fetches it.
  await safeGetJson(
    `${baseUrl}/CommonComponents/Search/GetSearchCriteria/?key=${encodeURIComponent(searchKey)}&_=${Date.now()}`
  );

  /* -------------------------------------------------
   * Step 3: fetch the subordinate list and match. This list is
   * what restricts the tool to actual subordinates.
   *
   * Which (empNumber, key) pair the feed accepts cannot be read off
   * the page - both are per-session nonces - so the pairs are tried in
   * the order the page builds them and the first that answers wins.
   * ------------------------------------------------- */
  const searchContexts = [];
  function addContext(empNumber, key, label) {
    if (!empNumber || !key) return;
    const duplicate = searchContexts.some(function (c) { return c.empNumber === empNumber && c.key === key; });
    if (!duplicate) searchContexts.push({ empNumber, key, label });
  }
  addContext(searchEmpNumber, searchKey, "component");
  addContext(loggedEmpNumber, searchKey, "loginEmpNumber");

  let activeContext = null;
  let subordinates = [];
  const contextAttempts = [];

  for (let i = 0; i < searchContexts.length; i++) {
    const context = searchContexts[i];
    const attempt = await safeGetJson(
      `${baseUrl}/CommonComponents/Search/GetPaginatedTypeaheadList/?empNumber=${encodeURIComponent(context.empNumber)}&key=${encodeURIComponent(context.key)}&_=${Date.now()}`
    );
    const rows = (attempt.body && attempt.body.results) || [];
    contextAttempts.push({ context: context.label, status: attempt.status, rows: rows.length });
    if (rows.length > 0) {
      activeContext = context;
      subordinates = rows;
      break;
    }
  }

  if (subordinates.length === 0) {
    return {
      error: true,
      message: "No team members are available for you to edit. Please contact HR Admin if you expected to see your team here.",
      diagnostics: {
        loadedSearchComponent: !!searchComponentUrl,
        searchComponentStatus: searchStatus,
        foundComponentKey: !!componentKey,
        usedPageSearchKey: !!pageSearchKey,
        contextAttempts
      }
    };
  }

  /* The feed's id is an internal key, not the employee number on screen -
   * {"id":"00010325","text":"00000007 - George Silva"}. The number the
   * user types is the one in text, so split it out and match on that;
   * id stays the value the token call needs. */
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

  const wantedNumber = (args.employeeNumber || "").toLowerCase().trim();
  const wantedName = (args.employeeName || "").toLowerCase().trim();

  let matches = [];
  if (wantedNumber) {
    matches = subordinates.filter(function (r) {
      return displayNumberOf(r).toLowerCase() === wantedNumber;
    });
    // An employee number is often typed without its leading zeros.
    if (matches.length === 0) {
      matches = subordinates.filter(function (r) {
        return stripZeros(displayNumberOf(r)) === stripZeros(wantedNumber);
      });
    }
    // Last resort: the internal id, for a caller that already has one.
    if (matches.length === 0) {
      matches = subordinates.filter(function (r) {
        return String(r.id || "").toLowerCase().trim() === wantedNumber;
      });
    }
  }
  if (matches.length === 0 && wantedName) {
    matches = subordinates.filter(function (r) {
      return displayNameOf(r).toLowerCase() === wantedName;
    });
    if (matches.length === 0) {
      matches = subordinates.filter(function (r) {
        return String(r.text || "").toLowerCase().trim() === wantedName;
      });
    }
    if (matches.length === 0) {
      matches = subordinates.filter(function (r) {
        return String(r.text || "").toLowerCase().includes(wantedName);
      });
    }
  }

  if (matches.length === 0) {
    return {
      error: true,
      message: `Could not find "${args.employeeNumber || args.employeeName}" among your team members. Please check the employee number or name.`,
      availableSubordinates: subordinates.slice(0, 50).map(function (r) { return r.text; })
    };
  }

  // Never guess between people - a wrong pick edits the wrong person's attendance.
  if (matches.length > 1) {
    return {
      needsInput: true,
      message: `"${args.employeeNumber || args.employeeName}" matches more than one of your team members. Please tell me which one.`,
      missingFields: ["Employee"],
      candidates: matches.map(function (r) { return { employeeNumber: displayNumberOf(r), employee: r.text }; })
    };
  }

  const match = matches[0];

  // Identity shown to the user. The typeahead text is the starting point;
  // GetDynamicEmployeeSummary refines it once the search has run.
  let employeeLabel = String(match.text || "").trim();
  let employeeDisplayNumber = displayNumberOf(match);
  let employeeDesignation = null;

  /* -------------------------------------------------
   * Step 4: resolve the encoded EmpNumber token the ManualInOut
   * APIs require for the matched subordinate.
   * ------------------------------------------------- */
  // Same pair the list came back on - a token asked for under a different
  // key belongs to a search context the server does not have.
  const tokenResult = await safeGetJson(
    `${baseUrl}/CommonComponents/Search/GetEmpNumberFromTypeahead/?loggedEmpNumber=${encodeURIComponent(activeContext.empNumber)}&empNumber=${encodeURIComponent(match.id)}&key=${encodeURIComponent(activeContext.key)}&_=${Date.now()}`
  );
  const empToken = tokenResult.body && tokenResult.body.Status ? tokenResult.body.Message : null;

  if (!empToken) {
    return {
      error: true,
      message: `Unable to resolve ${employeeLabel}. Please try again.`,
      diagnostics: {
        tokenStatus: tokenResult.status,
        searchContext: activeContext.label,
        apiMessage: (tokenResult.body && tokenResult.body.Message) || null
      }
    };
  }



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
   * Step 5: search the subordinate's grid (PageMode 1).
   * ------------------------------------------------- */
  const isGroupByEmployee = args.isGroupByEmployee === true;

  function buildGridPayload(roster) {
    return {
      FromDateText: fromDateText,
      ToDateText: toDateText,
      IsGroupByEmployee: isGroupByEmployee,
      FilterMode: "1",
      EmpNumber: empToken,
      RosterCode: roster,
      callBackId: 1,
      isShowShiftHoursInShiftAdjEnabled: false,
      IsClientUoc: false,
      PageMode: 1
    };
  }

  /* The roster the screen searches with is the first one GetRostersByGroupId
   * returned for this user's roster group - in the capture that was "000058"
   * (MAK01), not the "000017" this tool used to assume. A named roster wins
   * over that, and the old hard-coded guesses stay on the end as fallbacks so
   * a user whose roster list comes back empty is no worse off than before. */
  const rosterAttempts = [];
  function addRosterAttempt(code) {
    if (code === null || code === undefined) return;
    if (rosterAttempts.indexOf(code) === -1) rosterAttempts.push(code);
  }
  addRosterAttempt(rosterCode);
  rosterList.forEach(function (r) { addRosterAttempt(r.RosterCode); });
  addRosterAttempt("000017");
  addRosterAttempt("");

  let gridPayload = null;
  let recordList = [];
  let usedRosterCode = null;

  for (let i = 0; i < rosterAttempts.length; i++) {
    const attemptPayload = buildGridPayload(rosterAttempts[i]);
    const attempt = await safePostJson(`${baseUrl}/TNAV9/api/ManualInOut/GetGridDataByCriteria/`, attemptPayload, jsonHeaders);
    const rows = (attempt.body && attempt.body.ManualInOutDetailList) || [];
    if (rows.length > 0) {
      gridPayload = attemptPayload;
      recordList = rows;
      usedRosterCode = rosterAttempts[i];
      break;
    }
    if (gridPayload === null) {
      gridPayload = attemptPayload;
      usedRosterCode = rosterAttempts[i];
    }
    // An explicit roster the user named is not silently replaced.
    if (args.rosterCode || args.rosterName) break;
  }

  /* -------------------------------------------------
   * Search parity: the page loads the employee summary straight after
   * the grid comes back. Its EmployeeData is the authoritative identity
   * for whoever the search actually resolved to - worth showing before
   * a manager confirms a change to someone else's attendance.
   * ------------------------------------------------- */
  const gridRow = recordList.find(function (item) {
    return isoDayOf(item.DatInDate) === targetIsoDay;
  });

  /* Both post-search calls take the SAME body - the captured pair sends an
   * identical array of InOutRecordType 1 (Manual tab) rows to each, right
   * down to the content length. Neither is an echo: the captured
   * GetManuallyTimeFixedData answers with days that were not in its own
   * request, so the rows are a context the server largely ignores and the
   * per-day figures come back for the employee either way. */
  const manualTabRows = recordList
    .filter(function (r) { return r.InOutRecordType === 1; })
    .map(toSubmitRow);

  const fixedResult = await safePostJson(
    `${baseUrl}/TNAV9/api/ManualInOut/GetManuallyTimeFixedData/`,
    manualTabRows,
    jsonHeaders
  );
  const fixedList = Array.isArray(fixedResult.body) ? fixedResult.body : [];
  const calculatedRow = fixedList.find(function (r) {
    return isoDayOf(r.DatInDate) === targetIsoDay
      && (!gridRow.EmpDisplayNumber || r.EmpDisplayNumber === gridRow.EmpDisplayNumber);
  }) || null;

  const calculated = calculatedRow ? {
    workHours: hhmmToText(calculatedRow.WorkHours),
    inOutDiffHours: hhmmToText(calculatedRow.InOutDiffHours),
    noPayDays: calculatedRow.NoPayDays
  } : null;

  /* Rejected tab parity: the same Manual tab rows, answering with the
   * rejected manual adjustments for the employee. Surfaced so a manager
   * can see the day was rejected before. */
  const rejectedResult = await safePostJson(
    `${baseUrl}/TNAV9/api/ManualInOut/GetManualRejectedData/`,
    manualTabRows,
    jsonHeaders
  );
  const rejectedList = Array.isArray(rejectedResult.body) ? rejectedResult.body : [];
  const rejectedOnThisDay = rejectedList.filter(function (r) {
    return isoDayOf(r.DatInDate) === targetIsoDay;
  }).length;

  /* The EmpNumber tokens are per-response nonces - the grid rows come back
   * with a different one than the typeahead handed us, and the page always
   * uses the freshest. Prefer the token the grid just issued. */
  const gridEmpToken = (recordList[0] && recordList[0].EmpNumber) || empToken;

  // The grid's "Select All" caption, fetched the way the screen fetches it
  // - between GetManualRejectedData and the employee summary.
  await safePostJson(
    `${baseUrl}/TNAV9/api/Common/GetLocalizedMessage/`,
    { resourceKey: "CommonSelectAllBtn", parameter: "", classKey: "Common" },
    ajaxHeaders
  );

  const summaryResult = await safePostJson(
    `${baseUrl}/TNAV9/api/Common/GetDynamicEmployeeSummary/`,
    { pageId: 1, empNumber: gridEmpToken, fromDateText, toDateText },
    ajaxHeaders
  );
  const employeeData = (summaryResult.body && summaryResult.body.EmployeeData) || null;
  if (employeeData) {
    employeeLabel = employeeData.EmpCompleteName || employeeData.EmpDisplayName || employeeLabel;
    employeeDisplayNumber = employeeData.EmpDisplayNumber || employeeDisplayNumber;
    employeeDesignation = employeeData.Designation || null;
  }

  if (!gridRow) {
    return {
      error: true,
      message: `${dateText} is not in the system for ${employeeLabel} - there is no attendance day recorded for that date, so there is nothing to edit. Please check the date and try again.`,
      diagnostics: {
        employee: employeeLabel,
        searchedDate: dateText,
        dateSelectMode: requestedMode,
        fromDateText,
        toDateText,
        rosterCode: usedRosterCode,
        rowsReturned: recordList.length
      }
    };
  }

  /* -------------------------------------------------
   * Only Valid Swipes rows (InOutRecordType 3) have times that can
   * be changed. The grid is split across tabs by that type and the
   * Submit button posts only the rows of the tab you are on, so the
   * submitted list is scoped to the valid swipes - mixing types in
   * one payload is what the server rejects.
   * ------------------------------------------------- */
  const validSourceRows = recordList.filter(function (r) { return r.InOutRecordType === 3; });
  const validSwipeRows = validSourceRows.map(toSubmitRow);
  const tabIndex = validSourceRows.findIndex(function (r) { return isoDayOf(r.DatInDate) === targetIsoDay; });



  if (tabIndex < 0) {
    return {
      error: true,
      message: `${dateText} was not found in the submitted Valid Swipes for ${employeeLabel}, so there is no manual In and Out on that day to edit. Please check the date, or use the submitSubordinatesManualInAndOut tool to add one.`,
      current: {
        employee: employeeLabel,
        date: dateText,
        shift: gridRow.ShiftAbbreviation || null,
        status: gridRow.RecordStatusText || null,
        inTime: hasTime(gridRow.InTime) ? (gridRow.InTimeText || hhmmToText(gridRow.InTime)) : null,
        outTime: hasTime(gridRow.OutTime) ? (gridRow.OutTimeText || hhmmToText(gridRow.OutTime)) : null
      },
      editableDates: validSwipeRows.slice(0, 20).map(function (r) { return r.InDateText; })
    };
  }

  const targetRow = validSwipeRows[tabIndex];

  /* -------------------------------------------------
   * Locked or disabled rows cannot be changed. Catch this here so
   * the user gets a reason instead of a server error after they
   * have already confirmed.
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
      message: `The manual In and Out for ${employeeLabel} on ${dateText} cannot be edited because ${blockers.join(" and ")}. Please contact HR Admin.`,
      current: {
        employee: employeeLabel,
        date: dateText,
        inTime: targetRow.InTimeText || hhmmToText(targetRow.InTime),
        outTime: targetRow.OutTimeText || hhmmToText(targetRow.OutTime)
      }
    };
  }

  /* -------------------------------------------------
   * Step 6: there must be something recorded to edit.
   * ------------------------------------------------- */
  const hasExistingIn = hasTime(targetRow.InTime);
  const hasExistingOut = hasTime(targetRow.OutTime);

  const currentInText = hasExistingIn ? (targetRow.InTimeText || hhmmToText(targetRow.InTime)) : null;
  const currentOutText = hasExistingOut ? (targetRow.OutTimeText || hhmmToText(targetRow.OutTime)) : null;

  if (!hasExistingIn && !hasExistingOut) {
    return {
      error: true,
      message: `There is no In or Out time recorded for ${employeeLabel} on ${dateText}, so there is nothing to edit. Adding a new manual In and Out is handled by the submitSubordinatesManualInAndOut tool.`,
      current: { employee: employeeLabel, date: dateText, inTime: null, outTime: null }
    };
  }

  const shiftWindow = parseGraceWindow(targetRow.ShiftToolTip);
  const rowEmpToken = targetRow.EmpNumber || empToken;

  /* -------------------------------------------------
   * Break cell parity: the grid row carries DABreakList null, the
   * real break list comes from GetEmployeeBreaksByDate. Load it now
   * so the current break can be shown and edited in place.
   * ------------------------------------------------- */
  const breaksResult = await safePostJson(
    `${baseUrl}/TNAV9/api/ManualInOut/GetEmployeeBreaksByDate/`,
    { empNumber: rowEmpToken, datInDateText: dateText },
    ajaxHeaders
  );
  const existingBreaks = Array.isArray(breaksResult.body) ? breaksResult.body : [];
  const currentBreak = existingBreaks.length > 0 ? existingBreaks[0] : null;
  const currentBreakInText = currentBreak ? hhmmToText(currentBreak.BStartTime) : null;
  const currentBreakOutText = currentBreak ? hhmmToText(currentBreak.BEndTime) : null;

  /* -------------------------------------------------
   * Step 7: collect the new values.
   * ------------------------------------------------- */
  const wantsInChange = !!args.inTime;
  const wantsOutChange = !!args.outTime;
  const wantsBreakChange = !!(args.breakInTime || args.breakOutTime);

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
  const nextDayNote = shiftInfo.shiftCanEndNextDay
    ? ` This shift can end on the following day, so the Out Date may be ${formatCultureDate(addDays(parseCultureDate(suggestedInDateText) || parsedDate, 1))} rather than ${suggestedInDateText} - ask, do not assume.`
    : "";

  if (!wantsInChange && !wantsOutChange && !wantsBreakChange) {
    /* The user often arrives here from the submit tool, having been told
     * the day was already submitted - lead with that so the answer is the
     * same whichever way they came in. */
    const alreadySubmitted = hasExistingIn && hasExistingOut
      ? `The manual In and Out for ${employeeLabel} on ${dateText} has already been submitted (In: ${currentInText}, Out: ${currentOutText}). `
      : "";
    return {
      needsInput: true,
      message: `${alreadySubmitted}Here is what is currently recorded for ${employeeLabel} on ${dateText}. Please give me the new In Date and In Time, and the new Out Date and Out Time, separately - dates are ${dateFormatName} and times are HH:mm - and the reason for the change.${nextDayNote} Break In Time and Break Out Time are optional - add them only if you want to.`,
      suggested: { inDate: suggestedInDateText, outDate: suggestedOutDateText },
      current: Object.assign({
        employee: employeeLabel,
        employeeNumber: employeeDisplayNumber,
        designation: employeeDesignation,
        date: dateText,
        inDate: suggestedInDateText,
        outDate: suggestedOutDateText,
        inTime: currentInText,
        outTime: currentOutText,
        breakInTime: currentBreakInText,
        breakOutTime: currentBreakOutText,
        status: targetRow.RecordStatusText || null,
        rejectedOnThisDay,
        calculated
      }, shiftInfo),
      missingFields: ["In Date", "In Time", "Out Date", "Out Time", "Reason"]
    };
  }

  /* Whenever a time is being changed, all four of In Date, In Time, Out
   * Date and Out Time are needed together - never one on its own. A shift
   * can end on the date after it started, so the Out Date is a real choice
   * and not something to decide on the manager's behalf. A break-only
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
        message: `Please give me the ${neededText} as well - I need the In Date and In Time, and the Out Date and Out Time, separately for ${employeeLabel} on ${dateText}. Dates are ${dateFormatName} and times are HH:mm.${nextDayNote} Currently recorded: In ${suggestedInDateText} ${currentInText || "-"}, Out ${suggestedOutDateText} ${currentOutText || "-"}.`,
        missingFields: needed,
        suggested: { inDate: suggestedInDateText, outDate: suggestedOutDateText },
        current: Object.assign({
          employee: employeeLabel,
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
      message: `Please tell me the reason for changing the manual In and Out for ${employeeLabel} on ${dateText}.`,
      missingFields: ["Reason"],
      current: { employee: employeeLabel, date: dateText, inTime: currentInText, outTime: currentOutText }
    };
  }

  /* -------------------------------------------------
   * Validate the new values (HH:mm in, HH.MM on the wire).
   * ------------------------------------------------- */
  let newIn = null;
  if (wantsInChange) {
    newIn = timeToHHMM(args.inTime);
    if (newIn === null) {
      return { error: true, message: "In Time must be in HH:mm 24-hour format, e.g. 08:30." };
    }
  }

  let newOut = null;
  if (wantsOutChange) {
    newOut = timeToHHMM(args.outTime);
    if (newOut === null) {
      return { error: true, message: "Out Time must be in HH:mm 24-hour format, e.g. 17:30." };
    }
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

  // Anything the user leaves out keeps the value already recorded.
  const finalInTime = wantsInChange ? newIn : targetRow.InTime;
  const finalOutTime = wantsOutChange ? newOut : targetRow.OutTime;
  const finalInText = wantsInChange ? args.inTime : (currentInText || "");
  const finalOutText = wantsOutChange ? args.outTime : (currentOutText || "");

  /* -------------------------------------------------
   * Which dates the In and the Out belong to.
   *
   * Both are asked for above, so normally they arrive as arguments and
   * are used exactly as the manager gave them. resolveOutDate is the
   * fallback for a caller that supplied the times but not the Out Date:
   * it reads the window the API returned for this row (ShiftToolTip) and
   * falls back to the row's own dates, then IsMidNightShift, when the
   * tooltip cannot be parsed.
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

  const changes = [];
  if (wantsInChange && args.inTime !== currentInText) {
    changes.push({ field: "In Time", from: currentInText, to: args.inTime });
  }
  if (wantsOutChange && args.outTime !== currentOutText) {
    changes.push({ field: "Out Time", from: currentOutText, to: args.outTime });
  }
  if (finalInDateText !== targetRow.InDateText) {
    changes.push({ field: "In Date", from: targetRow.InDateText, to: finalInDateText });
  }
  if (finalOutDateText !== targetRow.OutDateText) {
    changes.push({ field: "Out Date", from: targetRow.OutDateText, to: finalOutDateText });
  }
  if (wantsBreakChange && (args.breakInTime !== currentBreakInText || args.breakOutTime !== currentBreakOutText)) {
    changes.push({ field: "Break In Time", from: currentBreakInText, to: args.breakInTime });
    changes.push({ field: "Break Out Time", from: currentBreakOutText, to: args.breakOutTime });
  }

  if (changes.length === 0) {
    return {
      noChanges: true,
      message: `The values you gave match what is already recorded for ${employeeLabel} on ${dateText} (In: ${currentInText || "-"}, Out: ${currentOutText || "-"}). There is nothing to update.`,
      current: { employee: employeeLabel, date: dateText, inTime: currentInText, outTime: currentOutText }
    };
  }

  /* -------------------------------------------------
   * Check the times against the shift's grace window. The server
   * enforces this, so surface it before the user confirms.
   * ------------------------------------------------- */
  const warnings = [];
  let outTimeExceedsGrace = false;
  let breakInPlacement = null;
  let breakOutPlacement = null;

  const inKey = toMinuteKey(parsedInDateText, finalInText);
  const outKey = toMinuteKey(parsedOutDateText, finalOutText);

  /* The only ordering rule applied is the one the shift itself states.
   * It is checked on the full In/Out date-times, never on the bare clock
   * values, so a shift that ends after midnight is not refused for having
   * an Out "before" its In. When the API's window is single-day the shift
   * really does require the Out later the same day, and that check stays;
   * when there is no window to check against, the server decides. */
  if (inKey !== null && outKey !== null && outKey <= inKey) {
    if (shiftWindow && !shiftWindow.spansNextDay) {
      return {
        error: true,
        message: `The Out time ${finalOutText} is not after the In time ${finalInText} on ${finalInDateText}. ${employeeLabel}'s shift that day runs ${shiftWindow.text} and has to be swiped between ${shiftWindow.startText} and ${shiftWindow.endText}, which is all within one day, so the Out time cannot be on the following date. Please give an Out time later than the In time.`,
        current: Object.assign({ employee: employeeLabel, date: dateText, inTime: finalInText, outTime: finalOutText }, shiftInfo)
      };
    }
    warnings.push(`The Out time ${finalOutText} on ${finalOutDateText} is not after the In time ${finalInText} on ${finalInDateText}. The system will decide whether it accepts this.`);
  }

  if (shiftWindow) {
    if (wantsInChange && inKey !== null && (inKey < shiftWindow.start || inKey > shiftWindow.end)) {
      warnings.push(`The In time ${finalInText} on ${finalInDateText} falls outside the shift's allowed window (${targetRow.ShiftToolTip}).`);
    }
    if (wantsOutChange && outKey !== null && (outKey < shiftWindow.start || outKey > shiftWindow.end)) {
      outTimeExceedsGrace = true;
      warnings.push(`The Out time ${finalOutText} on ${finalOutDateText} falls outside the shift's allowed window (${targetRow.ShiftToolTip}). Confirming will submit it anyway, the same as accepting the warning in the UI.`);
    }
    /* A break outside the shift's allowed window is refused outright, not
     * warned about - the record must not be saved with it. */
    if (breakIn !== null && breakOut !== null) {
      /* Each break edge is placed on whichever of the window's two dates
       * it falls on, the same way the Out time is - so a break after
       * midnight on a shift that reaches there is not refused. */
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
          current: {
            employee: employeeLabel,
            date: dateText,
            shift: targetRow.ShiftAbbreviation || null,
            shiftPeriod: shiftWindow.text,
            shiftToolTip: targetRow.ShiftToolTip || null,
            breakInTime: args.breakInTime,
            breakOutTime: args.breakOutTime
          }
        };
      }
    }
  }

  /* -------------------------------------------------
   * Comment cell parity: opening it loads the day's comment history,
   * keyed by the row's own EmpNumber token - which is not the same
   * token the search was filtered by.
   * ------------------------------------------------- */
  const commentHistoryResult = await safePostJson(
    `${baseUrl}/TNAV9/api/ManualInOut/GetCommentHistoryByDate/`,
    { empNumber: rowEmpToken, datInDateText: dateText },
    ajaxHeaders
  );
  const commentHistory = Array.isArray(commentHistoryResult.body) ? commentHistoryResult.body : [];

  const previewData = {
    employee: employeeLabel,
    employeeNumber: employeeDisplayNumber,
    designation: employeeDesignation,
    date: dateText,
    shift: targetRow.ShiftAbbreviation || null,
    shiftPeriod: shiftWindow ? shiftWindow.text : null,
    inDate: finalInDateText,
    outDate: finalOutDateText,
    inTime: { current: currentInText, updated: finalInText || null },
    outTime: { current: currentOutText, updated: finalOutText || null },
    breakInTime: { current: currentBreakInText, updated: args.breakInTime || currentBreakInText },
    breakOutTime: { current: currentBreakOutText, updated: args.breakOutTime || currentBreakOutText },
    reason: args.reason,
    commentHistoryCount: commentHistory.length,
    rejectedOnThisDay,
    calculated,
    changes,
    warnings
  };

  /* -------------------------------------------------
   * Step 8: nothing is written until the user confirms. This edits
   * someone else's attendance, so the confirmation names them.
   * ------------------------------------------------- */
  if (!args.confirmed) {
    return {
      needsConfirmation: true,
      preview: previewData,
      message: warnings.length > 0
        ? `Please review the changes to ${employeeLabel}'s manual In and Out below - note the warnings - and confirm before I save them.`
        : `Please review the changes to ${employeeLabel}'s manual In and Out below and confirm before I save them.`,
      confirmationPrompt: `Are you sure you want to save these changes for ${employeeLabel}? Reply yes to update, or no to make further changes.`
    };
  }

  /* -------------------------------------------------
   * Step 9: submit. IsSelected is the row checkbox and is true only
   * on the row being changed. Every Old* field keeps its pre-edit
   * value so the server sees the before/after pair.
   * ------------------------------------------------- */
  function buildUpdatedRow(row, forceOutTimeExceedConfirmed) {
    const updated = Object.assign({}, row, {
      InTime: finalInTime,
      OutTime: finalOutTime,
      InTimeText: finalInText || "",
      OutTimeText: finalOutText || "",
      InDate: formatIsoDateOnly(parsedInDateText),
      OutDate: formatIsoDateOnly(parsedOutDateText),
      InDateText: finalInDateText,
      OutDateText: finalOutDateText,
      Comment: args.reason,
      IsSelected: true,
      IsOutTimeExceedConfirmed: forceOutTimeExceedConfirmed === true ? true : row.IsOutTimeExceedConfirmed === true
    });

    // The knockout binding stamps the "changed cell" class on whichever
    // half was actually typed into, and the submit carries it along.
    if (wantsInChange) updated.InTimeHighlightCSS = "ChangeCell_Highlight";
    if (wantsOutChange) updated.OutTimeHighlightCSS = "ChangeCell_Highlight";

    /* The grid row's DABreakList is null; the day's real breaks come from
     * GetEmployeeBreaksByDate, and the page posts them back on the row as
     * they were loaded even when the break was not touched. Sending []
     * against a non-zero BreakCount would read as "the break was removed". */
    updated.DABreakList = existingBreaks.slice();
    updated.BreakCount = existingBreaks.length;

    if (breakIn !== null && breakOut !== null) {
      const datInDate = row.DatInDate || formatIsoDateOnly(parsedDate);

      if (currentBreak) {
        // Update the existing break in place, leaving any others untouched.
        updated.DABreakList = existingBreaks.map(function (br, idx) {
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
        updated.DABreakList = existingBreaks.concat([{
          DatInDate: datInDate,
          EmpNumber: row.EmpNumber || empToken,
          SeqNo: baseSeq + 1,
          BStartDate: datInDate,
          BStartDateText: dateText,
          BStartTime: breakIn,
          BStartTimeText: args.breakInTime,
          BEndDate: datInDate,
          BEndDateText: dateText,
          BEndTime: breakOut,
          BEndTimeText: args.breakOutTime,
          BStartOldDate: null,
          BStartOldTime: -1,
          BEndOldDate: null,
          BEndOldTime: -1,
          ActionType: 1
        }]);
      }
      updated.BreakCount = updated.DABreakList.length;
    }

    return updated;
  }

  // The captured self payload carries exactly these two keys; the team
  // screen is the same view model with PageMode 1.
  async function submitList(detailList) {
    const payload = { PageMode: 1, ManualInOutDetailList: detailList };
    const raw = await fetch(`${baseUrl}/TNAV9/api/ManualInOut/SubmitManualAdjustment/`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(payload),
      redirect: "follow"
    });
    const result = await raw.json().catch(function () { return {}; });
    return { raw, result, payload };
  }

  function succeeded(attempt) {
    return attempt.raw.ok && attempt.result && attempt.result.Status === true;
  }

  function listWith(updatedRow) {
    return validSwipeRows.map(function (row, idx) {
      if (idx === tabIndex) return updatedRow;
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
    const askedForConfirmation = (submitAttempt.result && submitAttempt.result.IsConfirmationRequired === true)
      || (Array.isArray(submitAttempt.result && submitAttempt.result.ManualInOutDetailList)
        && submitAttempt.result.ManualInOutDetailList.some(function (r) { return r && r.IsConfirmationRequired === true; }));

    if (askedForConfirmation || gridRow.IsTimeExceedsConfiguredGrace === true || gridRow.IsConfirmationRequired === true) {
      updatedRow = buildUpdatedRow(targetRow, true);
      submitAttempt = await submitList(listWith(updatedRow));
      retriedWithGraceConfirmed = true;
    }
  }

  // A 5xx on the full tab list can mean the server choked on an unrelated
  // row - retry once with only the row being changed.
  if (!succeeded(submitAttempt) && submitAttempt.raw.status >= 500) {
    submitAttempt = await submitList([updatedRow]);
    retriedWithSingleRow = true;
  }

  const submitRaw = submitAttempt.raw;
  const submitResult = submitAttempt.result;

  if (!succeeded(submitAttempt)) {
    const instance = submitResult && submitResult.instance ? String(submitResult.instance) : "";
    const instanceTrace = instance.includes(":") ? instance.split(":").pop() : null;
    return {
      error: true,
      message: (submitResult && submitResult.Message) || (submitResult && submitResult.detail) || `Failed to update the manual In and Out for ${employeeLabel}. Please verify in the UI.`,
      apiResponse: submitResult,
      warnings,
      diagnostics: {
        submitHttpStatus: submitRaw.status,
        retriedWithGraceConfirmed,
        retriedWithSingleRow,
        outTimeExceedsGrace,
        employee: employeeLabel,
        employeeNumber: employeeDisplayNumber,
        selectedDate: dateText,
        validSwipeCount: validSwipeRows.length,
        validSwipeIndex: tabIndex,
        gridRowCount: recordList.length,
        totalRowsSubmitted: (submitAttempt.payload.ManualInOutDetailList || []).length,
        breakEdited: breakIn !== null && breakOut !== null,
        existingBreakCount: existingBreaks.length,
        searchContext: activeContext.label,
        pageUrl,
        culture,
        rosterGroup,
        rosterCode: usedRosterCode,
        dateSelectMode: requestedMode,
        fromDateText,
        toDateText,
        payloadTopLevelKeys: Object.keys(submitAttempt.payload || {}),
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
  // Same body to both, as after the search.
  const refreshedManualRows = refreshedList
    .filter(function (r) { return r.InOutRecordType === 1; })
    .map(toSubmitRow);
  const refreshedEmpToken = (refreshedList[0] && refreshedList[0].EmpNumber) || empToken;

  await safePostJson(`${baseUrl}/TNAV9/api/ManualInOut/GetManuallyTimeFixedData/`, refreshedManualRows, jsonHeaders);
  await safePostJson(`${baseUrl}/TNAV9/api/ManualInOut/GetManualRejectedData/`, refreshedManualRows, jsonHeaders);
  await safePostJson(`${baseUrl}/TNAV9/api/Common/GetDynamicEmployeeSummary/`, {
    pageId: 1,
    empNumber: refreshedEmpToken,
    fromDateText,
    toDateText
  }, ajaxHeaders);

  // Read the day back so the caller reports what the server actually stored.
  const savedRow = refreshedList.find(function (r) { return isoDayOf(r.DatInDate) === targetIsoDay; });

  return {
    success: true,
    message: `The manual In and Out for ${employeeLabel} on ${dateText} has been updated successfully.`,
    updated: previewData,
    saved: savedRow ? {
      employee: employeeLabel,
      date: dateText,
      inTime: savedRow.InTimeText || hhmmToText(savedRow.InTime),
      outTime: savedRow.OutTimeText || hhmmToText(savedRow.OutTime),
      breakCount: savedRow.BreakCount,
      status: savedRow.RecordStatusText || null
    } : null,
    apiResponse: submitResult
  };
});
