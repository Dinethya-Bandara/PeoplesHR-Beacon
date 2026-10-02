(async function (data, args, reqOptions) {
  try {
    const menus = (typeof BeaconBar !== "undefined" && BeaconBar.user && BeaconBar.user.metaData && BeaconBar.user.metaData.menus) || [];
    const hasAccess = Array.isArray(menus) && menus.some((menu) => typeof menu === "string" && menu.includes("TNDV9/ApplyTraining/Index?mvc=1&bs=4&App=000001"));
    if (!hasAccess) {
      return {
        status: "NO_ACCESS",
        message: "It seems you don't have access. Please check with the HR Admin"
      };
    }

    const scheduleId = args.scheduleId !== undefined && args.scheduleId !== null ? String(args.scheduleId).trim() : "";
    const courseNameQuery = args.courseName ? String(args.courseName).trim() : "";
    const objective = args.objective ? String(args.objective).trim() : "";
    const relevanceToJob = args.relevanceToJob ? String(args.relevanceToJob).trim() : "";
    const benefitToEmployee = args.benefitToEmployee ? String(args.benefitToEmployee).trim() : "";
    const benefitToCompany = args.benefitToCompany ? String(args.benefitToCompany).trim() : "";
    const expectedLearning = args.expectedLearning ? String(args.expectedLearning).trim() : "";

    if (!scheduleId && !courseNameQuery) {
      return { status: "VALIDATION_ERROR", message: "Either scheduleId or courseName is required to identify which training schedule to apply for." };
    }

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

    const scheduleData = await postJson("TNDV9/ApplyTraining/GetScheduleCourseDetails", undefined);
    if (!scheduleData || !scheduleData.Status || scheduleData.Status.IsSuccessfull !== true || !Array.isArray(scheduleData.crs)) {
      return {
        status: "ERROR",
        message: (scheduleData && scheduleData.Status && scheduleData.Status.Message) || "Failed to load available training schedules"
      };
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

    let courseItem = null;
    if (scheduleId) {
      courseItem = scheduleData.crs.find((item) => String(item.schid) === scheduleId) || null;
      if (!courseItem) {
        return {
          status: "ERROR",
          message: `No open training schedule was found for scheduleId ${scheduleId}. Use getSelfEmployeeTrainings or getTrainingCalendarCourseDetails to find a valid schedule id.`
        };
      }
    } else {
      const needle = courseNameQuery.toLowerCase();
      const courseMatches = scheduleData.crs.filter((item) => (item.cosname || "").toLowerCase().includes(needle));
      if (courseMatches.length === 0) {
        return {
          status: "ERROR",
          message: `No open training schedule was found matching courseName "${courseNameQuery}".`
        };
      }
      if (courseMatches.length > 1) {
        return {
          status: "AMBIGUOUS",
          message: `More than one open schedule matches courseName "${courseNameQuery}". Please specify using scheduleId.`,
          candidates: courseMatches.map((item) => ({
            scheduleId: String(item.schid),
            courseName: item.cosname || "",
            startDate: toIsoAndDisplay(item.startdate).display,
            venue: (item.SchList && item.SchList[0] && item.SchList[0].VenueName) || ""
          }))
        };
      }
      courseItem = courseMatches[0];
    }

    const startdateConv = toIsoAndDisplay(courseItem.startdate);
    const enddateConv = toIsoAndDisplay(courseItem.enddate);
    const cutdateConv = toIsoAndDisplay(courseItem.cutdate);
    const pardateConv = toIsoAndDisplay(courseItem.pardate);

    const conditionsPayload = {
      coscode: courseItem.coscode,
      cosname: courseItem.cosname,
      cosdesc: courseItem.cosdesc,
      startdate: startdateConv.iso,
      Strstartdate: startdateConv.display,
      enddate: enddateConv.iso,
      Strenddate: enddateConv.display,
      cutdate: cutdateConv.iso,
      Strcutdate: cutdateConv.display,
      pardate: pardateConv.iso,
      Strpardate: pardateConv.display,
      schmonth: courseItem.schmonth,
      ApplyMode: courseItem.ApplyMode,
      schid: courseItem.schid,
      nomination: courseItem.nomination,
      TrainType: courseItem.TrainType,
      Field: courseItem.Field,
      Ojective: "",
      JobRelavance: "",
      PotentialYou: "",
      PotentialCompany: "",
      ExpectedLearning: "",
      SchList: courseItem.SchList,
      NeedList: courseItem.NeedList,
      SponList: courseItem.SponList,
      SubList: courseItem.SubList,
      QuaList: courseItem.QuaList,
      CloseList: courseItem.CloseList,
      Attach: courseItem.Attach,
      AttachName: courseItem.AttachName,
      Capacity: courseItem.Capacity,
      Enrolled: courseItem.Enrolled,
      Applied: courseItem.Applied,
      Availability: Math.max((courseItem.Capacity || 0) - (courseItem.Enrolled || 0), 0),
      Waiting: courseItem.Waiting,
      WfmainID: courseItem.WfmainID,
      ApproveComment: courseItem.ApproveComment,
      Approved: courseItem.Approved,
      NomiList: courseItem.NomiList,
      AppType: null,
      elgcode: courseItem.elgcode
    };

    const conditionsData = await postJson("TNDV9/ApplyTraining/GetAppyCourseConditions", conditionsPayload);
    if (!conditionsData || !conditionsData.Status || conditionsData.Status.IsSuccessfull !== true) {
      return {
        status: "ERROR",
        message: (conditionsData && conditionsData.Status && conditionsData.Status.Message) || "Failed to load your eligibility for this training"
      };
    }

    const selfRecord = (Array.isArray(conditionsData.SubList) && conditionsData.SubList[0]) || null;
    if (selfRecord && selfRecord.appstatus === 1) {
      return {
        status: "NOT_ELIGIBLE",
        message: selfRecord.status || "You are not eligible to apply for this training.",
        courseName: courseItem.cosname,
        scheduleId: String(courseItem.schid)
      };
    }

    const leaveClashes = (Array.isArray(conditionsData.levlist) ? conditionsData.levlist : []).map((lv) => ({
      leaveDate: toIsoAndDisplay(lv.LevDate).display,
      leaveType: lv.LevType || ""
    }));

    const courseMaterials = (Array.isArray(conditionsData.PreMaterial) ? conditionsData.PreMaterial : []).map((m) => ({
      fileName: m.FileName || "",
      fileType: m.attachtype || ""
    }));

    const tempSnapshot = {
      SchList: courseItem.SchList,
      NeedList: courseItem.NeedList,
      SponList: courseItem.SponList,
      SubList: courseItem.SubList,
      QuaList: courseItem.QuaList,
      CloseList: courseItem.CloseList,
      NomiList: courseItem.NomiList,
      AppType: null,
      empno: null,
      coscode: courseItem.coscode,
      cosname: courseItem.cosname,
      cosdesc: courseItem.cosdesc,
      ApplyMode: courseItem.ApplyMode,
      startdate: courseItem.startdate,
      Strstartdate: startdateConv.display,
      enddate: courseItem.enddate,
      Strenddate: enddateConv.display,
      schmonth: courseItem.schmonth,
      schid: courseItem.schid,
      nomination: courseItem.nomination,
      cutdate: courseItem.cutdate,
      Strcutdate: cutdateConv.display,
      pardate: courseItem.pardate,
      Strpardate: pardateConv.display,
      TrainType: courseItem.TrainType,
      Field: courseItem.Field,
      DirAppId: courseItem.DirAppId,
      ReqType: courseItem.ReqType,
      DirAppStat: courseItem.DirAppStat,
      Ojective: "",
      WfmainID: courseItem.WfmainID,
      Approved: courseItem.Approved,
      Attach: courseItem.Attach,
      AttachName: courseItem.AttachName,
      JobRelavance: "",
      PotentialYou: "",
      PotentialCompany: "",
      ExpectedLearning: "",
      Capacity: courseItem.Capacity,
      Enrolled: courseItem.Enrolled,
      Waiting: courseItem.Waiting,
      Applied: courseItem.Applied,
      ApproveComment: courseItem.ApproveComment,
      CosDuration: courseItem.CosDuration,
      elgcode: courseItem.elgcode
    };

    const submissionPayload = Object.assign({}, conditionsPayload, {
      NomiList: [],
      Ojective: objective,
      JobRelavance: relevanceToJob,
      PotentialYou: benefitToEmployee,
      PotentialCompany: benefitToCompany,
      ExpectedLearning: expectedLearning,
      AppType: "000001",
      Temp: tempSnapshot
    });

    const validation = await postJson("TNDV9/ApplyTraining/ValidateApplyTraining", submissionPayload);
    if (!validation || validation.IsSuccessfull !== true) {
      const validationMessage = (validation && validation.Message) || "The training system rejected this application during validation.";
      const fieldRequiredMessages = [
        { field: "objective", value: objective, phrase: "specify the objective" },
        { field: "relevanceToJob", value: relevanceToJob, phrase: "specify the relevance to job" },
        { field: "benefitToEmployee", value: benefitToEmployee, phrase: "specify the benefit to you" },
        { field: "benefitToCompany", value: benefitToCompany, phrase: "specify the benefit to the company" }
      ];
      const isFieldRequiredRejection = fieldRequiredMessages.some((f) => validationMessage.toLowerCase().includes(f.phrase));
      if (isFieldRequiredRejection) {
        const stillMissing = fieldRequiredMessages.filter((f) => !f.value).map((f) => f.field);
        return {
          status: "VALIDATION_ERROR",
          message: stillMissing.length > 0
            ? `You're eligible for this training. Please provide the following before submitting: ${stillMissing.join(", ")}.`
            : validationMessage,
          courseName: courseItem.cosname,
          scheduleId: String(courseItem.schid),
          missingFields: stillMissing.length > 0 ? stillMissing : undefined
        };
      }
      // Not a missing-field complaint - a genuine ineligibility (already applied, cut-off
      // passed, etc.), surfaced without ever having required the narrative fields.
      return {
        status: "NOT_ELIGIBLE",
        message: validationMessage,
        courseName: courseItem.cosname,
        scheduleId: String(courseItem.schid)
      };
    }

    // Step 5: save - the actual write. Only reached after Validate above succeeded with
    // this exact payload, so a second validate call right before saving would be
    // redundant.
    const saveResult = await postJson("TNDV9/ApplyTraining/SaveApplyTraining", submissionPayload);
    if (!saveResult || saveResult.IsSuccessfull !== true) {
      return {
        status: "ERROR",
        message: (saveResult && saveResult.Message) || "Failed to submit the application."
      };
    }

    // Confirmed live: Results[] has exactly one entry for self-application, keyed by the
    // employee's own displayempno - same {success, empno, status} shape as the
    // Supervisor/Admin flows.
    const ownResult = (Array.isArray(saveResult.Results) && saveResult.Results[0]) || null;

    return {
      status: "SUCCESS",
      message: saveResult.Message || "The application has been successfully submitted.",
      courseCode: courseItem.coscode,
      courseName: courseItem.cosname,
      scheduleId: String(courseItem.schid),
      submissionStatus: ownResult ? ownResult.status : null,
      leaveClashes: leaveClashes.length > 0 ? leaveClashes : undefined,
      courseMaterials: courseMaterials.length > 0 ? courseMaterials : undefined
    };

  } catch (error) {
    const errorMessage = error && error.message ? error.message : String(error);
    return {
      status: "ERROR",
      message: `Failed to submit the training application: ${errorMessage}`,
      error: errorMessage
    };
  }
})
