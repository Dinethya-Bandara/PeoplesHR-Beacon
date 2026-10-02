(async function (data, args, reqOptions) {
  try {
    if (
      !BeaconBar.user?.metaData?.menus?.some(menu =>
        menu.includes("TNDV9/TrainingNeed/Index?mvc=1&bs=4&App=000007")
      )
    ) {
      return { error: true, message: "You do not have access to apply for grievance. Please contact HR Admin." };
    }


    const employeeQueries = (Array.isArray(args.employees) ? args.employees : [])
      .map((e) => (e !== undefined && e !== null ? String(e).trim() : ""))
      .filter((e) => e);
    const existingNeedName = args.existingNeedName ? String(args.existingNeedName).trim() : "";
    const newNeedName = args.newNeedName ? String(args.newNeedName).trim() : "";
    const newNeedDescription = args.newNeedDescription ? String(args.newNeedDescription).trim() : "";
    const objective = args.objective ? String(args.objective).trim() : "";
    const relevanceToJob = args.relevanceToJob ? String(args.relevanceToJob).trim() : "";
    const benefitToEmployee = args.benefitToEmployee ? String(args.benefitToEmployee).trim() : "";
    const benefitToCompany = args.benefitToCompany ? String(args.benefitToCompany).trim() : "";

    if (employeeQueries.length === 0) {
      return {
        status: "VALIDATION_ERROR",
        message: "employees is required - provide at least one employee's name or employee number, company-wide (no reporting-line restriction)."
      };
    }

    const jsonHeaders = new Headers();
    jsonHeaders.append("Accept", "*/*");
    jsonHeaders.append("Content-Type", "application/json");
    jsonHeaders.append("x-requested-with", "XMLHttpRequest");

    async function postJson(path, body) {
      const url = `${window.origin}/${reqOptions.sl}/${path}`;
      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: jsonHeaders,
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

    async function getText(url) {
      const textHeaders = new Headers();
      textHeaders.append("accept", "*/*");
      textHeaders.append("x-requested-with", "XMLHttpRequest");
      const response = await fetch(url, { method: "GET", headers: textHeaders });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`${url} failed with HTTP ${response.status}`);
      }
      return text;
    }

    const detailsData = await postJson("TNDV9/TrainingNeed/GetTrainingNeedDetails", { requestType: "000007", WFMainID: "", PerfEmpNo: "" });
    if (!detailsData || !detailsData.Status || detailsData.Status.IsSuccessfull !== true) {
      return {
        status: "ERROR",
        message: (detailsData && detailsData.Status && detailsData.Status.Message) || "Failed to load the training need application form"
      };
    }
    const mainNeed = Array.isArray(detailsData.MainNeed) ? detailsData.MainNeed : [];

    const indexUrl = `${window.origin}/${reqOptions.sl}/TNDV9/TrainingNeed/Index?mvc=1&bs=4&App=000007`;
    const indexHtml = await getText(indexUrl);
    const indexDoc = new DOMParser().parseFromString(indexHtml, "text/html");
    const ownEmpNumber = indexDoc.querySelector("#tndHdnEmpNumber")?.value || "";
    if (!ownEmpNumber) {
      return {
        status: "ERROR",
        message: "Could not resolve the logged-in Admin's own identity token (#tndHdnEmpNumber) from the Add Training Need page - cannot search for employees without it."
      };
    }

    const employeeSearchHtml = await (async () => {
      const url = `${window.origin}/${reqOptions.sl}/TNDV9/Common/GetEmployeeSearch`;
      const response = await fetch(url, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          id: "tndNeedEmployeeSearch",
          title: "Select Employee",
          empNumber: ownEmpNumber,
          callback: "TndTrainingNeedAdmin.OnEmployeeSearchSelect",
          searchMode: "2",
          searchQueryMode: "all",
          searchQueryState: "activeonly",
          isDivLoading: "1",
          isMultiple: "1",
          elggrpid: "0",
          param: "0"
        })
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`GetEmployeeSearch failed with HTTP ${response.status}`);
      return text;
    })();

    const searchTokenMatch = /"&searchToken="\s*\+\s*'([^']+)'/.exec(employeeSearchHtml);
    const searchToken = searchTokenMatch ? searchTokenMatch[1] : "";
    if (!searchToken) {
      return {
        status: "ERROR",
        message: "Could not extract a searchToken from GetEmployeeSearch's response - the employee-search session could not be established."
      };
    }
    const callBackMatch = /"&callBack="\s*\+\s*'([^']+)'/.exec(employeeSearchHtml);
    const callBackConst = callBackMatch ? callBackMatch[1] : "";

    const searchUrl = `${window.origin}/${reqOptions.sl}/CommonComponents/Search/Search?` +
      new URLSearchParams({
        empNumber: ownEmpNumber,
        callBack: callBackConst,
        searchMode: "2",
        searchQueryMode: "all",
        searchQueryState: "activeonly",
        isDivLoading: "1",
        isMultiple: "1",
        searchToken: searchToken,
        _: String(Date.now())
      }).toString();
    const searchHtml = await getText(searchUrl);
    const modelMatch = /window\.advancedModelObj\s*=\s*(['"])(.*?)\1;/s.exec(searchHtml);
    if (!modelMatch) {
      return {
        status: "ERROR",
        message: "Could not find window.advancedModelObj in the employee-search response - could not establish a session key."
      };
    }
    let advancedModel;
    try {
      advancedModel = JSON.parse(modelMatch[2]);
    } catch (parseError) {
      return { status: "ERROR", message: "Failed to parse the employee-search session data (advancedModelObj)." };
    }
    const sessionKey = advancedModel.KeyValue;
    if (!sessionKey) {
      return { status: "ERROR", message: "The employee-search session did not return a KeyValue - cannot continue." };
    }
    const rotatedEmpNumber = advancedModel.EmpNumber;
    if (!rotatedEmpNumber) {
      return { status: "ERROR", message: "The employee-search session did not return a rotated EmpNumber - cannot continue." };
    }

    const resolvedRows = [];
    for (const query of employeeQueries) {
      const searchListResult = await postJson("CommonComponents/Search/GetSearchList/", {
        empNumber: rotatedEmpNumber,
        criteriaValues: [],
        key: sessionKey,
        modeId: "2",
        supEmpNumber: null,
        tblPageNo: 1,
        tblSearchText: query,
        sortColumn: "2",
        sortOrder: "asc"
      });
      const rows = (searchListResult && searchListResult.Object && Array.isArray(searchListResult.Object.data))
        ? searchListResult.Object.data
        : [];
      if (rows.length === 0) {
        return {
          status: "NOT_FOUND",
          message: `No employee matching "${query}" was found.`,
          query
        };
      }
      if (rows.length > 1) {
        const totalCount = (searchListResult._pageData && searchListResult._pageData.TotalCount) || rows.length;
        return {
          status: "AMBIGUOUS",
          message: `More than one employee matches "${query}"${totalCount > rows.length ? ` (${totalCount} total, showing first ${rows.length})` : ""}. Please specify using their exact employee number.`,
          query,
          candidates: rows.map((r) => ({ employeeNumber: r.Col1, name: (r.Col2 || "").trim(), dateJoined: r.Col3, activeStatus: r.Col4 }))
        };
      }
      resolvedRows.push({ query, employeeNumber: rows[0].Col1, name: (rows[0].Col2 || "").trim(), dateJoined: rows[0].Col3 });
    }

    async function resolveOpaqueEmpNumber(row) {
      const url = `${window.origin}/${reqOptions.sl}/CommonComponents/Search/GetEmpNumber/?` +
        new URLSearchParams({
          loggedEmpNumber: rotatedEmpNumber,
          empNumber: row.employeeNumber,
          empDisplayName: row.name,
          empDateJoined: row.dateJoined,
          key: sessionKey,
          _: String(Date.now())
        }).toString();
      const text = await getText(url);
      const parsed = JSON.parse(text);
      return parsed.Message;
    }

    function utf16LeBase64(str) {
      let binary = "";
      for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        binary += String.fromCharCode(code & 0xff, (code >> 8) & 0xff);
      }
      return btoa(binary);
    }
    const encodedSessionKey = utf16LeBase64(sessionKey);

    const searchedEmployeesPayload = [];
    for (const row of resolvedRows) {
      const opaqueEmpNumber = await resolveOpaqueEmpNumber(row);
      if (!opaqueEmpNumber) {
        return {
          status: "ERROR",
          message: `Could not resolve an encrypted identity token for "${row.name}" (${row.employeeNumber}) via GetEmpNumber.`,
          debug_rotatedEmpNumber: rotatedEmpNumber,
          debug_sessionKey: sessionKey,
          debug_row: row
        };
      }
      searchedEmployeesPayload.push({
        Key: encodedSessionKey,
        EmpNumber: opaqueEmpNumber,
        DisNumber: row.employeeNumber,
        DisName: row.name,
        IsExcelFile: 0
      });
    }

    const searchedData = await postJson("TNDV9/TrainingNeed/GetSearchedEmployeeDetails", searchedEmployeesPayload);
    const resolvedList = Array.isArray(searchedData && searchedData.SuborList) ? searchedData.SuborList : null;
    if (!searchedData || !resolvedList) {
      return {
        status: "ERROR",
        message: (searchedData && searchedData.Status && searchedData.Status.Message) || "Failed to resolve the given employee(s)' full HR record via TNDV9/TrainingNeed/GetSearchedEmployeeDetails.",
        debug_searchedEmployeesPayload: searchedEmployeesPayload,
        debug_searchedDataRaw: searchedData
      };
    }
    if (resolvedList.length === 0) {
      return {
        status: "ERROR",
        message: "None of the given employees could be resolved via GetSearchedEmployeeDetails."
      };
    }

    if (!existingNeedName && !newNeedName) {
      return {
        status: "VALIDATION_ERROR",
        message: "Provide either existingNeedName (to attach this application to an existing training need - see getAdminTrainingNeeds) or newNeedName (to submit a brand new one), not neither."
      };
    }
    if (existingNeedName && newNeedName) {
      return {
        status: "VALIDATION_ERROR",
        message: "Provide either existingNeedName or newNeedName, not both - the real form's Training Need Type is either 'Existing Need' or 'New Need', never both at once."
      };
    }

    let typecode;
    let needcode;
    let needname;
    let needdescription;
    if (existingNeedName) {
      const lowerNeedName = existingNeedName.toLowerCase();
      const needMatches = mainNeed.filter((n) => (n.needname || "").toLowerCase().includes(lowerNeedName));
      if (needMatches.length === 0) {
        return {
          status: "ERROR",
          message: `No existing training need matching "${args.existingNeedName}" was found. Use getAdminTrainingNeeds to see what's currently on file, or pass newNeedName to submit a new one.`
        };
      }
      if (needMatches.length > 1) {
        return {
          status: "AMBIGUOUS",
          message: `More than one existing training need matches "${args.existingNeedName}".`,
          ambiguousField: "existingNeedName",
          candidates: needMatches.map((n) => ({ needCode: n.needcode, needName: n.needname }))
        };
      }
      typecode = 1;
      needcode = needMatches[0].needcode;
      needname = "";
      needdescription = "";
    } else {
      typecode = 0;
      needcode = "000000";
      needname = newNeedName;
      needdescription = newNeedDescription;
    }

    // objective/relevanceToJob/benefitToEmployee/benefitToCompany are intentionally NOT
    // hardcoded-required here - whether each is mandatory is a per-client Training &
    // Development configuration toggle (IsObjectiveMandatory, IsRelToJobMandatory,
    // IsPotentialToYouMandatory, IsPotentialToCompMandatory) that can differ between
    // orgs, the same evidence already established for selfEmployeeTrainingNeedApplication/
    // supervisorSubordinateTrainingNeedApplication (see their description.md "Why this
    // change" sections). Each field defaults to "" below and is sent through as-is; the
    // live ValidateNeedApplication call is the real source of truth and its Message is
    // forwarded verbatim as VALIDATION_ERROR if this tenant's config actually requires it.

    // Attachments - read files from the Beacon chat's own upload mechanism, the same
    // source every other write tool in this build reads from (see
    // submitMyGrievanceApplication, selfEmployeeLeaveApplication,
    // selfEmployeeTrainingNeedApplication, supervisorSubordinateTrainingNeedApplication).
    // Entirely optional: with no files attached, Attach/FileNameAttached/AttchList stay at
    // their original "no attachment" values below and none of PrepareNeedAttachments/
    // UploadFile is ever called. Confirmed live that the same TNDV9/TrainingNeed endpoints
    // apply regardless of persona (Applicant/Supervisor/Admin) - PrepareNeedAttachments/
    // UploadFile/DeleteFile/AttchList's shape were all captured from the same TNDV9 module
    // the self-application tool already uses (Dev in progress Features/T&D/), and this
    // screen shares that module's tna_id/typecode convention (tna_id always -1 for a new
    // application record, typecode from the Existing/New Need Type choice resolved above).
    function uploadedFiles() {
      try {
        if (typeof BeaconBar !== "undefined" && typeof BeaconBar.getUploadedBaoFiles === "function") {
          const bao = BeaconBar.getUploadedBaoFiles();
          return Array.isArray(bao) ? bao.filter(Boolean) : (bao ? [bao] : []);
        }
      } catch (e) {
        // Degrade to "no files" rather than throw.
      }
      return [];
    }

    const attachedFiles = uploadedFiles();
    const attchList = [];

    if (attachedFiles.length) {
      // PrepareNeedAttachments gates whether attachments can be added for this need
      // (tna_id/typecode) before any file is actually uploaded - confirmed live
      // (Dev in progress Features/T&D/PrepareNeedAttachments), returning
      // {IsSuccessfull, IsExceed, BudgetExceed, Message}. Bail out here rather than upload
      // files that would just be orphaned by a save the server was always going to reject.
      const prepared = await postJson("TNDV9/TrainingNeed/PrepareNeedAttachments", { tna_id: -1, typecode: typecode });
      if (!prepared || prepared.IsSuccessfull !== true || prepared.IsExceed === true) {
        return {
          status: "ERROR",
          message: (prepared && prepared.Message) || "Could not prepare attachments for this training need application."
        };
      }

      // Confirmed live (Dev in progress Features/T&D/UploadFile, UploadFile-2,
      // UploadFile-3 - repeated for 3 separate files in one application, confirmed
      // multi-attachment works via SaveNeedApplication-round2's 3-entry AttchList): each
      // file is uploaded individually as multipart/form-data with two fields - "fname" (a
      // ddMMyyyyHHmmss_ timestamp prefix plus the original file name, which becomes the
      // server-side filepath) and "file" (the binary itself) - and the endpoint responds
      // with the plain text "True" on success, not JSON. The generated fname is exactly
      // what AttchList's filepath must reference below, so it's captured once per file here.
      const uploadedEntries = [];
      for (const file of attachedFiles) {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const timestamp = `${pad(now.getDate())}${pad(now.getMonth() + 1)}${now.getFullYear()}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const serverFileName = `${timestamp}_${file.name}`;

        const uploadFormData = new FormData();
        uploadFormData.append("fname", serverFileName);
        uploadFormData.append("file", file, file.name);

        let uploadText = "";
        try {
          const uploadRes = await fetch(`${window.origin}/${reqOptions.sl}/TNDV9/TrainingNeed/UploadFile`, {
            method: "POST",
            headers: { "Accept": "*/*", "x-requested-with": "XMLHttpRequest" },
            body: uploadFormData
          });
          uploadText = (await uploadRes.text()).trim();
        } catch (networkError) {
          uploadText = "";
        }

        if (uploadText.toLowerCase() !== "true") {
          // No fixed max size or allowed-type list is hardcoded here - both can differ per
          // client/tenant, so the only real-time source of truth is this UploadFile call
          // itself. On rejection, the resource keys confirmed live via TNDV9/Common/
          // GetTndResource (Dev in progress Features/T&D/GetTndResource - type,
          // GetTndResource-size validation) - "TndFileTypeNotAllowed" ->
          // "File type not allowed" and "TndFileSizeExceeded" -> "Maximum file size
          // exceeded." - line up with exactly this kind of rejection, so a non-"True"
          // response is treated as one of these resource keys and translated into a
          // human-readable message. Not confirmed live that UploadFile's failure body IS
          // literally the resource key (no failing upload was captured) - if the lookup
          // comes back empty/fails, the raw response text is shown instead so nothing is
          // ever silently swallowed.
          let friendlyMessage = uploadText;
          if (uploadText) {
            try {
              const resourceMessage = await postJson("TNDV9/Common/GetTndResource", { resource: uploadText });
              if (typeof resourceMessage === "string" && resourceMessage.trim()) {
                friendlyMessage = resourceMessage.trim();
              }
            } catch (resourceError) {
              // Keep the raw uploadText - this lookup is a best-effort translation only.
            }
          }

          // Roll back whatever was already uploaded during this same call - confirmed live
          // (Dev in progress Features/T&D/DeleteFile: POST {filepath} -> true) - so a failed
          // attachment never leaves orphaned files behind on a submission that never happens.
          for (const uploaded of uploadedEntries) {
            try {
              await postJson("TNDV9/TrainingNeed/DeleteFile", { filepath: uploaded.filepath });
            } catch (cleanupError) {
              // Best-effort only - the upload itself already failed, so a failed cleanup
              // doesn't change the outcome, it just leaves a stray file server-side.
            }
          }
          return {
            status: "ERROR",
            message: `Could not upload "${file.name}"${friendlyMessage ? `: ${friendlyMessage}` : " - the server rejected this file."}`
          };
        }

        const dotIndex = file.name.lastIndexOf(".");
        uploadedEntries.push({
          attchid: uploadedEntries.length + 1,
          attchname: file.name,
          attchtype: dotIndex >= 0 ? file.name.slice(dotIndex + 1).toLowerCase() : "",
          attchfile: "",
          filepath: serverFileName
        });
      }

      attchList.push(...uploadedEntries);
    }

    const empList = resolvedList.map((s) => ({
      tna_id: s.tna_id,
      raw_id: s.raw_id,
      empno: s.empno,
      displayempno: s.displayempno,
      empname: s.empname,
      designame: s.designame || "",
      app_approved: s.app_approved,
      typecode: s.typecode,
      selected: 1,
      enrollstatus: s.enrollstatus,
      appid: s.appid,
      schmode: s.schmode,
      course: s.course,
      SchList: Array.isArray(s.SchList) ? s.SchList : [],
      EvalList: Array.isArray(s.EvalList) ? s.EvalList : []
    }));

    const payload = {
      tna_id: -1,
      needtype: "",
      typecode: typecode,
      needname: needname,
      needdescription: needdescription,
      status: "Pending",
      appdate: null,
      Strappdate: null,
      objective: objective,
      projectcode: "",
      supcomment: "",
      app_person: "",
      app_approved: 0,
      wfmainid: "",
      wfsequence: 0,
      rejectcomment: "",
      centrecode: "",
      reltojob: relevanceToJob,
      potentialyou: benefitToEmployee,
      potentialcomp: benefitToCompany,
      needcode: needcode,
      reqtypecode: "000007",
      reqtypename: "",
      editable: 1,
      enrollstatus: "",
      appid: 0,
      newneed: 1,
      disableneeds: 0,
      Attach: "0",
      FileNameAttached: "",
      EmpList: empList,
      AttchList: attchList,
      IsGoalObject: false,
      ExistingGoals: [],
      SelectedGoalCode: ""
    };

    const validation = await postJson("TNDV9/TrainingNeed/ValidateNeedApplication", payload);
    if (!validation || validation.IsSuccessfull !== true) {
      return {
        status: "VALIDATION_ERROR",
        message: (validation && validation.Message) || "The training need application was rejected during validation."
      };
    }

    const saveResult = await postJson("TNDV9/TrainingNeed/SaveNeedApplication", payload);
    if (!saveResult || saveResult.IsSuccessfull !== true) {
      return {
        status: "ERROR",
        message: (saveResult && saveResult.Message) || "Failed to submit the training need application."
      };
    }

    const results = Array.isArray(saveResult.Results) ? saveResult.Results : [];

    return {
      status: "SUCCESS",
      message: saveResult.Message || "Training need application submitted.",
      needSelectionType: existingNeedName ? "Existing" : "New",
      needCode: needcode,
      needName: existingNeedName ? mainNeed.find((n) => n.needcode === needcode).needname : newNeedName,
      submissions: results.map((r) => ({ employeeNumber: r.empno, success: r.success, status: r.status })),
      attachments: attchList.map((a) => ({ fileName: a.attchname, type: a.attchtype }))
    };

  } catch (error) {
    const errorMessage = error && error.message ? error.message : String(error);
    return {
      status: "ERROR",
      message: `Failed to submit the training need application: ${errorMessage}`,
      error: errorMessage
    };
  }
})
