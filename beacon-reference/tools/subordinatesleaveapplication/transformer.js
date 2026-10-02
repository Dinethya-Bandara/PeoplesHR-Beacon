(async function (data, args, reqOptions) {
  if (
    !BeaconBar.user?.metaData?.menus?.some(menu =>
      menu.includes("AbsenceV9/LeaveApplication/LeaveApplication?mvc=1&isDirectSubbordiante=1")
    )
  ) {
    return {
      error: true,
      message: "You do not have access to apply for leave for your subordinates. Please contact HR Admin."
    };
  }
  
  function pad(n) { return String(n).padStart(2, "0"); }

  const culture = BeaconBar.user?.metaData?.culture || "en-GB";
  const isUsFormat = culture === "en-US";
  const dateFormatName = isUsFormat ? "MM/DD/YYYY" : "DD/MM/YYYY";

  function parseCultureDate(dateStr) {
    if (!dateStr || typeof dateStr !== "string") return null;
    const parts = dateStr.split("/");
    if (parts.length !== 3) return null;
    const first = parts[0], second = parts[1];
    let yyyy = parts[2];
    const dd = isUsFormat ? second : first;
    const mm = isUsFormat ? first : second;
    const d = Number(dd), m = Number(mm);
    if (!Number.isFinite(d) || !Number.isFinite(m)) return null;
    if (d < 1 || d > 31 || m < 1 || m > 12) return null;
    // Accept a 2-digit year (as the wire itself uses) as well as 4-digit.
    if (String(yyyy).trim().length === 2) yyyy = `20${String(yyyy).trim()}`;
    if (String(yyyy).trim().length !== 4 || !Number.isFinite(Number(yyyy))) return null;
    return { dd: pad(dd), mm: pad(mm), yyyy: String(yyyy).trim() };
  }

  function formatCultureDate(parsed) {
    return isUsFormat
      ? `${parsed.mm}/${parsed.dd}/${parsed.yyyy}`
      : `${parsed.dd}/${parsed.mm}/${parsed.yyyy}`;
  }

  // Wire format for FromDateText/ToDateText - same field order as the
  // culture, but a two-digit year, exactly as captured off the page.
  function toWireDateText(parsed) {
    const yy = parsed.yyyy.slice(-2);
    return isUsFormat ? `${parsed.mm}/${parsed.dd}/${yy}` : `${parsed.dd}/${parsed.mm}/${yy}`;
  }

  function toDateKey(parsed) {
    return Number(`${parsed.yyyy}${parsed.mm}${parsed.dd}`);
  }

  /* -------------------------------------------------
   * Request helpers - same fail-soft pattern as the other Absence /
   * Attendance tools: never throw, always hand back {ok, status, body}.
   * ------------------------------------------------- */
  const sl = reqOptions.sl;
  const baseUrl = `${location.origin}/${sl}`;

  function absenceHeaders() {
    return {
      "accept": "*/*",
      "content-type": "application/json",
      "x-requested-with": "XMLHttpRequest",
      "__cfafvalue": window.csrf || ""
    };
  }

  /* The CommonComponents search endpoints are a different surface: the
   * captured requests send the jQuery accept string and carry NO
   * __cfafvalue - that header belongs to the AbsenceV9 API only. */
  function commonComponentsHeaders() {
    return {
      "accept": "application/json, text/javascript, */*; q=0.01",
      "content-type": "application/json; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest"
    };
  }

  async function safePostJson(url, payload, headers) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: headers || absenceHeaders(),
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

  async function safeGetText(url) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "x-requested-with": "XMLHttpRequest" },
        redirect: "follow"
      });
      const text = await res.text().catch(function () { return ""; });
      return { ok: res.ok, status: res.status, text };
    } catch (e) {
      return { ok: false, status: 0, text: "" };
    }
  }

  args = args || {};

  function argOf() {
    const names = Array.prototype.slice.call(arguments);
    for (let i = 0; i < names.length; i++) {
      const v = args[names[i]];
      if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
    // Case- and separator-insensitive sweep over whatever did arrive.
    const wanted = names.map(n => n.toLowerCase().replace(/[^a-z0-9]/g, ""));
    const keys = Object.keys(args);
    for (let k = 0; k < keys.length; k++) {
      const norm = keys[k].toLowerCase().replace(/[^a-z0-9]/g, "");
      if (wanted.indexOf(norm) !== -1) {
        const v = args[keys[k]];
        if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
      }
    }
    return "";
  }

  function flagOf() {
    const names = Array.prototype.slice.call(arguments);
    for (let i = 0; i < names.length; i++) {
      const v = args[names[i]];
      if (v === true || v === "true" || v === 1 || v === "1") return true;
    }
    const wanted = names.map(n => n.toLowerCase().replace(/[^a-z0-9]/g, ""));
    const keys = Object.keys(args);
    for (let k = 0; k < keys.length; k++) {
      const norm = keys[k].toLowerCase().replace(/[^a-z0-9]/g, "");
      if (wanted.indexOf(norm) !== -1) {
        const v = args[keys[k]];
        if (v === true || v === "true" || v === 1 || v === "1") return true;
      }
    }
    return false;
  }

  const argEmployeeNumber = argOf("employeeNumber", "empNumber", "employeeId", "empId", "employeeCode", "empCode", "employeeDisplayNumber", "subordinateNumber", "employeeNo");
  const argEmployeeName = argOf("employeeName", "empName", "subordinateName", "employeeFullName", "employee", "subordinate", "name");
  const argLeaveType = argOf("leaveType", "leaveTypeName", "leaveTypeCode", "typeName", "typeCode");
  const argYear = argOf("year", "leaveYear");
  const argFromDate = argOf("fromDate", "from", "startDate", "leaveFromDate", "fromDateText");
  const argToDate = argOf("toDate", "to", "endDate", "leaveToDate", "toDateText");
  const argReason = argOf("reason", "leaveReason", "reasonForLeave", "reasonCode");
  const argComment = argOf("comment", "comments", "leaveComment");
  const argCoveringNumber = argOf("coveringEmployeeNumber", "coveringEmpNumber", "coveringEmployeeCode", "coveringEmployeeId");
  const argCoveringName = argOf("coveringEmployeeName", "coveringEmpName", "coveringEmployee");
  const argApproverNumber = argOf("approverNumber", "approvalEmpNumber", "approverEmployeeNumber", "approver");
  const argConfirmed = flagOf("confirmed", "isConfirmed", "confirm");
  const argDayModes = Array.isArray(args.dayModes) ? args.dayModes
    : (Array.isArray(args.DayModes) ? args.DayModes : null);

  /* -------------------------------------------------
   * Step 2: load the Team Leave Application page.
   * ------------------------------------------------- */
  const updateUrl = await BeaconBar.executeFunction("updateUrlParams")(
    "AbsenceV9/LeaveApplication/LeaveApplication?mvc=1&isDirectSubbordiante=1"
  );

  /* getDigest signs the page's own params - the BeaconBar "application" /
   * "employeeLeaveApplication" functions all load Absence pages this way
   * (updateUrlParams for the route, getDigest for the signature), and the
   * route answers with an incomplete page without it. */
  let pageDigest = null;
  try {
    const digestResult = await BeaconBar.executeFunction("getDigest")(updateUrl && updateUrl.updateParams);
    pageDigest = digestResult && digestResult.digest ? digestResult.digest : null;
  } catch (e) {
    pageDigest = null;
  }

  const pagePath = updateUrl && updateUrl.updateUrl
    ? updateUrl.updateUrl
    : "AbsenceV9/LeaveApplication/LeaveApplication?mvc=1&isDirectSubbordiante=1";
  const pageUrl = pageDigest
    ? `${baseUrl}/${pagePath}&digest=${pageDigest}&_=${Date.now()}`
    : `${baseUrl}/${pagePath}`;

  const pageResult = await safeGetText(pageUrl);
  const pageHtml = pageResult.text || "";

  /* The anti-forgery token every AbsenceV9 API call needs. Same source and
   * same global the platform's own functions use, so a later tool in the
   * same session finds it already populated. */
  function parseCsrfToken(html) {
    if (!html) return null;
    try {
      const dom = new DOMParser().parseFromString(html, "text/html");
      const el = dom.querySelector("#hdbAbsenceV9AFToken");
      if (el && el.value) return el.value;
    } catch (e) {
      // fall through to the regex below
    }
    const m = html.match(/id="hdbAbsenceV9AFToken"\s+value="([^"]+)"/);
    return m ? m[1] : null;
  }

  const csrfToken = parseCsrfToken(pageHtml);
  if (csrfToken) window.csrf = csrfToken;

  /* The page declares its JSON blobs two different ways - the leave page
   * uses `var model = '...'` while the search widget uses
   * `window.advancedModelObj = '...'` - so both forms are accepted. */
  function parseJsStringLiteral(html, varName) {
    if (!html) return null;
    const forms = [
      new RegExp(`var\\s+${varName}\\s*=\\s*'([\\s\\S]*?)';`),
      new RegExp(`window\\.${varName}\\s*=\\s*'([\\s\\S]*?)';`),
      new RegExp(`${varName}\\s*=\\s*'([\\s\\S]*?)';`)
    ];
    for (let i = 0; i < forms.length; i++) {
      const m = html.match(forms[i]);
      if (m) {
        try { return JSON.parse(m[1]); } catch (e) { /* try the next form */ }
      }
    }
    return null;
  }

  const pageModel = parseJsStringLiteral(pageHtml, "model") || {};
  const loginEmpNumber = pageModel.LoginEmpNumber || null;

  if (!loginEmpNumber) {
    return {
      error: true,
      message: "Unable to initialize the Team Leave Application page. Please try again.",
      diagnostics: {
        pageUrl,
        httpStatus: pageResult.status,
        htmlLength: pageHtml.length,
        containsModel: pageHtml.includes("var model"),
        looksLikeLoginPage: /login/i.test(pageHtml.slice(0, 500))
      }
    };
  }

  // The toolbar's "search my subordinate" URL - carries its own digest,
  // scoped with searchQueryMode=subordinatesonly. Escaped as &amp; in the
  // markup, same as the page's own SetSearchPopover() unescapes it.
  function extractQuotedUrl(html, mustContain) {
    if (!html) return null;
    const idx = html.indexOf(mustContain);
    if (idx === -1) return null;
    let start = idx;
    while (start > 0 && html[start - 1] !== "'" && html[start - 1] !== '"') start--;
    let end = idx;
    while (end < html.length && html[end] !== "'" && html[end] !== '"') end++;
    return html.slice(start, end).replace(/&amp;/g, "&");
  }

  /* Preferred: the fully-formed, already-signed subordinate search URL the
   * page bakes into SetSearchPopover(). Fallback: rebuild it from the
   * page's own pieces the way the BeaconBar "application" function does -
   * empNumber / searchToken / digest each regex'd out of the markup - so a
   * page whose toolbar markup differs still resolves. searchQueryMode and
   * searchQueryState are the captured values for this screen. */
  function buildSubordinateSearchUrl(html) {
    const embedded = extractQuotedUrl(html, "searchQueryMode=subordinatesonly");
    if (embedded) return { url: embedded, source: "embedded" };

    const empNumberMatch = html.match(/empNumber=([^&"']*)/);
    const searchTokenMatch = html.match(/searchToken=([^&"']*)/);
    const digestMatch = html.match(/digest=([A-Za-z0-9+/=]+)/);
    const elgModIdMatch = html.match(/elgmodid=([^&"']*)/);

    if (!empNumberMatch || !searchTokenMatch) return { url: null, source: "none" };

    const empNumber = decodeURIComponent(empNumberMatch[1]);
    const searchToken = decodeURIComponent(searchTokenMatch[1]);
    const elgModId = elgModIdMatch ? elgModIdMatch[1] : "14";
    const digest = digestMatch ? digestMatch[1] : (pageDigest || "");

    return {
      url: `../CommonComponents/Search/Search?empNumber=${encodeURIComponent(empNumber)}&callBack=MQA0ACwAMgA=&searchMode=2&searchQueryMode=subordinatesonly&searchQueryState=activeonly&isMultiple=0&breadCrumbEnable=0&isDivLoading=1&elgmodid=${elgModId}&searchToken=${encodeURIComponent(searchToken)}&digest=${digest}&_=${Date.now()}`,
      source: "rebuilt"
    };
  }

  const subordinateSearch = buildSubordinateSearchUrl(pageHtml);
  const subordinateSearchUrlRaw = subordinateSearch.url;

  function resolveSearchUrl(rawUrl) {
    if (!rawUrl) return null;
    const path = String(rawUrl).replace(/^(\.\.\/)+/, "").replace(/^\/+/, "");
    return `${baseUrl}/${path}`;
  }

  /* The widget's own EmpNumber/KeyValue pair. Preferred route is the whole
   * advancedModelObj blob, but the platform's own "application" function
   * does not bother with the declaration at all - it regexes the two fields
   * straight out of the response text. That fallback is kept here because
   * it survives any change to how the blob is declared or named. */
  function parseAdvancedModel(html) {
    const parsed = parseJsStringLiteral(html, "advancedModelObj");
    if (parsed && parsed.EmpNumber && parsed.KeyValue) return parsed;

    if (!html) return parsed;
    const empMatch = html.match(/"EmpNumber":"([^"]+)"/);
    const keyMatch = html.match(/"KeyValue":"([^"]+)"/);
    if (empMatch && keyMatch) {
      return Object.assign({}, parsed || {}, {
        EmpNumber: empMatch[1],
        KeyValue: keyMatch[1],
        _via: "field-regex"
      });
    }
    return parsed;
  }

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

  // Rows are normalised to {number, name, dateJoined, text, id?} by the
  // listing helpers below, whichever endpoint they came from.
  function matchEmployee(rows, wantedNumber, wantedName) {
    let matches = [];
    if (wantedNumber) {
      matches = rows.filter(r => r.number.toLowerCase() === wantedNumber);
      if (matches.length === 0) matches = rows.filter(r => stripZeros(r.number) === stripZeros(wantedNumber));
      if (matches.length === 0) matches = rows.filter(r => String(r.id || "").toLowerCase().trim() === wantedNumber);
    }
    if (matches.length === 0 && wantedName) {
      matches = rows.filter(r => r.name.toLowerCase() === wantedName);
      if (matches.length === 0) matches = rows.filter(r => String(r.text || "").toLowerCase().includes(wantedName));
    }
    return matches;
  }

  /* -------------------------------------------------
   * Loads the search widget (subordinate or, later, covering-employee)
   * and resolves a name/number to the encrypted EmpNumber token the
   * Leave Application APIs require. 
   * ------------------------------------------------- */
  async function resolveEmployeeToken(searchUrlRaw, wantedNumber, wantedName, label) {
    const searchUrl = resolveSearchUrl(searchUrlRaw);
    if (!searchUrl) {
      return {
        error: true,
        message: `Could not locate the ${label} search widget on the Team Leave Application page. This is a page-parsing problem, not a permissions or reporting-hierarchy problem.`,
        diagnostics: {
          pageUrl,
          pageHttpStatus: pageResult.status,
          htmlLength: pageHtml.length,
          searchUrlSource: subordinateSearch.source,
          pageHasSubordinatesOnly: pageHtml.includes("searchQueryMode=subordinatesonly"),
          pageHasSearchToken: pageHtml.includes("searchToken="),
          gotCsrf: !!window.csrf
        }
      };
    }
    const compResult = await safeGetText(searchUrl);
    const advModel = parseAdvancedModel(compResult.text || "");
    if (!advModel || !advModel.EmpNumber || !advModel.KeyValue) {
      return {
        error: true,
        message: `Unable to initialize the ${label} search. This is a search-widget problem, not a reporting-hierarchy problem.`,
        diagnostics: {
          searchUrl,
          searchUrlSource: subordinateSearch.source,
          httpStatus: compResult.status,
          htmlLength: (compResult.text || "").length,
          foundAdvancedModel: !!advModel
        }
      };
    }
    const componentEmpNumber = advModel.EmpNumber;
    const keyValue = advModel.KeyValue;

    /* GetSearchList is what the popup's own grid calls */
    async function listViaSearchList(pageNo) {
      const result = await safePostJson(`${baseUrl}/CommonComponents/Search/GetSearchList/`, {
        empNumber: componentEmpNumber,
        criteriaValues: [],
        key: keyValue,
        modeId: "2",
        supEmpNumber: null,
        tblPageNo: pageNo || 1,
        tblSearchText: "",
        sortColumn: "2",
        sortOrder: "asc"
      }, commonComponentsHeaders());
      const data = result.body && result.body.Object && result.body.Object.data;
      const rows = Array.isArray(data) ? data : [];
      return {
        status: result.status,
        pageData: result.body && result.body._pageData,
        rows: rows.map(r => ({
          number: String(r.Col1 || "").trim(),
          name: String(r.Col2 || "").trim(),
          dateJoined: String(r.Col3 || "").trim(),
          activeStatus: String(r.Col4 || "").trim(),
          text: `${String(r.Col1 || "").trim()} - ${String(r.Col2 || "").trim()}`
        }))
      };
    }

    async function listViaTypeahead() {
      const result = await safeGetJson(
        `${baseUrl}/CommonComponents/Search/GetPaginatedTypeaheadList/?empNumber=${encodeURIComponent(componentEmpNumber)}&key=${encodeURIComponent(keyValue)}&_=${Date.now()}`
      );
      const rows = (result.body && result.body.results) || [];
      return {
        status: result.status,
        rows: rows.map(r => ({
          number: displayNumberOf(r),
          name: displayNameOf(r),
          dateJoined: "",
          text: String(r.text || ""),
          id: r.id
        }))
      };
    }

    const attempts = [];
    let rows = [];

    const firstPage = await listViaSearchList(1);
    attempts.push({ via: "GetSearchList(page 1)", status: firstPage.status, rows: firstPage.rows.length });
    rows = firstPage.rows;

    const totalPages = firstPage.pageData && Number(firstPage.pageData.TotalPages) || 1;
    for (let page = 2; page <= totalPages && page <= 20; page++) {
      const next = await listViaSearchList(page);
      attempts.push({ via: `GetSearchList(page ${page})`, status: next.status, rows: next.rows.length });
      rows = rows.concat(next.rows);
    }

    if (rows.length === 0) {
      const typeahead = await listViaTypeahead();
      attempts.push({ via: "GetPaginatedTypeaheadList", status: typeahead.status, rows: typeahead.rows.length });
      rows = typeahead.rows;
    }

    if (rows.length === 0) {
      return {
        error: true,
        message: `The ${label} search returned no one at all. This usually means the search widget did not accept its own session key, not that the employee is missing.`,
        diagnostics: { attempts, searchUrlSource: subordinateSearch.source, gotCsrf: !!window.csrf }
      };
    }

    /* Nobody named: hand back the actual team rather than just asking
     * "who?". An empty call is then still useful - it is how the assistant
     * discovers the list - and a manager with exactly one report needs no
     * question at all. */
    if (!wantedNumber && !wantedName && rows.length !== 1) {
      return {
        needsInput: true,
        message: `Which team member would you like to apply leave for? Here are your ${label}s.`,
        missingFields: ["Employee"],
        teamMembers: rows.map(r => ({
          employeeNumber: r.number,
          employee: r.name,
          dateJoined: r.dateJoined,
          status: r.activeStatus
        }))
      };
    }

    // One report and nobody named - no question worth asking.
    const matches = (!wantedNumber && !wantedName)
      ? rows
      : matchEmployee(rows, wantedNumber, wantedName);
    if (matches.length === 0) {
      return {
        error: true,
        message: `"${wantedNumber || wantedName}" is not in your list of ${label}s. Here are the ${rows.length} you can apply leave for - please pick one of these.`,
        teamMembers: rows.slice(0, 50).map(r => ({ employeeNumber: r.number, employee: r.name })),
        diagnostics: { attempts }
      };
    }
    if (matches.length > 1) {
      return {
        needsInput: true,
        message: `"${wantedNumber || wantedName}" matches more than one ${label}. Please tell me which one.`,
        candidates: matches.map(r => ({ employeeNumber: r.number, employee: r.text }))
      };
    }

    const match = matches[0];
    const plainNumber = match.number;
    const displayName = match.name;

    /* GetEmpNumber's captured signature carries empDateJoined; the live
     * employeeLogKey fetcher fills it from the search grid's third column,
     * so pass that through when the grid supplied it. */
    const tokenResult = await safeGetJson(
      `${baseUrl}/CommonComponents/Search/GetEmpNumber/?loggedEmpNumber=${encodeURIComponent(componentEmpNumber)}&empNumber=${encodeURIComponent(plainNumber)}&empDisplayName=${encodeURIComponent(displayName)}&empDateJoined=${encodeURIComponent(match.dateJoined || "")}&key=${encodeURIComponent(keyValue)}&_=${Date.now()}`
    );
    const token = tokenResult.body && tokenResult.body.Status ? tokenResult.body.Message : null;
    if (!token) {
      return {
        error: true,
        message: `Unable to resolve ${displayName || wantedNumber || wantedName}. Please try again.`,
        diagnostics: { tokenStatus: tokenResult.status, apiMessage: (tokenResult.body && tokenResult.body.Message) || null }
      };
    }

    return { token, plainNumber, displayName };
  }

  const wantedNumber = (argEmployeeNumber || "").toLowerCase().trim();
  const wantedName = (argEmployeeName || "").toLowerCase().trim();

  const subordinate = await resolveEmployeeToken(subordinateSearchUrlRaw, wantedNumber, wantedName, "team member");
  if (subordinate.error || subordinate.needsInput) return subordinate;

  let empToken = subordinate.token;
  let employeeLabel = subordinate.displayName || subordinate.plainNumber;
  let employeeDisplayNumber = subordinate.plainNumber;
  let employeeDesignation = null;

  /* -------------------------------------------------
   * Step 3: load the selected employee's leave application context -
   * identity, reasons (filtered to ones visible on the supervisor
   * screen), covering-employee setup, notification info.
   * ------------------------------------------------- */
  const leaveDataResult = await safePostJson(`${baseUrl}/AbsenceV9/api/LeaveApplication/GetEmployeeLeaveData/`, { EmpNumber: empToken });
  const leaveData = leaveDataResult.body || {};

  if (leaveData.EmployeeData) {
    employeeLabel = leaveData.EmployeeData.EmpDisplayName || employeeLabel;
    employeeDisplayNumber = leaveData.EmployeeData.EmpDisplayNumber || employeeDisplayNumber;
    employeeDesignation = leaveData.EmployeeData.Designation || null;
  }

  const reasonList = Array.isArray(leaveData.ReasonList)
    ? leaveData.ReasonList.filter(r => r.HideSupervisorApplication !== true)
    : [];
  const recentCoveringEmployees = Array.isArray(leaveData.RecentCoveringEmployeeList) ? leaveData.RecentCoveringEmployeeList : [];
  const coveringEmployeeSearchUrlRaw = leaveData.CoveringEmployeeSearchURL || null;

  /* -------------------------------------------------
   * Step 4: leave year and leave type - both entitled-to lists are
   * scoped to this employee, not the supervisor.
   * ------------------------------------------------- */
  const yearsResult = await safePostJson(`${baseUrl}/AbsenceV9/api/LeaveApplication/GetEntitledLeaveYears/`, { EmpNumber: empToken });
  const yearList = Array.isArray(yearsResult.body) ? yearsResult.body : [];
  if (yearList.length === 0) {
    return { error: true, message: `No leave years are available for ${employeeLabel}. Please contact HR Admin.` };
  }

  let leaveYear = null;
  if (argYear) {
    const wantedYear = Number(argYear);
    const yearMatch = yearList.find(y => y.YearCode === wantedYear);
    if (!yearMatch) {
      return {
        error: true,
        message: `${argYear} is not an available leave year for ${employeeLabel}.`,
        availableYears: yearList.map(y => y.YearCode)
      };
    }
    leaveYear = yearMatch.YearCode;
  } else {
    const currentYear = new Date().getFullYear();
    const currentMatch = yearList.find(y => y.YearCode === currentYear);
    leaveYear = currentMatch ? currentMatch.YearCode : yearList[0].YearCode;
  }

  const typesResult = await safePostJson(`${baseUrl}/AbsenceV9/api/LeaveApplication/GetEntitledLeaveTypes/`, {
    EmpNumber: empToken,
    LeaveYear: leaveYear,
    ApplicationPage: 1
  });
  const leaveTypeList = (Array.isArray(typesResult.body) ? typesResult.body : [])
    .filter(t => t.HideSupervisorApplication !== true);

  if (leaveTypeList.length === 0) {
    return { error: true, message: `${employeeLabel} has no leave types available to apply for in ${leaveYear}. Please contact HR Admin.` };
  }

  function matchLeaveType(wanted) {
    const w = String(wanted || "").toLowerCase().trim();
    if (!w) return null;
    return leaveTypeList.find(t => String(t.TypeName || "").toLowerCase().trim() === w)
      || leaveTypeList.find(t => String(t.TypeCode || "").toLowerCase().trim() === w)
      || leaveTypeList.find(t => String(t.TypeName || "").toLowerCase().includes(w))
      || null;
  }

  function leaveTypeSummary(t) {
    return {
      leaveType: t.TypeName,
      typeCode: t.TypeCode,
      balance: t.Entitlement ? t.Entitlement.BalanceDV : null,
      entitlement: t.Entitlement ? t.Entitlement.EntitlementDV : null,
      allowHalfDay: t.AllowHalfDay === 1,
      coveringEmployeeRequired: t.CoveringEmployeeRequired === 1,
      attachmentRequired: t.IsAttachmentRequired === 1,
      commentMandatory: t.IsCommentMandatory === 1,
      maxDaysInSingleInstance: t.MaxDaysInSingleInstance
    };
  }

  if (!argLeaveType) {
    return {
      needsInput: true,
      message: `Which leave type would you like to apply for ${employeeLabel}? Here are the leave types available for ${leaveYear}, with the current balance.`,
      missingFields: ["Leave Type"],
      current: { employee: employeeLabel, employeeNumber: employeeDisplayNumber, leaveYear },
      leaveTypes: leaveTypeList.map(leaveTypeSummary)
    };
  }

  const leaveType = matchLeaveType(argLeaveType);
  if (!leaveType) {
    return {
      error: true,
      message: `"${argLeaveType}" is not a leave type available for ${employeeLabel} in ${leaveYear}.`,
      leaveTypes: leaveTypeList.map(leaveTypeSummary)
    };
  }

  function enabledAdditionalFields(t) {
    const f = t.LevTypeAdditionalField;
    const supported = [];
    const unsupported = [];
    if (t.EnableAdditionalFields !== 1 || !f) return { supported, unsupported };

    for (let i = 1; i <= 5; i++) {
      if (f["EnableDate_" + i]) {
        supported.push({
          label: f["Date_" + i + "_Label"] || `Date ${i}`,
          payloadKey: "Date_" + i + "_Text"
        });
      }
    }
    [["Comment", 6], ["Numeric", 5], ["DropDown", 5], ["Radio", 5], ["Check", 5]].forEach(function (pair) {
      const kind = pair[0], count = pair[1];
      for (let i = 1; i <= count; i++) {
        if (f["Enable" + kind + "_" + i]) {
          unsupported.push(f[kind + "_" + i + "_Label"] || `${kind} ${i}`);
        }
      }
    });
    return { supported, unsupported };
  }

  const extraFields = enabledAdditionalFields(leaveType);

  if (extraFields.unsupported.length > 0) {
    return {
      error: true,
      message: `${leaveType.TypeName} needs extra fields this tool cannot fill yet (${extraFields.unsupported.join(", ")}). Please apply this leave type from the web UI.`
    };
  }

  /* Values for the supported extra fields, matched on their label - the
   * caller passes additionalFields as {"<label>": "<value>"}. */
  const extraFieldValues = {};
  if (extraFields.supported.length > 0) {
    const supplied = (args.additionalFields && typeof args.additionalFields === "object")
      ? args.additionalFields
      : (args.AdditionalFields && typeof args.AdditionalFields === "object" ? args.AdditionalFields : {});

    function suppliedValueFor(label) {
      const norm = String(label).toLowerCase().replace(/[^a-z0-9]/g, "");
      const keys = Object.keys(supplied);
      for (let i = 0; i < keys.length; i++) {
        if (String(keys[i]).toLowerCase().replace(/[^a-z0-9]/g, "") === norm) {
          const v = supplied[keys[i]];
          if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
        }
      }
      return "";
    }

    const missing = [];
    extraFields.supported.forEach(function (field) {
      const value = suppliedValueFor(field.label);
      if (!value) { missing.push(field.label); return; }
      /* These are declared as date controls, so a value that parses as a
       * date goes out in the wire format the other dates use; anything
       * else is passed through untouched rather than mangled. */
      const parsedExtra = parseCultureDate(value);
      extraFieldValues[field.payloadKey] = parsedExtra ? toWireDateText(parsedExtra) : value;
    });

    if (missing.length > 0) {
      return {
        needsInput: true,
        message: `${leaveType.TypeName} needs ${missing.length > 1 ? "these extra details" : "one extra detail"} for ${employeeLabel}: ${missing.join(", ")}. Please provide ${missing.length > 1 ? "them" : "it"}.`,
        missingFields: missing,
        additionalFieldsExpected: extraFields.supported.map(f => f.label)
      };
    }
  }

  const attachmentSources = { baoHelperPresent: false, baoCount: 0, base64Count: 0, error: null };

  function uploadedFiles() {
    const files = [];

    const raw = args.attachment || args.Attachment || args.attachments || args.Attachments;
    const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    list.forEach(function (att) {
      if (!att || typeof att !== "object") return;
      const base64 = att.base64Data || att.base64 || att.data || att.Base64Data;
      const fileName = att.fileName || att.name || att.filename || att.FileName;
      if (!base64 || !fileName) return;
      try {
        const clean = String(base64).replace(/^data:[^,]*,/, "");
        const byteChars = atob(clean);
        const byteArr = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
        files.push(new File([new Blob([byteArr])], fileName));
        attachmentSources.base64Count++;
      } catch (e) {
        attachmentSources.error = "base64 decode failed for " + fileName;
      }
    });

    // 2. Files attached in the chat - the route both live tools use.
    try {
      if (BeaconBar && typeof BeaconBar.getUploadedBaoFiles === "function") {
        attachmentSources.baoHelperPresent = true;
        const bao = BeaconBar.getUploadedBaoFiles();
        const baoList = Array.isArray(bao) ? bao.filter(Boolean) : (bao ? [bao] : []);
        attachmentSources.baoCount = baoList.length;
        baoList.forEach(function (f) { files.push(f); });
      }
    } catch (e) {
      attachmentSources.error = String(e && e.message || e);
    }

    return files;
  }

  const attachments = uploadedFiles();
  const attachmentRequired = leaveType.IsAttachmentRequired === 1;
  // Allowed even when not required - IsAttachmentAllowed comes off the page
  // model, and a leave type that demands one obviously permits one.
  const attachmentAllowed = attachmentRequired || leaveData.IsAttachmentAllowed === true;

  /* -------------------------------------------------
   * Step 5: dates.
   * ------------------------------------------------- */
  if (!argFromDate) {
    return {
      needsInput: true,
      message: `Please tell me the From Date (${dateFormatName}) for ${employeeLabel}'s ${leaveType.TypeName}. Give a To Date too if it spans more than one day.`,
      missingFields: ["From Date"],
      expectedDateFormat: dateFormatName,
      current: { employee: employeeLabel, leaveType: leaveType.TypeName, leaveYear }
    };
  }

  const parsedFrom = parseCultureDate(argFromDate);
  if (!parsedFrom) return { error: true, message: `Invalid From Date. Please provide it as ${dateFormatName}.` };
  const parsedTo = argToDate ? parseCultureDate(argToDate) : parsedFrom;
  if (argToDate && !parsedTo) return { error: true, message: `Invalid To Date. Please provide it as ${dateFormatName}.` };
  if (toDateKey(parsedFrom) > toDateKey(parsedTo)) {
    return { error: true, message: `From Date (${formatCultureDate(parsedFrom)}) is after To Date (${formatCultureDate(parsedTo)}).` };
  }

  const fromDateText = toWireDateText(parsedFrom);
  const toDateText = toWireDateText(parsedTo);

  /* -------------------------------------------------
   * Step 6: approver. 
   * ------------------------------------------------- */
  const approvalResult = await safePostJson(`${baseUrl}/AbsenceV9/api/LeaveApplication/GetApprovalPerson/`, {
    EmpNumber: empToken,
    LeaveGroup: leaveType.LGCode,
    LeaveYear: leaveYear,
    LeaveType: leaveType.TypeCode,
    ApplicationPage: 1
  });
  const approvalData = approvalResult.body || {};
  const appPersonList = Array.isArray(approvalData.AppPersonList) ? approvalData.AppPersonList : [];

  let approverNumber = approvalData.EmpNumber || null;
  let approverDisplayText = approvalData.DisplayText || null;

  if (argApproverNumber) {
    const approverMatch = appPersonList.find(p => String(p.AppEmpNumber) === String(argApproverNumber));
    if (!approverMatch) {
      return {
        error: true,
        message: `"${argApproverNumber}" is not a valid approver for ${employeeLabel}'s ${leaveType.TypeName}.`,
        availableApprovers: appPersonList.map(p => ({ number: p.AppEmpNumber, name: p.AppDisplayText }))
      };
    }
    approverNumber = approverMatch.AppEmpNumber;
    approverDisplayText = approverMatch.AppDisplayText;
  } else if (!approverNumber && leaveType.AllowSelectApprover === 1 && appPersonList.length > 1) {
    return {
      needsInput: true,
      message: `More than one approver is available for ${employeeLabel}'s ${leaveType.TypeName}. Please tell me which one.`,
      missingFields: ["Approver"],
      availableApprovers: appPersonList.map(p => ({ number: p.AppEmpNumber, name: p.AppDisplayText }))
    };
  } else if (!approverNumber && appPersonList.length > 0) {
    approverNumber = appPersonList[0].AppEmpNumber;
    approverDisplayText = appPersonList[0].AppDisplayText;
  }

  if (!approverNumber) {
    return { error: true, message: `No approver could be resolved for ${employeeLabel}'s ${leaveType.TypeName}. Please contact HR Admin.` };
  }

  /* -------------------------------------------------
   * Step 7: covering employee
   * ------------------------------------------------- */
  let coveringEmployeeNumber = null;
  if (leaveType.CoveringEmployeeRequired === 1) {
    const wantedCoverNumber = (argCoveringNumber || "").toLowerCase().trim();
    const wantedCoverName = (argCoveringName || "").toLowerCase().trim();

    if (!wantedCoverNumber && !wantedCoverName) {
      return {
        needsInput: true,
        message: `${leaveType.TypeName} requires a covering employee for ${employeeLabel}. Please pick one, or give a name/number to search.`,
        missingFields: ["Covering Employee"],
        recentCoveringEmployees: recentCoveringEmployees.map(e => ({ number: e.EmpDisplayNumber, name: e.EmpDisplayName }))
      };
    }

    const recentMatch = recentCoveringEmployees.find(e =>
      (wantedCoverNumber && String(e.EmpDisplayNumber || "").toLowerCase().trim() === wantedCoverNumber) ||
      (wantedCoverName && String(e.EmpDisplayName || "").toLowerCase().trim() === wantedCoverName)
    );

    if (recentMatch) {
      coveringEmployeeNumber = recentMatch.EmpDisplayNumber;
    } else {
      const coveringResolved = await resolveEmployeeToken(coveringEmployeeSearchUrlRaw, wantedCoverNumber, wantedCoverName, "covering employee");
      if (coveringResolved.error || coveringResolved.needsInput) return coveringResolved;
      coveringEmployeeNumber = coveringResolved.plainNumber;
    }
  }

  /* -------------------------------------------------
   * Step 8: reason and comment.
   * ------------------------------------------------- */
    let reasonCode = null;
  if (leaveType.ShowLeaveReason === 1 && reasonList.length > 0 && argReason) {
    const wantedReason = String(argReason).toLowerCase().trim();
    const reasonMatch = reasonList.find(r => decodeURIComponent(r.Description || "").replace(/%20/g, " ").toLowerCase().trim() === wantedReason)
      || reasonList.find(r => String(r.ReasonCode) === String(argReason));
    if (!reasonMatch) {
      return {
        error: true,
        message: `"${argReason}" is not a valid reason for ${leaveType.TypeName}.`,
        reasons: reasonList.map(r => ({ code: r.ReasonCode, description: decodeURIComponent(r.Description || "").replace(/%20/g, " ") }))
      };
    }
    reasonCode = reasonMatch.ReasonCode;
  }

  if (leaveType.IsCommentMandatory === 1 && !argComment) {
    return {
      needsInput: true,
      message: `A comment is required for ${employeeLabel}'s ${leaveType.TypeName}.`,
      missingFields: ["Comment"]
    };
  }

  /* -------------------------------------------------
   * Step 8b: attachment. Asked for last, once everything else about the application is settled
   * ------------------------------------------------- */
  if (attachmentRequired && attachments.length === 0) {
    return {
      needsInput: true,
      message: `${leaveType.TypeName} requires an attachment. Please attach the document to this chat and ask again - I will upload it with ${employeeLabel}'s application. This tool CAN upload attachments; it just cannot see one yet.`,
      missingFields: ["Attachment"],
      /* Says why no file was found, so a genuinely missing attachment is
       * never reported as "attachments are not supported". */
      diagnostics: {
        toolSupportsAttachments: true,
        beaconBarHelperPresent: attachmentSources.baoHelperPresent,
        filesFromChat: attachmentSources.baoCount,
        filesFromBase64Argument: attachmentSources.base64Count,
        attachmentArgumentSeen: !!(args.attachment || args.Attachment || args.attachments || args.Attachments),
        readError: attachmentSources.error
      }
    };
  }

  /* -------------------------------------------------
   * Step 9: let the server compute the day breakdown and validate the
   * range - the same call the page makes as soon as both dates and a
   * leave type are set.
   * ------------------------------------------------- */
  function buildLeavePayload() {
    return {
      EmpNumber: empToken,
      LeaveGroup: leaveType.LGCode,
      LeaveYear: leaveYear,
      LeaveType: leaveType.TypeCode,
      FromDateText: fromDateText,
      ToDateText: toDateText,
      IsAllDaysEditable: true,
      BreakdownList: [],
      EarnedLeaveList: [],
      NotificationList: [],
      MedicalIssueDateText: "",
      Attachment: { AttachmentName: "" },
      Attachments: [],
      Date_1_Text: "",
      Date_2_Text: "",
      Date_3_Text: "",
      Date_4_Text: "",
      Date_5_Text: "",
      ApprovalEmpNumber: approverNumber,
      LoginEmpNumber: loginEmpNumber,
      ApplicationPage: 1,
      ExtraMaternityDays: 0
    };
  }

  const calcResult = await safePostJson(`${baseUrl}/AbsenceV9/api/LeaveApplication/CalculateLeaveDays/`, buildLeavePayload());
  const calc = calcResult.body || {};

  if (calc.Status !== true) {
    return {
      error: true,
      message: calc.Message || `Could not calculate leave days for ${employeeLabel}'s ${leaveType.TypeName} on the given dates.`,
      diagnostics: { httpStatus: calcResult.status, fromDateText, toDateText }
    };
  }

  /* Per-day day mode */
  const breakdownList = Array.isArray(calc.BreakdownList) ? calc.BreakdownList : [];

  if (Array.isArray(argDayModes) && argDayModes.length > 0) {
    if (leaveType.AllowHalfDay !== 1 && argDayModes.some(d => Number(d.dayValue) !== 1 && Number(d.dayValue) !== 0)) {
      return {
        error: true,
        message: `${leaveType.TypeName} does not allow half days for ${employeeLabel}. Please apply it as whole days.`
      };
    }
    const unmatched = [];
    argDayModes.forEach(function (wanted) {
      const row = breakdownList.find(x => x.LeaveDate === wanted.date);
      if (!row) {
        unmatched.push(wanted.date);
        return;
      }
      row.DayMode = wanted.dayMode;
      row.DayValue = wanted.dayValue;
    });
    if (unmatched.length > 0) {
      return {
        error: true,
        message: `These dates are not part of ${employeeLabel}'s leave period: ${unmatched.join(", ")}. Day modes must use the dates the tool returns, in ISO form (e.g. 2026-09-11T00:00:00).`,
        leaveDates: breakdownList.map(x => x.LeaveDate)
      };
    }
  }

  // With day modes applied the amount is their sum, exactly as the two
  // working leave tools compute it; untouched, the server's own total stands.
  const hasDayModes = Array.isArray(argDayModes) && argDayModes.length > 0;
  const leaveAmount = hasDayModes
    ? argDayModes.reduce((total, x) => total + Number(x.dayValue || 0), 0)
    : calc.LeaveAmount;
  const leaveAmountToVldt = hasDayModes ? leaveAmount : calc.LeaveAmountToVldt;

  // Clash details are informational, matching the UI's own "Leave
  // Clashes" popover - never block on them.
  const clashResult = await safePostJson(`${baseUrl}/AbsenceV9/api/LeaveApplication/GetLeaveClashDetails/`, buildLeavePayload());
  const clashes = Array.isArray(clashResult.body) ? clashResult.body : [];

  const warnings = [];
  if (calc.Warning) warnings.push(calc.Warning);
  if (leaveType.IsMedicalRequired === 1 && calc.IsMedicalDetailsRequired) {
    warnings.push(`${leaveType.TypeName} may require medical details for this duration - these cannot be attached by this tool.`);
  }

  /* -------------------------------------------------
   * Balance check.
   * ------------------------------------------------- */
  const entitlement = leaveType.Entitlement || null;
  const rawBalance = entitlement
    ? (entitlement.BalanceAmount !== undefined && entitlement.BalanceAmount !== null
        ? entitlement.BalanceAmount
        : entitlement.BalanceDV)
    : null;
  const balanceAmount = (rawBalance === null || rawBalance === undefined || String(rawBalance).trim() === "")
    ? NaN
    : Number(rawBalance);
  const requestedDays = Number(leaveAmount);
  const balanceKnown = Number.isFinite(balanceAmount) && Number.isFinite(requestedDays);
  const exceedsBalance = balanceKnown && requestedDays > balanceAmount;

  if (exceedsBalance) {
    const shortfall = Math.round((requestedDays - balanceAmount) * 100) / 100;
    if (leaveType.AllowNegative === 1) {
      warnings.push(`This is ${requestedDays} day(s) but ${employeeLabel} has only ${balanceAmount} day(s) of ${leaveType.TypeName} left - ${shortfall} day(s) over. ${leaveType.TypeName} allows a negative balance, so it can still be submitted.`);
    } else {
      return {
        error: true,
        message: `${employeeLabel} does not have enough ${leaveType.TypeName} left: this application is ${requestedDays} day(s) but only ${balanceAmount} day(s) remain (${shortfall} day(s) short). Please shorten the dates or choose another leave type.`,
        current: {
          employee: employeeLabel,
          leaveType: leaveType.TypeName,
          requestedDays,
          balance: leaveType.Entitlement ? leaveType.Entitlement.BalanceDV : null,
          entitlement: leaveType.Entitlement ? leaveType.Entitlement.EntitlementDV : null,
          used: leaveType.Entitlement ? leaveType.Entitlement.UtilizedDV : null,
          pendingApproval: leaveType.Entitlement ? leaveType.Entitlement.PendingDV : null
        },
        leaveTypes: leaveTypeList.map(leaveTypeSummary)
      };
    }
  }

  if (leaveType.MaxDaysInSingleInstance > 0 && requestedDays > Number(leaveType.MaxDaysInSingleInstance)) {
    warnings.push(`${leaveType.TypeName} allows at most ${leaveType.MaxDaysInSingleInstance} day(s) in one application; this one is ${requestedDays}.`);
  }

  const previewData = {
    employee: employeeLabel,
    employeeNumber: employeeDisplayNumber,
    designation: employeeDesignation,
    leaveType: leaveType.TypeName,
    leaveYear,
    fromDate: formatCultureDate(parsedFrom),
    toDate: formatCultureDate(parsedTo),
    leaveDays: hasDayModes ? String(leaveAmount) : calc.LeaveAmountText,
    dayBreakdown: breakdownList.map(x => ({ date: x.LeaveDate, dayMode: x.DayMode, dayValue: x.DayValue })),
    balanceBeforeThisApplication: leaveType.Entitlement ? leaveType.Entitlement.BalanceDV : null,
    // Full balance picture, so the preview can show what is being spent.
    leaveBalance: leaveType.Entitlement ? {
      entitlement: leaveType.Entitlement.EntitlementDV,
      used: leaveType.Entitlement.UtilizedDV,
      pendingApproval: leaveType.Entitlement.PendingDV,
      remainingBefore: leaveType.Entitlement.BalanceDV,
      thisApplication: requestedDays,
      remainingAfter: balanceKnown ? Math.round((balanceAmount - requestedDays) * 100) / 100 : null,
      leavePeriod: leaveType.Entitlement.LeavePeriod
    } : null,
    approver: approverDisplayText || approverNumber,
    coveringEmployee: coveringEmployeeNumber,
    reason: reasonCode ? decodeURIComponent(reasonList.find(r => r.ReasonCode === reasonCode).Description || "").replace(/%20/g, " ") : null,
    comment: argComment || null,
    attachments: attachments.map(f => f.name),
    attachmentRequired,
    // Lets the assistant offer the choice before the user confirms.
    canStillAddAttachment: attachmentAllowed && attachments.length === 0,
    leaveClashes: clashes.map(c => ({
      date: c.ClashDate,
      countOnLeave: c.LeaveCount,
      percentageOnLeave: c.LeavePercentage,
      employees: (c.LeaveClashEmployees || []).map(e => e.EmpName)
    })),
    warnings
  };

  /* -------------------------------------------------
   * Step 10: confirm before writing anything.
   * ------------------------------------------------- */
  if (!argConfirmed) {
    return {
      needsConfirmation: true,
      preview: previewData,
      message: warnings.length > 0
        ? `Please review ${employeeLabel}'s leave application below - note the warnings - and confirm before I submit it.`
        : `Please review ${employeeLabel}'s leave application below and confirm before I submit it.`,
      confirmationPrompt: previewData.canStillAddAttachment
        ? `Are you sure you want to submit this ${leaveType.TypeName} application for ${employeeLabel}? An attachment is optional for this leave type - attach one now if you want it included. Reply yes to submit, or no to make further changes.`
        : `Are you sure you want to submit this ${leaveType.TypeName} application for ${employeeLabel}? Reply yes to submit, or no to make further changes.`
    };
  }

  /* -------------------------------------------------
   * Step 11: submit via SaveLeaveApplication.
   * ------------------------------------------------- */
  const attachmentNames = [];
  for (let i = 0; i < attachments.length; i++) {
    const file = attachments[i];
    const formData = new FormData();
    formData.append(file.name, file, file.name);

    let uploadBody = null;
    let uploadStatus = 0;
    try {
      // No content-type here on purpose - FormData sets its own boundary.
      const uploadRes = await fetch(`${baseUrl}/AbsenceV9/api/LeaveApplication/UploadLeaveAttachmentData/`, {
        method: "POST",
        headers: {
          "Accept": "application/json, text/javascript, */*; q=0.01",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: formData,
        credentials: "include",
        redirect: "follow"
      });
      uploadStatus = uploadRes.status;
      uploadBody = await uploadRes.json().catch(function () { return null; });
    } catch (e) {
      uploadBody = null;
    }

    if (!uploadBody || uploadBody.Status !== true) {
      return {
        error: true,
        message: (uploadBody && uploadBody.Message)
          || `Could not upload "${file.name}" for ${employeeLabel}'s ${leaveType.TypeName}. Nothing has been submitted - please try attaching the file again.`,
        preview: previewData,
        apiResponse: uploadBody,
        diagnostics: { uploadHttpStatus: uploadStatus, fileName: file.name, fileCount: attachments.length }
      };
    }
    attachmentNames.push({ AttachmentName: file.name });
  }

  const hasAttachment = attachmentNames.length > 0;

  const saveResult = await safePostJson(`${baseUrl}/AbsenceV9/api/LeaveApplication/SaveLeaveApplication/`, {
    EmpNumber: empToken,
    ApprovalEmpNumber: approverNumber,
    LeaveGroup: leaveType.LGCode,
    LeaveYear: leaveYear,
    LeaveType: leaveType.TypeCode,
    FromDateText: fromDateText,
    ToDateText: toDateText,
    Comment: (argComment || "").trim(),
    IsAllDaysEditable: true,
    LeaveAmount: leaveAmount,
    LeaveAmountToVldt: leaveAmountToVldt,
    BreakdownList: breakdownList,
    EarnedLeaveList: [],
    NotificationList: [],
    IsMedicalLeave: false,
    MedicalIssueDateText: "",
    Attachment: hasAttachment ? { AttachmentName: attachmentNames[0].AttachmentName } : { AttachmentName: "-1" },
    Attachments: null,
    // Empty unless the leave type switched on a Date_n additional field.
    Date_1_Text: extraFieldValues.Date_1_Text || "",
    Date_2_Text: extraFieldValues.Date_2_Text || "",
    Date_3_Text: extraFieldValues.Date_3_Text || "",
    Date_4_Text: extraFieldValues.Date_4_Text || "",
    Date_5_Text: extraFieldValues.Date_5_Text || "",
    CoveringEmpNumber: coveringEmployeeNumber || "",
    // selfEmployeeLeaveApplication sends the resolved ReasonCode here; the
    // reason dropdown is otherwise silently dropped from the application.
    LeaveReason: reasonCode || "",
    LoginEmpNumber: loginEmpNumber,
    ApplicationPage: 1,
    ExtraMaternityDays: 0
  });
  const saveData = saveResult.body || {};

  if (saveData.Status !== true) {
    return {
      error: true,
      message: saveData.Message || `Failed to submit ${leaveType.TypeName} for ${employeeLabel}. Please verify in the UI.`,
      preview: previewData,
      apiResponse: saveData,
      diagnostics: { httpStatus: saveResult.status }
    };
  }

  return {
    success: true,
    message: `${leaveType.TypeName} for ${employeeLabel} (${formatCultureDate(parsedFrom)} - ${formatCultureDate(parsedTo)}) has been submitted for approval.`,
    submitted: previewData,
    apiResponse: saveData
  };
});
