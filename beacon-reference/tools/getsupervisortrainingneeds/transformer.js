(async function (data, args, reqOptions) {
  try {
    const menus = (typeof BeaconBar !== "undefined" && BeaconBar.user && BeaconBar.user.metaData && BeaconBar.user.metaData.menus) || [];
    const hasAccess = Array.isArray(menus) && menus.some((menu) => typeof menu === "string" && menu.includes("TNDV9/TrainingNeed/Index?mvc=1&bs=4&App=000002"));
    if (!hasAccess) {
      return {
        status: "NO_ACCESS",
        message: "It seems you don't have access. Please check with the HR Admin"
      };
    }

    const REQUEST_TYPE = "000002";

    const keyword = args.keyword ? String(args.keyword).trim().toLowerCase() : "";

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
          ? `No existing training need matching "${args.keyword}" was found for your team.`
          : "No training needs are currently on file for your team.",
        existingNeedCategories: [],
        trainingNeeds: []
      };
    }

    return {
      status: "SUCCESS",
      message: `Found ${existingNeedCategories.length} existing need categor${existingNeedCategories.length === 1 ? "y" : "ies"} and ${trainingNeeds.length} training need record${trainingNeeds.length === 1 ? "" : "s"} for your team.`,
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
