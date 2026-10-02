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
    return { error: true, message: "You do not have access to submit manual In and Out for your team. Please contact HR Admin." };
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

  function formatRangeDate(jsDate) {
    return formatCultureDate({
      dd: pad(jsDate.getDate()),
      mm: pad(jsDate.getMonth() + 1),
      yyyy: String(jsDate.getFullYear())
    });
  }

  function formatIsoDateOnly(parsed) {
    return `${parsed.yyyy}-${parsed.mm}-${parsed.dd}T00:00:00`;
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
   * the same clock time as HH.MM (16:52 -> 16.52), which is NOT
   * decimal hours.
   *
   * A value the user just typed goes out as the zero-padded STRING
   * "07.00", not the number 7 - that is what the page sends for the
   * edited row, while every untouched row keeps the number the server
   * gave it (-1 for an empty cell, 16 for a punch).
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
      message: "Please tell me which team member this manual In and Out is for - their employee number or name.",
      missingFields: ["Employee"]
    };
  }

  if (!args.date) {
    return {
      needsInput: true,
      message: `Please tell me the date (${dateFormatName}) to add the manual In and Out for.`,
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
  const baseUrl = `${location.origin}/${sl}`;
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
   * Page-load parity, in the order the screen itself calls them:
   *   ManualInOut/1 (above) -> Search component (above) ->
   *   GetRostersByGroupId -> GetSearchCriteria -> GetPaginatedTypeaheadList
   *
   * Which roster group is loaded varies from user to user, so it is read
   * off the page's own RosterGroupList rather than assumed - the captured
   * page listed group "6" first and that is the group the UI asked for.
   * ------------------------------------------------- */
  const rosterGroupList = Array.isArray(filterModel.RosterGroupList) ? filterModel.RosterGroupList : [];
  const rosterGroupId = args.rosterGroup
    || (rosterGroupList[0] && rosterGroupList[0].GroupId)
    || "1";

  const rosterResult = await safePostJson(
    `${baseUrl}/TNAV9/api/Common/GetRostersByGroupId/`,
    { rosterGroup: String(rosterGroupId) },
    ajaxHeaders
  );
  const rosterList = Array.isArray(rosterResult.body) ? rosterResult.body : [];

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
      message: "No team members are available for you to submit for. Please contact HR Admin if you expected to see your team here.",
      diagnostics: {
        loadedSearchComponent: !!searchComponentUrl,
        searchComponentStatus: searchStatus,
        foundComponentKey: !!componentKey,
        usedPageSearchKey: !!pageSearchKey,
        contextAttempts
      }
    };
  }

  /* The feed answers {"id":"000003","text":"000003 - Liam Taylor"} - id is
   * the value GetEmpNumberFromTypeahead takes, and the number the user
   * types is the one in front of the " - " in text. Match on that, never
   * on a bare substring of the whole label. */
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
    // Last resort: the feed's own id, for a caller that already has one.
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

  // Never guess between people - a wrong pick writes the wrong person's attendance.
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
   * Step 5: search the subordinate's grid (PageMode 1).
   *
   * The screen searches a wide period rather than the single day, and
   * the submit posts back the whole tab, so the range has to be the
   * same shape here. It is built to always contain the target date,
   * however far back it is.
   * ------------------------------------------------- */
  const today = new Date();
  const targetJsDate = new Date(Number(parsedDate.yyyy), Number(parsedDate.mm) - 1, Number(parsedDate.dd));
  const fromJsDate = new Date(Math.min(Number(parsedDate.yyyy), today.getFullYear() - 3), 0, 1);
  const lastJsDate = targetJsDate > today ? targetJsDate : today;
  const toJsDate = new Date(lastJsDate.getFullYear(), lastJsDate.getMonth() + 1, 0);

  const fromDateText = formatRangeDate(fromJsDate);
  const toDateText = formatRangeDate(toJsDate);

  function buildGridPayload(roster) {
    return {
      FromDateText: fromDateText,
      ToDateText: toDateText,
      IsGroupByEmployee: false,
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
  let namedRosterCode = args.rosterCode || null;
  if (!namedRosterCode && args.rosterName) {
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
    namedRosterCode = rosterMatch.RosterCode;
  }

  const rosterAttempts = [];
  function addRosterAttempt(code) {
    if (code === null || code === undefined) return;
    if (rosterAttempts.indexOf(code) === -1) rosterAttempts.push(code);
  }
  addRosterAttempt(namedRosterCode);
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
    if (gridPayload === null || rows.length > 0) {
      gridPayload = attemptPayload;
      usedRosterCode = rosterAttempts[i];
    }
    if (rows.length > 0) {
      recordList = rows;
      break;
    }
  }

  /* -------------------------------------------------
   * Search parity, in the order the screen itself calls them once the
   * Search button is pressed:
   *   GetGridDataByCriteria (above) -> GetManuallyTimeFixedData ->
   *   GetManualRejectedData -> GetLocalizedMessage -> GetDynamicEmployeeSummary
   *
   * GetManuallyTimeFixedData and GetManualRejectedData are both posted
   * the SAME array - the InOutRecordType 1 rows the grid is showing,
   * shaped the way the submit shapes them. Confirmed against the capture:
   * both payloads are 20 rows, every one of them type 1, beginning at
   * 2024-11-04 - the first type 1 row - while the grid itself begins at
   * 2024-11-01 (a type 3 row).
   * ------------------------------------------------- */
  const gridEmpToken = (recordList[0] && recordList[0].EmpNumber) || empToken;

  const submittableRows = recordList
    .filter(function (r) { return r.InOutRecordType === 1; })
    .map(toSubmitRow);

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

  // The grid's "Select All" caption, fetched the way the screen fetches it.
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

  const gridRow = recordList.find(function (item) {
    return isoDayOf(item.DatInDate) === targetIsoDay;
  });

  /* -------------------------------------------------
   * Step 6: the day-state gate. Which grid the date landed in decides
   * everything that follows, so it is settled here - before any time or
   * reason is asked for - rather than after the user has typed them.
   * ------------------------------------------------- */
  if (!gridRow) {
    return {
      error: true,
      message: `${dateText} is not in the Manual In and Out page for ${employeeLabel} - there is no attendance day recorded for that date. Please check the date and try again.`,
      diagnostics: {
        employee: employeeLabel,
        searchedDate: dateText,
        fromDateText,
        toDateText,
        rosterCode: usedRosterCode,
        rowsReturned: recordList.length
      }
    };
  }

  /* A day sitting in the Valid Swipes grid already has its In and Out
   * recorded - it is an edit, not an add. Hand it to the edit tool with
   * what is on the record so the user can decide. */
  const VALID_SWIPE = 3;
  const EDIT_TOOL = "editSubordinatesManualInAndOut";

  function handOffToEdit(row) {
    const inText = hasTime(row.InTime) ? (row.InTimeText || hhmmToText(row.InTime)) : null;
    const outText = hasTime(row.OutTime) ? (row.OutTimeText || hhmmToText(row.OutTime)) : null;
    return {
      alreadyExists: true,
      useTool: EDIT_TOOL,
      message: `You have already submitted the manual In and Out for ${employeeLabel} on ${dateText} (In: ${inText || "-"}, Out: ${outText || "-"}). There is nothing to add - to change it, use the ${EDIT_TOOL} tool.`,
      current: {
        employee: employeeLabel,
        employeeNumber: employeeDisplayNumber,
        designation: employeeDesignation,
        date: dateText,
        inDate: row.InDateText || null,
        outDate: row.OutDateText || null,
        inTime: inText,
        outTime: outText,
        shift: row.ShiftAbbreviation || null,
        status: row.RecordStatusText || null,
        comment: row.Comment || null,
        breakCount: row.BreakCount
      }
    };
  }

  if (gridRow.InOutRecordType === VALID_SWIPE) {
    return handOffToEdit(gridRow);
  }

  /* The grid is split across tabs by InOutRecordType and the Submit
   * button posts only the rows of the tab you are on - mixing types in
   * one payload is what the server rejects, so scope the list to the tab
   * the selected day actually lives in. */
  const tabRecordType = gridRow.InOutRecordType;
  const sourceRows = recordList.filter(function (r) { return r.InOutRecordType === tabRecordType; });
  const tabRows = sourceRows.map(toSubmitRow);
  const tabIndex = sourceRows.findIndex(function (r) { return isoDayOf(r.DatInDate) === targetIsoDay; });
  const targetRow = tabRows[tabIndex];

  /* -------------------------------------------------
   * Locked or disabled rows cannot be written. Catch this here so the
   * user gets a reason instead of a server error after they have
   * already confirmed.
   * ------------------------------------------------- */
  const blockers = [];
  if (targetRow.IsLockedRecord === true) blockers.push("the record is locked");
  if (targetRow.IsTimeAdjLocked === 1) blockers.push("time adjustment is locked");
  if (targetRow.IsPeriodLocked === 1) blockers.push("the attendance period is locked");
  if (targetRow.IsEnabled === false) blockers.push("the record is not editable");

  if (blockers.length > 0) {
    return {
      error: true,
      message: `A manual In and Out cannot be added for ${employeeLabel} on ${dateText} because ${blockers.join(" and ")}. Please contact HR Admin.`,
      current: { employee: employeeLabel, date: dateText, status: targetRow.RecordStatusText || null }
    };
  }

  /* Whether this day has been manually fixed before, off the list the
   * search already loaded. */
  const previouslyManuallyFixed = fixedList.some(function (r) {
    return isoDayOf(r.DatInDate) === targetIsoDay
      && (!gridRow.EmpDisplayNumber || r.EmpDisplayNumber === gridRow.EmpDisplayNumber);
  });

  const hasExistingIn = hasTime(targetRow.InTime);
  const hasExistingOut = hasTime(targetRow.OutTime);
  const currentInText = hasExistingIn ? (targetRow.InTimeText || hhmmToText(targetRow.InTime)) : null;
  const currentOutText = hasExistingOut ? (targetRow.OutTimeText || hhmmToText(targetRow.OutTime)) : null;
  const shiftWindow = parseGraceWindow(targetRow.ShiftToolTip);
  const rowEmpToken = targetRow.EmpNumber || empToken;

  // Backstop for a submitting-grid row that already carries both halves -
  // same answer as the Valid Swipes gate above, there is nothing to add.
  if (hasExistingIn && hasExistingOut) {
    return handOffToEdit(targetRow);
  }

  /* -------------------------------------------------
   * Step 7: collect what is still required.
   *
   * All four of In Date, In Time, Out Date and Out Time are asked for
   * separately, never inferred - a shift can end on the date after it
   * started, so the Out Date is a real choice and not something to
   * decide on the manager's behalf. The row's own dates and the shift's
   * period go back with the question so the caller can offer them as the
   * defaults rather than asking blind.
   * ------------------------------------------------- */
  const suggestedInDateText = targetRow.InDateText || dateText;
  const suggestedOutDateText = targetRow.OutDateText || dateText;

  const missing = [];
  if (!args.inDate) missing.push("In Date");
  if (!args.inTime) missing.push("In Time");
  if (!args.outDate) missing.push("Out Date");
  if (!args.outTime) missing.push("Out Time");
  if (!args.reason) missing.push("Reason for adding manual In and Out");

  if (missing.length > 0) {
    const canEndNextDay = shiftWindow ? shiftWindow.spansNextDay : (targetRow.IsMidNightShift === 1);
    const nextDayNote = canEndNextDay
      ? ` This shift can end on the following day, so the Out Date may be ${formatCultureDate(addDays(parseCultureDate(suggestedInDateText) || parsedDate, 1))} rather than ${suggestedInDateText} - ask, do not assume.`
      : "";

    return {
      needsInput: true,
      message: `Please provide the following to add manual In and Out for ${employeeLabel} on ${dateText}: ${missing.join(", ")}. Dates are ${dateFormatName} and times are HH:mm - the In Date and In Time, and the Out Date and Out Time, are each asked for separately.${nextDayNote} Also ask whether a break should be added for this day - if yes, collect Break In Time and Break Out Time (HH:mm); if no, continue without them.`,
      missingFields: missing,
      // What the row already carries - offer these as the defaults.
      suggested: {
        inDate: suggestedInDateText,
        outDate: suggestedOutDateText
      },
      current: {
        employee: employeeLabel,
        employeeNumber: employeeDisplayNumber,
        designation: employeeDesignation,
        date: dateText,
        inDate: suggestedInDateText,
        outDate: suggestedOutDateText,
        shift: targetRow.ShiftAbbreviation || null,
        shiftPeriod: shiftWindow ? shiftWindow.text : null,
        shiftToolTip: targetRow.ShiftToolTip || null,
        shiftStart: shiftWindow ? shiftWindow.shiftInClock : null,
        shiftEnd: shiftWindow ? shiftWindow.shiftOutClock : null,
        shiftAllowedFrom: shiftWindow ? shiftWindow.startText : null,
        shiftAllowedTo: shiftWindow ? shiftWindow.endText : null,
        shiftCanEndNextDay: canEndNextDay,
        isMidNightShift: targetRow.IsMidNightShift,
        inTime: currentInText,
        outTime: currentOutText,
        status: targetRow.RecordStatusText || null,
        previouslyManuallyFixed
      }
    };
  }

  /* Breaks are only added when the user explicitly wants one - if only
   * one of the two times was given, ask for the other. */
  if ((args.breakInTime && !args.breakOutTime) || (!args.breakInTime && args.breakOutTime)) {
    return {
      needsInput: true,
      message: "You provided only one break time. Please give both Break In Time and Break Out Time (HH:mm), or say you don't want to add a break.",
      missingFields: [args.breakInTime ? "Break Out Time" : "Break In Time"]
    };
  }

  /* -------------------------------------------------
   * Step 8: validate the values (HH:mm in, HH.MM on the wire).
   * ------------------------------------------------- */
  const newIn = timeToHHMM(args.inTime);
  if (newIn === null) {
    return { error: true, message: "In Time must be in HH:mm 24-hour format, e.g. 08:30." };
  }

  const newOut = timeToHHMM(args.outTime);
  if (newOut === null) {
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

  // A half already on the record keeps the number the server gave it;
  // only the half being added goes out as the typed HH.MM string.
  const finalInTime = hasExistingIn ? targetRow.InTime : newIn;
  const finalOutTime = hasExistingOut ? targetRow.OutTime : newOut;
  const finalInText = hasExistingIn ? currentInText : args.inTime;
  const finalOutText = hasExistingOut ? currentOutText : args.outTime;

  /* -------------------------------------------------
   * Which dates the In and the Out belong to.
   *
   * Both are asked for above, so normally they arrive as arguments and
   * are used exactly as the manager gave them. resolveOutDate is the
   * fallback for a caller that supplied the times but not the Out Date:
   * it reads the window the API returned for this row (ShiftToolTip) and
   * falls back to IsMidNightShift when the tooltip cannot be parsed, so
   * an Out time earlier on the clock than the In time lands on the next
   * date exactly when this shift reaches there, and stays on the same
   * date when it does not. Nothing about any particular shift is assumed.
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

  /* -------------------------------------------------
   * Break cell parity: the grid row carries DABreakList null, the day's
   * real breaks come from GetEmployeeBreaksByDate - which is what the
   * page loads when the break count is clicked.
   * ------------------------------------------------- */
  const breaksResult = await safePostJson(
    `${baseUrl}/TNAV9/api/ManualInOut/GetEmployeeBreaksByDate/`,
    { empNumber: rowEmpToken, datInDateText: dateText },
    ajaxHeaders
  );
  const existingBreaks = Array.isArray(breaksResult.body) ? breaksResult.body : [];

  /* -------------------------------------------------
   * Check the times against the shift's grace window. The server
   * enforces this, so surface it before the user confirms.
   * ------------------------------------------------- */
  const warnings = [];
  let outTimeExceedsGrace = false;
  let breakInPlacement = null;
  let breakOutPlacement = null;

  /* Each break edge is placed on whichever of the window's two dates it
   * falls on, the same way the Out time is - so a break after midnight on
   * a shift that reaches there is not refused. */
  function breakTimesOutsideWindow(window) {
    breakInPlacement = resolveTimeInWindow(parsedInDateText, args.breakInTime, window);
    breakOutPlacement = resolveTimeInWindow(parsedInDateText, args.breakOutTime, window);
    const outside = [];
    if (!breakInPlacement.inside) {
      outside.push(`Break In Time ${args.breakInTime}`);
    }
    if (!breakOutPlacement.inside) {
      outside.push(`Break Out Time ${args.breakOutTime}`);
    }
    return outside;
  }

  function breakWindowError(outside, window) {
    return {
      error: true,
      message: `${outside.join(" and ")} ${outside.length > 1 ? "are" : "is"} not within the shift's allowed period, so this cannot be submitted. The shift and its allowed window are: ${targetRow.ShiftToolTip}. Please give break times inside that window.`,
      current: {
        employee: employeeLabel,
        date: dateText,
        shift: targetRow.ShiftAbbreviation || null,
        shiftPeriod: window.text,
        shiftToolTip: targetRow.ShiftToolTip || null,
        breakInTime: args.breakInTime,
        breakOutTime: args.breakOutTime
      }
    };
  }

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
        current: {
          employee: employeeLabel,
          date: dateText,
          shift: targetRow.ShiftAbbreviation || null,
          shiftPeriod: shiftWindow.text,
          shiftAllowedFrom: shiftWindow.startText,
          shiftAllowedTo: shiftWindow.endText,
          shiftToolTip: targetRow.ShiftToolTip || null,
          inTime: finalInText,
          outTime: finalOutText
        }
      };
    }
    warnings.push(`The Out time ${finalOutText} on ${finalOutDateText} is not after the In time ${finalInText} on ${finalInDateText}. The system will decide whether it accepts this.`);
  }

  if (shiftWindow) {
    if (!hasExistingIn && inKey !== null && (inKey < shiftWindow.start || inKey > shiftWindow.end)) {
      warnings.push(`The In time ${finalInText} on ${finalInDateText} falls outside the shift's allowed window (${targetRow.ShiftToolTip}).`);
    }
    if (!hasExistingOut && outKey !== null && (outKey < shiftWindow.start || outKey > shiftWindow.end)) {
      outTimeExceedsGrace = true;
      warnings.push(`The Out time ${finalOutText} on ${finalOutDateText} falls outside the shift's allowed window (${targetRow.ShiftToolTip}). Confirming will submit it anyway, the same as accepting the warning in the UI.`);
    }
    /* A break outside the shift's allowed window is refused outright, not
     * warned about - the record must not be submitted with it. */
    if (breakIn !== null && breakOut !== null) {
      const outOfWindow = breakTimesOutsideWindow(shiftWindow);
      if (outOfWindow.length > 0) {
        return breakWindowError(outOfWindow, shiftWindow);
      }
    }
  }

  const previewData = {
    employee: employeeLabel,
    employeeNumber: employeeDisplayNumber,
    designation: employeeDesignation,
    date: dateText,
    shift: targetRow.ShiftAbbreviation || null,
    shiftPeriod: shiftWindow ? shiftWindow.text : null,
    shiftAllowedFrom: shiftWindow ? shiftWindow.startText : null,
    shiftAllowedTo: shiftWindow ? shiftWindow.endText : null,
    inDate: finalInDateText,
    outDate: finalOutDateText,
    /* True when the Out lands on the date after the In - worth showing,
     * because it is the part of the entry a manager is most likely to
     * want to correct before confirming someone else's attendance. */
    outIsNextDay: finalOutDateText !== finalInDateText,
    outDateSource: outDateResolution.source,
    previouslyManuallyFixed,
    inTime: finalInText,
    outTime: finalOutText,
    inTimeAlreadyRecorded: hasExistingIn,
    outTimeAlreadyRecorded: hasExistingOut,
    breakInTime: args.breakInTime || null,
    breakOutTime: args.breakOutTime || null,
    existingBreakCount: existingBreaks.length,
    reason: args.reason,
    warnings
  };

  /* -------------------------------------------------
   * Step 9: nothing is written until the user confirms. This writes
   * someone else's attendance, so the confirmation names them.
   * ------------------------------------------------- */
  if (!args.confirmed) {
    return {
      needsConfirmation: true,
      preview: previewData,
      message: warnings.length > 0
        ? `Here is what will be submitted for ${employeeLabel} - note the warnings - please confirm before I save it.`
        : `Here are the details that will be submitted for ${employeeLabel}. Please confirm they are correct before I submit the manual In and Out.`,
      confirmationPrompt: `Are you sure the data above is correct for ${employeeLabel}? Reply yes to submit, or no to make changes.`
    };
  }

  /* -------------------------------------------------
   * Step 10: submit. IsSelected is the row checkbox and is true only on
   * the row being written; every other row of the tab goes along
   * untouched, exactly as the page posts them.
   * ------------------------------------------------- */
  function buildUpdatedRow(row, forceOutTimeExceedConfirmed) {
    /* InDate/OutDate are the ISO halves of InDateText/OutDateText and have
     * to move with them. Leaving the ISO date on the In date is what makes
     * the server read a legitimate overnight Out as an Out before its own
     * In - the captured UI submit sends both halves together. */
    const updated = Object.assign({}, row, {
      InDate: formatIsoDateOnly(parsedInDateText),
      OutDate: formatIsoDateOnly(parsedOutDateText),
      InTime: finalInTime,
      OutTime: finalOutTime,
      InTimeText: finalInText || "",
      OutTimeText: finalOutText || "",
      InDateText: finalInDateText,
      OutDateText: finalOutDateText,
      Comment: args.reason,
      ReasonCode: row.ReasonCode || "-1",
      IsSelected: true,
      IsOutTimeExceedConfirmed: forceOutTimeExceedConfirmed === true ? true : row.IsOutTimeExceedConfirmed === true
    });

    // The knockout binding stamps the "changed cell" class on whichever
    // half was actually typed into, and the submit carries it along.
    if (!hasExistingIn) updated.InTimeHighlightCSS = "ChangeCell_Highlight";
    if (!hasExistingOut) updated.OutTimeHighlightCSS = "ChangeCell_Highlight";

    /* The grid row's DABreakList is null; the day's real breaks come from
     * GetEmployeeBreaksByDate, and the page posts them back on the row as
     * they were loaded even when no break was added. */
    updated.DABreakList = existingBreaks.slice();
    updated.BreakCount = existingBreaks.length;

    if (breakIn !== null && breakOut !== null) {
      const datInDate = row.DatInDate || formatIsoDateOnly(parsedDate);
      /* Each break edge keeps the date it was resolved onto, so a break
       * after midnight on a shift that reaches there is stored on the
       * right day instead of being folded back onto the In date. */
      const bStartParsed = (breakInPlacement && breakInPlacement.parsed) || parsedInDateText;
      const bEndParsed = (breakOutPlacement && breakOutPlacement.parsed) || parsedInDateText;
      const baseSeq = existingBreaks.reduce(function (maxVal, br) {
        const seq = Number(br && br.SeqNo);
        return Number.isFinite(seq) && seq > maxVal ? seq : maxVal;
      }, 0);

      /* ActionType is the "was this break touched" flag: 1 for one the
       * user added or changed, 0 for one riding along untouched. A new
       * break sent as 0 is read as unmodified, which is what makes the
       * server answer "No modifications to save" - so it goes out as 1. */
      updated.DABreakList = existingBreaks.concat([{
        DatInDate: datInDate,
        EmpNumber: row.EmpNumber || empToken,
        SeqNo: baseSeq + 1,
        BStartDate: formatIsoDateOnly(bStartParsed),
        BStartDateText: formatCultureDate(bStartParsed),
        BStartTime: breakIn,
        BStartTimeText: args.breakInTime,
        BEndDate: formatIsoDateOnly(bEndParsed),
        BEndDateText: formatCultureDate(bEndParsed),
        BEndTime: breakOut,
        BEndTimeText: args.breakOutTime,
        BStartOldDate: null,
        BStartOldTime: -1,
        BEndOldDate: null,
        BEndOldTime: -1,
        ActionType: 1
      }]);
      updated.BreakCount = updated.DABreakList.length;
    }

    return updated;
  }

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
    return tabRows.map(function (row, idx) {
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
  // row - retry once with only the row being written.
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
      message: (submitResult && submitResult.Message) || (submitResult && submitResult.detail) || `Failed to submit the manual In and Out for ${employeeLabel}. Please verify in the UI.`,
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
        tabRecordType,
        tabRowCount: tabRows.length,
        tabRowIndex: tabIndex,
        gridRowCount: recordList.length,
        totalRowsSubmitted: (submitAttempt.payload.ManualInOutDetailList || []).length,
        breakAdded: breakIn !== null && breakOut !== null,
        existingBreakCount: existingBreaks.length,
        searchContext: activeContext.label,
        pageUrl,
        culture,
        rosterCode: usedRosterCode,
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
  const refreshedEmpToken = (refreshedList[0] && refreshedList[0].EmpNumber) || empToken;

  /* The recalculated day figures are asked for with the refreshed
   * tab as the body - the rows carry the EmpNumber tokens the
   * grid reload just issued, not the ones the submit went out with. */
  const refreshedSubmittableRows = refreshedList
    .filter(function (r) { return r.InOutRecordType === 1; })
    .map(toSubmitRow);

  /* Same array to both, exactly as the search does. */
  await safePostJson(`${baseUrl}/TNAV9/api/ManualInOut/GetManuallyTimeFixedData/`, refreshedSubmittableRows, jsonHeaders);
  await safePostJson(`${baseUrl}/TNAV9/api/ManualInOut/GetManualRejectedData/`, refreshedSubmittableRows, jsonHeaders);

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
    message: `Manual In and Out for ${employeeLabel} on ${dateText} has been submitted successfully.`,
    submitted: previewData,
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
