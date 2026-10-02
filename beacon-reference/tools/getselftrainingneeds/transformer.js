(async function (data, args, reqOptions) {
  try {
    // Defensive: guard every step so a missing/malformed BeaconBar context resolves to
    // a clean NO_ACCESS response instead of an opaque synchronous exception (same
    // pattern as every other drafts/* tool in this build).
    const menus = (typeof BeaconBar !== "undefined" && BeaconBar.user && BeaconBar.user.metaData && BeaconBar.user.metaData.menus) || [];
    const hasAccess = Array.isArray(menus) && menus.some((menu) => typeof menu === "string" && menu.includes("TNDV9/TrainingNeed/Index?mvc=1&bs=4&App=000001"));
    if (!hasAccess) {
      return {
        status: "NO_ACCESS",
        message: "It seems you don't have access. Please check with the HR Admin"
      };
    }

    // UAC 3.1 ("Display Existing Training Needs") is one requirement covering three
    // distinct real menu entries/views - Applicant (App=000001), Supervisor (App=000002),
    // Admin (App=000007). Confirmed live: the same two endpoints (LoadPageData,
    // GetTrainingNeedDetails) are called for all three, differing only in the
    // "requestType" field sent in the request body - but WHO can see WHAT differs
    // completely (an Admin sees company-wide entries no self-employee call ever returns),
    // so this had to be three separate tools, one per fixed requestType, rather than one
    // tool with a persona argument - an Applicant should never be asked "are you an
    // Admin?" to get their own view. This is the Applicant/self variant: requestType
    // "000001".
    const REQUEST_TYPE = "000001";

    const keyword = args.keyword ? String(args.keyword).trim().toLowerCase() : "";

    // Word-based matching, not literal substring matching - same reasoning as
    // getTrainingForNeed: a raw request's own wording rarely matches a category name
    // (or vice versa) as a literal substring, but does share the same underlying words.
    //
    // Fixed (2026-09-12): each query word now matches if it's a SUBSTRING of any
    // haystack word, not only an exact whole-word match. Reported live failure:
    // searching "backend dev" against the category "Backend Development" returned
    // nothing, because "dev" !== "development" as an exact token even though
    // "development" plainly contains "dev" - the whole point of a partial-match
    // search. `containsAllWords` below is the fix; `tokenize` is unchanged.
    function tokenize(text) {
      return (text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
    }
    function containsAllWords(haystackText, words) {
      if (words.length === 0) return false;
      const haystackWords = tokenize(haystackText);
      return words.every((w) => haystackWords.some((hw) => hw.includes(w)));
    }
    const keywordWords = tokenize(keyword);

    const headers = new Headers();
    headers.append("Accept", "*/*");
    headers.append("Content-Type", "application/json");
    headers.append("x-requested-with", "XMLHttpRequest");

    async function postJson(path, body) {
      const url = `${window.origin}/${reqOptions.sl}/${path}`;
      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: headers,
          body: body !== undefined ? JSON.stringify(body) : undefined
        });
      } catch (networkError) {
        throw new Error(`Could not reach ${path}: ${networkError.message}`);
      }
      const rawText = await response.text();
      let parsed = null;
      try {
        parsed = rawText ? JSON.parse(rawText) : null;
      } catch (parseError) {
        throw new Error(`${path} returned a non-JSON response (HTTP ${response.status}).`);
      }
      if (!response.ok) {
        const detail = (parsed && (parsed.Message || (parsed.Status && parsed.Status.Message))) || rawText.slice(0, 200);
        throw new Error(`${path} failed with HTTP ${response.status}: ${detail}`);
      }
      return parsed;
    }

    function parseAspNetDateParts(dateStr) {
      if (!dateStr) return null;
      const match = /\/Date\((-?\d+)([+-]\d{4})?\)\//.exec(dateStr);
      if (!match) return null;
      const ms = parseInt(match[1], 10);
      let offsetMinutes = 0;
      if (match[2]) {
        const sign = match[2][0] === "-" ? -1 : 1;
        const hours = parseInt(match[2].slice(1, 3), 10);
        const minutes = parseInt(match[2].slice(3, 5), 10);
        offsetMinutes = sign * (hours * 60 + minutes);
      }
      return { ms, offsetMinutes };
    }
    function toIsoAndDisplay(dateStr) {
      const parts = parseAspNetDateParts(dateStr);
      if (!parts) return { iso: dateStr, display: null };
      const local = new Date(parts.ms + parts.offsetMinutes * 60000);
      const pad = (n) => String(n).padStart(2, "0");
      const display = `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}/${local.getUTCFullYear()}`;
      return { iso: new Date(parts.ms).toISOString(), display };
    }

    // Step 1: fetch the master list of already-converted need categories
    // (MainNeed: [{needcode, needname}]) - confirmed live to be identical regardless of
    // requestType (the same six categories came back for Applicant/Supervisor/Admin
    // captures alike), i.e. it's a shared company-wide reference list, not scoped per
    // persona. This is the direct answer to "what existing training needs are available"
    // when someone is about to log a new one and wants to check if a matching category
    // already exists.
    const detailsData = await postJson("TNDV9/TrainingNeed/GetTrainingNeedDetails", { requestType: REQUEST_TYPE, WFMainID: "", PerfEmpNo: "" });
    if (!detailsData || !detailsData.Status || detailsData.Status.IsSuccessfull !== true) {
      return {
        status: "ERROR",
        message: (detailsData && detailsData.Status && detailsData.Status.Message) || "Failed to retrieve training needs"
      };
    }
    let existingNeedCategories = (Array.isArray(detailsData.MainNeed) ? detailsData.MainNeed : []).map((n) => ({
      needCode: n.needcode || "",
      needName: n.needname || ""
    }));

    // Step 2: fetch every individual need entry (raw submissions and already-"Existing"
    // category records alike) visible in this persona's scope, paginating through every
    // page LoadPageData reports. Confirmed live: this is a small, low-volume list (single
    // or low-double-digit TotalPages in every capture seen), so a generous but bounded
    // page cap is a safety net, not an expected real limit.
    let allRecords = [];
    let pageNo = 1;
    let totalPages = 1;
    const MAX_PAGES = 20;
    do {
      const pageData = await postJson("TNDV9/TrainingNeed/LoadPageData", {
        PageNo: pageNo,
        SearchText: "",
        SortColumn: "TNA_DATE",
        Order: 1,
        requestType: REQUEST_TYPE,
        WFMainID: "",
        PerfEmpNo: ""
      });
      if (!pageData) break;
      if (Array.isArray(pageData.DataList)) {
        allRecords = allRecords.concat(pageData.DataList);
      }
      totalPages = typeof pageData.TotalPages === "number" ? pageData.TotalPages : 1;
      pageNo += 1;
    } while (pageNo <= totalPages && pageNo <= MAX_PAGES);

    let trainingNeeds = allRecords.map((r) => {
      const appdateConv = toIsoAndDisplay(r.appdate);
      return {
        needCode: r.needcode || "",
        needName: r.needname || "",
        needDescription: r.needdescription || null,
        recordType: r.needtype || null, // "Raw Need" (an individual submitted request) or "Existing" (an already-converted category)
        status: r.status || null,
        objective: r.objective || null,
        relevanceToJob: r.reltojob || null,
        benefitToEmployee: r.potentialyou || null,
        benefitToCompany: r.potentialcomp || null,
        applicationDate: appdateConv.display,
        requestCategory: r.reqtypename || null // "Individual" or "Admin"
      };
    });

    // Step 3: apply the optional keyword filter, word-based partial match (see above for
    // why literal whole-word matching misses partial phrasing like "backend dev").
    if (keywordWords.length > 0) {
      existingNeedCategories = existingNeedCategories.filter((c) => containsAllWords(c.needName, keywordWords));
      trainingNeeds = trainingNeeds.filter((n) =>
        containsAllWords(`${n.needName} ${n.needDescription || ""} ${n.objective || ""}`, keywordWords)
      );
    }

    if (existingNeedCategories.length === 0 && trainingNeeds.length === 0) {
      return {
        status: "SUCCESS",
        message: keyword
          ? `No existing training need matching "${args.keyword}" was found.`
          : "No training needs are currently on file for you.",
        existingNeedCategories: [],
        trainingNeeds: []
      };
    }

    return {
      status: "SUCCESS",
      message: `Found ${existingNeedCategories.length} existing need categor${existingNeedCategories.length === 1 ? "y" : "ies"} and ${trainingNeeds.length} training need record${trainingNeeds.length === 1 ? "" : "s"}.`,
      existingNeedCategories: existingNeedCategories,
      trainingNeeds: trainingNeeds
    };

  } catch (error) {
    const errorMessage = error && error.message ? error.message : String(error);
    return {
      status: "ERROR",
      message: `Failed to retrieve training needs: ${errorMessage}`,
      error: errorMessage
    };
  }
})
