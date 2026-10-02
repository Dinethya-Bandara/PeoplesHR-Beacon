(async function (data, args, reqOptions) {
  try {
    // Defensive: when this tool is invoked as a sub-tool through an agent router
    // (e.g. EIM Administration) rather than directly, BeaconBar/user/metaData/menus
    // has come back undefined here. `typeof BeaconBar` (rather than referencing it
    // directly) avoids a ReferenceError if the global itself isn't defined, and every
    // step after it is guarded too - an unguarded .some()/.includes() throwing
    // synchronously here, before any argument handling or the fetch() call, is what
    // the platform was reporting as an opaque failure.
    const menus = (typeof BeaconBar !== "undefined" && BeaconBar.user && BeaconBar.user.metaData && BeaconBar.user.metaData.menus) || [];
    const hasAccess = Array.isArray(menus) && menus.some((menu) => typeof menu === "string" && menu.includes("TNDV9/TrainingCalender/Index?mvc=1&bs=4&App=000001"));
    if (!hasAccess) {
      return {
        status: "NO_ACCESS",
        message: "It seems you don't have access. Please check with the HR Admin"
      };
    }

    // CosCode: a specific course code (e.g. "000070"), or "-1" for all courses.
    const courseCode = args.courseCode !== undefined && args.courseCode !== "" ? args.courseCode : "-1";
    // Status: "1" = Approved schedules, "0" = Pending schedules.
    const status = args.status !== undefined && args.status !== "" ? args.status : "1";
    // Optional specific date (YYYY-MM-DD) to narrow results to a single day (UAC 1.2).
    const filterDate = args.date || "";
    // Optional course name (or partial name) - case-insensitive substring match against
    // cosname, applied client-side same as getSelfEmployeeTrainings/
    // supervisorEmployeeTrainingNomination's own courseName resolution, since the
    // underlying GetCourseDetails endpoint only filters server-side by CosCode/Status.
    const courseNameQuery = args.courseName ? String(args.courseName).trim() : "";

    const headers = new Headers();
    headers.append("Accept", "*/*");
    headers.append("Content-Type", "application/json");
    headers.append("x-requested-with", "XMLHttpRequest");

    const url = `${window.origin}/${reqOptions.sl}/TNDV9/TrainingCalender/GetCourseDetails`;

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({ CosCode: courseCode, Status: status })
      });
    } catch (networkError) {
      return {
        status: "ERROR",
        message: `Could not reach the Training Calendar service (${url}): ${networkError.message}`
      };
    }

    // Read as text first - a session timeout or wrong path can come back as an HTML
    // login/error page with a 200, and response.json() would throw an opaque
    // "Unexpected token" error that hides what actually happened.
    const rawText = await response.text();
    let responseData = null;
    try {
      responseData = rawText ? JSON.parse(rawText) : null;
    } catch (parseError) {
      return {
        status: "ERROR",
        message: `Training Calendar service returned a non-JSON response (HTTP ${response.status} from ${url}).`,
        rawResponsePreview: rawText.slice(0, 300)
      };
    }

    if (!response.ok) {
      return {
        status: "ERROR",
        message: `API request to ${url} failed with status ${response.status}`,
        details: (responseData && responseData.Message) || rawText.slice(0, 300)
      };
    }

    // The endpoint returns a wrapper object, not a plain array:
    // { Status: { IsSuccessfull, Message, ... }, calder: [ <schedule entries> ], crs: [ <course code/name pairs> ], App, ValidateCutDate }.
    // The schedule entries used below live under `calder`; `Status.IsSuccessfull` is the actual success flag.
    const statusInfo = responseData && responseData.Status;
    if (!statusInfo || statusInfo.IsSuccessfull !== true || !Array.isArray(responseData.calder)) {
      return {
        status: "ERROR",
        message: (statusInfo && statusInfo.Message) || "Failed to retrieve training calendar course details"
      };
    }
    const calderList = responseData.calder;

    // ASP.NET JSON dates look like "/Date(1730658600000+0530)/". The offset is the
    // server's local offset the wall-clock date was recorded in, so it has to be
    // applied to the epoch ms before reading the date parts back out - otherwise the
    // calendar day can shift depending on the machine's own timezone.
    const parseAspNetDate = (dateStr) => {
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

      const local = new Date(ms + offsetMinutes * 60000);
      const pad = (n) => String(n).padStart(2, "0");
      return {
        iso: new Date(ms).toISOString(),
        dateKey: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
      };
    };

    let schedules = calderList.map((item) => {
      const cosDate = parseAspNetDate(item.cosdate);
      return {
        courseCode: item.coscode || "",
        courseName: item.cosname || "",
        scheduleId: item.schid || "",
        date: cosDate ? cosDate.dateKey : "",
        startDate: parseAspNetDate(item.strtdate)?.dateKey || item.Strstrtdate || "",
        endDate: parseAspNetDate(item.enddate)?.dateKey || item.Strenddate || "",
        applicationCutoffDate: parseAspNetDate(item.cutdate)?.dateKey || item.Strcutdate || "",
        participationDate: parseAspNetDate(item.pardate)?.dateKey || item.Strpardate || "",
        maxParticipants: item.maxpar || 0,
        filledSeats: item.filled || 0,
        availableSeats: item.avaible || 0,
        filledPercentage: item.fillper || 0,
        availablePercentage: item.avaiper || 0,
        status: item.status === "1" ? "Approved" : item.status === "0" ? "Pending" : (item.status || ""),
        calendarColor: item.coscolor || "",
        hasAttachment: !!item.attach,
        attachmentFileName: item.filename || "",
        attachmentFileType: item.filetype || "",
        isHierarchyAvailable: item.isHieAvail === "1"
      };
    });

    if (filterDate) {
      schedules = schedules.filter((s) => s.date === filterDate);
    }

    // courseName filter: case-insensitive substring match, applied after the date
    // filter - same combinable-filters behavior as the rest of this tool.
    if (courseNameQuery) {
      const needle = courseNameQuery.toLowerCase();
      schedules = schedules.filter((s) => s.courseName.toLowerCase().includes(needle));
    }

    if (schedules.length === 0) {
      return {
        status: "SUCCESS",
        message: courseNameQuery
          ? `No scheduled training programs were found matching courseName "${courseNameQuery}"${filterDate ? ` on ${filterDate}` : ""}.`
          : filterDate
            ? `No scheduled training programs were found for ${filterDate}.`
            : "No matching training programs are currently available.",
        totalCount: 0,
        schedules: []
      };
    }

    return {
      status: "SUCCESS",
      message: `Found ${schedules.length} scheduled training program(s).`,
      totalCount: schedules.length,
      schedules: schedules
    };

  } catch (error) {
    const errorMessage = error && error.message ? error.message : String(error);
    return {
      status: "ERROR",
      message: `Failed to retrieve training calendar course details: ${errorMessage}`,
      error: errorMessage
    };
  }
})
