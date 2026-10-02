(async function (data, args, reqOptions) {
  try {
    // Menu-access gate, following the same pattern as drafts/gettrainingcalendarcoursedetails.
    // Confirmed via a saved shell-page capture (New_PeoplesHR_Feature/getSelfEmployeeTrainingHistory/PeoplesHR.html)
    // listing this screen's menu entries for the three personas: Applicant (App=000001),
    // Supervisor (App=000002), Admin (App=000007).
    const menus = (typeof BeaconBar !== "undefined" && BeaconBar.user && BeaconBar.user.metaData && BeaconBar.user.metaData.menus) || [];
    const trainingProfileMenus = [
      "TNDV9/TrainingProfile/Index?mvc=1&bs=4&App=000001",
      "TNDV9/TrainingProfile/Index?mvc=1&bs=4&App=000002",
      "TNDV9/TrainingProfile/Index?mvc=1&bs=4&App=000007"
    ];
    const hasAccess = Array.isArray(menus) && menus.some((menu) => typeof menu === "string" && trainingProfileMenus.some((m) => menu.includes(m)));
    if (!hasAccess) {
      return {
        status: "NO_ACCESS",
        message: "It seems you don't have access. Please check with the HR Admin"
      };
    }

    // Self only - never ask the user for their employee number, resolve from session
    // metadata the same way tools/getadmininformationdetails does.
    const empNo = (typeof BeaconBar !== "undefined" && BeaconBar.user && BeaconBar.user.metaData && BeaconBar.user.metaData.empNo) || "";
    const empDisplayNo = (typeof BeaconBar !== "undefined" && BeaconBar.user && BeaconBar.user.metaData && BeaconBar.user.metaData.empDisplayNo) || "";
    if (!empNo) {
      return {
        status: "ERROR",
        message: "Could not resolve the logged-in employee from BeaconBar.user.metaData."
      };
    }

    const updateUrlData = await BeaconBar.executeFunction("updateUrlParams")("TNDV9/TrainingProfile/Index");
    const pageUrl = updateUrlData.updateUrl || "TNDV9/TrainingProfile/Index";

    let pageHtml;
    try {
      const pageResponse = await fetch(`${window.origin}/${reqOptions.sl}/${pageUrl}`, {
        method: "GET",
        headers: { "x-requested-with": "XMLHttpRequest" },
        redirect: "follow"
      });
      pageHtml = await pageResponse.text();
    } catch (networkError) {
      return {
        status: "ERROR",
        message: `Could not reach the Training Profile page (${pageUrl}): ${networkError.message}`
      };
    }

    const doc = new DOMParser().parseFromString(pageHtml, "text/html");
    const empId = doc.querySelector('#EmpNumber')?.value || doc.querySelector('#EmpNumberSearch')?.value || "";

    if (!empId) {
      return {
        status: "ERROR",
        message: "Could not locate the employee identity token (#EmpNumber) on the Training Profile page - the page markup may have changed since this was last confirmed.",
        diagnostics: {
          pageUrl: pageUrl,
          pageHtmlLength: pageHtml.length,
          pageHtmlPreview: pageHtml.slice(0, 4000)
        }
      };
    }

    async function postJson(path, body) {
      const url = `${window.origin}/${reqOptions.sl}/${path}`;
      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Content-Type": "application/json; charset=UTF-8",
            "x-requested-with": "XMLHttpRequest"
          },
          body: JSON.stringify(body)
        });
      } catch (networkError) {
        throw new Error(`Could not reach ${url}: ${networkError.message}`);
      }
      const rawText = await response.text();
      let parsed = null;
      try {
        parsed = rawText ? JSON.parse(rawText) : null;
      } catch (parseError) {
        throw new Error(`${path} returned a non-JSON response (HTTP ${response.status}).`);
      }
      if (!response.ok) {
        throw new Error((parsed && parsed.Status && parsed.Status.Message) || `${path} failed with status ${response.status}`);
      }
      return parsed || {};
    }

    const parseAspNetDate = (dateStr) => {
      if (!dateStr) return "";
      const match = /\/Date\((-?\d+)([+-]\d{4})?\)\//.exec(dateStr);
      if (!match) return "";
      const ms = parseInt(match[1], 10);
      let offsetMinutes = 0;
      if (match[2]) {
        const sign = match[2][0] === "-" ? -1 : 1;
        const hours = parseInt(match[2].slice(1, 3), 10);
        const minutes = parseInt(match[2].slice(3, 5), 10);
        offsetMinutes = sign * (hours * 60 + minutes);
      }
      const local = new Date(ms + offsetMinutes * 60000);
      const pad = (n) => String(n).padStart(2, "0");
      return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
    };

    let pastCourseData;
    try {
      pastCourseData = await postJson("TNDV9/TrainingEnrollment/GetPastCourseDetails", { id: empId });
    } catch (err) {
      return { status: "ERROR", message: err.message };
    }

    const attended = (pastCourseData.PastList || []).map((item) => ({
      scheduleId: item.schid || "",
      courseCode: item.coscode || "",
      courseName: item.cosname || "",
      startDate: parseAspNetDate(item.stratdate),
      endDate: parseAspNetDate(item.enddate),
      totalHours: item.tothrs || 0,
      cost: item.coscost || 0,
      effectivenessPercent: item.effective || 0,
      cpd: item.cpd || null
    }));

    // --- Applied / nominated / registered / direct-enrolled / upcoming (UAC 5.2-5.4) -
    // all confirmed live via TNDV9/TrainingProfile/TrainingProgramDetails, called
    // repeatedly with different `apptype` values that each populate a different
    // top-level field on the same shared response envelope. Confirmed codes:
    //   "RT" -> registered[]   (Registered Trainings - has a confirmed schedule)
    //   "T"  -> applied[]      (Applied Trainings - the actual UAC 5.2 "applied" list)
    //   "D"  -> directenroll[] (Direct Enrolled Trainings - enrolled without applying)
    //   "N"  -> needs[]        (Training Needs - see below)
    //
    // FIX (2026-09-15): "nominated" (UAC 5.3) was previously left as a hard-coded []
    // with a TODO, since every earlier capture's top-level "nominate" field had been
    // empty under all four confirmed apptype codes above - it looked like a dead field
    // needing its own not-yet-found apptype code. A fresh capture (Dev in progress
    // Features/T&D Feature/getSelfEmployeeTrainingHistory/TrainingProgramDetails-2)
    // proved otherwise: calling with apptype "T" - the SAME call already made for
    // applied[] - returns a real, non-empty "nominate" array (2 items, exactly matching
    // the real screen's "Nominated Trainings 2" tab count). It is not a separate
    // category needing its own apptype; it's a sibling field on the "T" response,
    // identical item shape to applied/registered (confirmed by inspecting a real
    // "nominate" entry - same schid/coscode/cosname/WFList/RBTList shape mapProgramItem
    // already handles), so no new network call or mapper is needed - just read the field
    // that was already sitting unread on a response already being fetched.
    const todayKey = parseAspNetDate(`/Date(${Date.now()})/`);

    function mapProgramItem(item) {
      const lastWfDetail = (item.WFList || [])
        .map((wf) => (wf.WFDetail || [])[0])
        .filter(Boolean)
        .pop();
      const roleBasedTraining =
        item.RBTList && item.RBTList.length > 0
          ? item.RBTList.map((rbt) => ({
              id: rbt.rbtid || "",
              name: rbt.rbtname || "",
              categoryCode: rbt.rbtcategorycode || ""
            }))
          : null;
      return {
        scheduleId: item.schid || "",
        applicationId: item.appid || "",
        courseCode: item.coscode || "",
        courseName: item.cosname || "",
        startDate: parseAspNetDate(item.stratdate),
        endDate: parseAspNetDate(item.enddate),
        totalHours: item.tothrs || 0,
        cost: item.coscost || 0,
        enrollmentStatus: item.enroll || "",
        participationConfirmationStatus: item.confirm || "",
        evaluationStatus: item.evalstat || null,
        completionStatus: item.complete || null,
        lastWorkflowStep: lastWfDetail ? lastWfDetail.appdesc : "",
        lastWorkflowStatus: lastWfDetail ? lastWfDetail.wfapproval : "",
        needName: item.needname || null,
        roleBasedTraining: roleBasedTraining
      };
    }

    async function fetchProgramData(apptype) {
      return postJson("TNDV9/TrainingProfile/TrainingProgramDetails", { id: empId, apptype: apptype });
    }

    let registered, applied, nominated, directEnrolled;
    try {
      const rtData = await fetchProgramData("RT");
      registered = (rtData.registered || []).map(mapProgramItem);
      const tData = await fetchProgramData("T");
      applied = (tData.applied || []).map(mapProgramItem);
      nominated = (tData.nominate || []).map(mapProgramItem);
      const dData = await fetchProgramData("D");
      directEnrolled = (dData.directenroll || []).map(mapProgramItem);
    } catch (err) {
      return { status: "ERROR", message: err.message };
    }

    const upcomingMap = new Map();
    [...registered, ...applied, ...nominated, ...directEnrolled].forEach((item) => {
      if (item.startDate && item.startDate >= todayKey && !upcomingMap.has(item.scheduleId)) {
        upcomingMap.set(item.scheduleId, item);
      }
    });
    const upcoming = Array.from(upcomingMap.values());

    let needsData;
    try {
      needsData = await postJson("TNDV9/TrainingProfile/TrainingProgramDetails", { id: empId, apptype: "N" });
    } catch (err) {
      return { status: "ERROR", message: err.message };
    }

    const trainingNeeds = (needsData.needs || []).map((item) => ({
      needId: item.needid || "",
      needType: item.needtype || "",
      needDescription: item.needdesc || "",
      needName: item.needname || "",
      approvalStatus: item.approve || "",
      enrollmentStatus: item.enroll || "",
      relatedSchedule: item.schid
        ? { scheduleId: item.schid, courseCode: item.coscode || "", courseName: item.cosname || "" }
        : null,
      jobRelevance: item.jobrel || "",
      benefitToEmployee: item.potenyou || "",
      benefitToCompany: item.potencomp || "",
      objective: item.objective || "",
      requestedBy: item.request || "",
      applyDate: parseAspNetDate(item.applydate)
    }));

    let externalTrainingRecords = [];
    try {
      const recordsData = await postJson("TNDV9/TrainingProfile/GetTrainingRecords", { id: empId });
      externalTrainingRecords = (recordsData.trnrecds || []).map((item) => ({
        id: item.dirid || "",
        courseName: item.cosname || "",
        location: item.location || "",
        durationDays: item.duration || 0,
        startDate: parseAspNetDate(item.fromdate),
        endDate: parseAspNetDate(item.todate),
        cost: item.cosamount || 0,
        currencyCode: item.currid || "",
        approvalStatus: item.approved || "",
        submissionStatus: item.submit || "",
        comments: item.comments || "",
        attachments: (item.AttchList || []).map((a) => ({
          name: a.attchname || "",
          type: a.attchtype || ""
        }))
      }));
    } catch (err) {
      externalTrainingRecords = [];
    }

    let roleBasedOrganizational = [];
    let roleBasedCore = [];
    try {
      const rbtData = await postJson("TNDV9/TrainingProfile/TrainingRoleBasedDetails", { id: empId });
      roleBasedOrganizational = (rbtData.RoleBasedOrg || []).map(mapProgramItem);
      roleBasedCore = (rbtData.RoleBasedCore || []).map(mapProgramItem);
    } catch (err) {
      roleBasedOrganizational = [];
      roleBasedCore = [];
    }

    let overview = null;
    try {
      const employeeDetailsData = await postJson("TNDV9/TrainingProfile/GetEmployeeDetails", { id: empId });
      const ov = employeeDetailsData.overview || {};
      overview = {
        employeeNumber: ov.displayempno || empDisplayNo || "",
        employeeName: (ov.empname || "").trim() || null,
        designation: ov.designame || null,
        joinDate: parseAspNetDate(ov.joindate) || null,
        joinYear: ov.joinyear || null,
        pendingApplicationCount: ov.stat_pen || 0,
        courseCompletionRate: ov.cos_comprate || 0,
        registeredCourseCount: ov.reg_course || null,
        completedCourseCount: ov.comp_course || null,
        applyRate: ov.apply_rate || 0,
        overallStatusCount: ov.stat_over || 0
      };
    } catch (err) {
      overview = null;
    }

    let summary = null;
    try {
      const widgetData = await postJson("TNDV9/ProfileWidgets/LoadRegisteredTraining", { id: empId });
      summary = {
        thisYearPeriod: widgetData.thisYrPeriod || "",
        thisYearCount: widgetData.thisYrCount || 0,
        thisYearHours: widgetData.thisYrHours || "0",
        thisYearCost: widgetData.thisYrCost || "0",
        lastYearPeriod: widgetData.lastYrPeriod || "",
        lastYearCount: widgetData.lastYrCount || 0,
        lastYearHours: widgetData.lastYrHours || "0",
        lastYearCost: widgetData.lastYrCost || "0"
      };
    } catch (err) {
      summary = null;
    }

    const isEmpty =
      attended.length === 0 &&
      applied.length === 0 &&
      registered.length === 0 &&
      directEnrolled.length === 0 &&
      nominated.length === 0 &&
      upcoming.length === 0 &&
      trainingNeeds.length === 0 &&
      externalTrainingRecords.length === 0 &&
      roleBasedOrganizational.length === 0 &&
      roleBasedCore.length === 0;

    return {
      status: "SUCCESS",
      message: isEmpty
        ? "No relevant training information was found."
        : `Found training history for employee ${empDisplayNo || empNo}.`,
      overview: overview,
      attended: attended,
      applied: applied,
      registered: registered,
      directEnrolled: directEnrolled,
      externalTrainingRecords: externalTrainingRecords,
      nominated: nominated,
      upcoming: upcoming,
      trainingNeeds: trainingNeeds,
      roleBasedOrganizational: roleBasedOrganizational,
      roleBasedCore: roleBasedCore,
      summary: summary
    };

  } catch (error) {
    const errorMessage = error && error.message ? error.message : String(error);
    return {
      status: "ERROR",
      message: `Failed to retrieve training history: ${errorMessage}`,
      error: errorMessage
    };
  }
})
