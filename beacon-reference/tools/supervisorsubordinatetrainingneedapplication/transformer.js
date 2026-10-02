(async function (data, args, reqOptions) {
  try {
    if (
      !BeaconBar.user?.metaData?.menus?.some(menu =>
        menu.includes("TNDV9/TrainingNeed/Index?mvc=1&bs=4&App=000002")
      )
    ) {
      return { error: true, message: "You do not have access to apply for grievance. Please contact HR Admin." };
    }


    const subordinateQueries = Array.isArray(args.subordinates)
      ? args.subordinates.map((s) => String(s).trim()).filter((s) => s.length > 0)
      : [];
    const existingNeedName = args.existingNeedName ? String(args.existingNeedName).trim() : "";
    const newNeedName = args.newNeedName ? String(args.newNeedName).trim() : "";
    const newNeedDescription = args.newNeedDescription ? String(args.newNeedDescription).trim() : "";
    const objective = args.objective ? String(args.objective).trim() : "";
    const relevanceToJob = args.relevanceToJob ? String(args.relevanceToJob).trim() : "";
    const benefitToEmployee = args.benefitToEmployee ? String(args.benefitToEmployee).trim() : "";
    const benefitToCompany = args.benefitToCompany ? String(args.benefitToCompany).trim() : "";

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

    const detailsData = await postJson("TNDV9/TrainingNeed/GetTrainingNeedDetails", { requestType: "000002", WFMainID: "", PerfEmpNo: "" });
    if (!detailsData || !detailsData.Status || detailsData.Status.IsSuccessfull !== true) {
      return {
        status: "ERROR",
        message: (detailsData && detailsData.Status && detailsData.Status.Message) || "Failed to load the training need application form"
      };
    }
    const mainNeed = Array.isArray(detailsData.MainNeed) ? detailsData.MainNeed : [];
    const suborList = Array.isArray(detailsData.SuborList) ? detailsData.SuborList : [];
    if (suborList.length === 0) {
      return {
        status: "ERROR",
        message: "Could not load your subordinate list from the training need application form."
      };
    }

    const eligibleSubordinates = suborList.map((s) => ({ displayempno: s.displayempno, empname: s.empname, designation: s.designame }));

    // subordinates is optional on this call specifically so "who are my subordinates?"
    // can be answered without already knowing a name - GetTrainingNeedDetails' SuborList
    // (fetched above) already contains the full direct-report roster regardless of what
    // was passed in, so there is nothing to gain by requiring a name just to look it up.
    // Nothing is submitted on this listing path; call this tool again with subordinates
    // set (plus the need/narrative fields) once the supervisor has picked who it's for.
    if (subordinateQueries.length === 0) {
      return {
        status: "LISTED",
        message: "Here are your direct reports. Ask which one(s) this training need application is for, then call this tool again with subordinates set to their exact name(s) or employee number(s) (along with existingNeedName/newNeedName and the other required fields).",
        eligibleSubordinates: eligibleSubordinates
      };
    }

    const notFound = [];
    const ambiguous = [];
    const resolvedRecords = [];
    subordinateQueries.forEach((query) => {
      const lowerQuery = query.toLowerCase();
      let matches = suborList.filter((s) => (s.displayempno || "").toLowerCase() === lowerQuery);
      if (matches.length === 0) {
        matches = suborList.filter((s) => (s.empname || "").toLowerCase().includes(lowerQuery));
      }
      if (matches.length === 0) {
        notFound.push(query);
      } else if (matches.length > 1) {
        ambiguous.push({
          query: query,
          candidates: matches.map((s) => ({ employeeNumber: s.displayempno, name: s.empname, designation: s.designame }))
        });
      } else {
        resolvedRecords.push(matches[0]);
      }
    });

    if (notFound.length > 0) {
      return {
        status: "NOT_SUBORDINATE",
        message: `${notFound.map((q) => `"${q}"`).join(", ")} ${notFound.length === 1 ? "does" : "do"} not appear to be a subordinate you can submit a training need for. Please check the name(s) or employee number(s) and try again.`,
        eligibleSubordinates: eligibleSubordinates
      };
    }
    if (ambiguous.length > 0) {
      return {
        status: "AMBIGUOUS",
        message: `More than one subordinate matches ${ambiguous.map((a) => `"${a.query}"`).join(", ")}. Please specify using their exact employee number.`,
        candidates: ambiguous
      };
    }

    if (!existingNeedName && !newNeedName) {
      return {
        status: "VALIDATION_ERROR",
        message: "Provide either existingNeedName (to attach this application to an existing training need - see getSupervisorTrainingNeeds) or newNeedName (to submit a brand new one), not neither."
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
          message: `No existing training need matching "${args.existingNeedName}" was found. Use getSupervisorTrainingNeeds to see what's currently on file, or pass newNeedName to submit a new one.`
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

    // Attachments - read files from the Beacon chat's own upload mechanism, the same
    // source every other write tool in this build reads from (see
    // submitMyGrievanceApplication, selfEmployeeLeaveApplication,
    // selfEmployeeTrainingNeedApplication). Entirely optional: with no files attached,
    // Attach/FileNameAttached/AttchList stay at their original "no attachment" values below
    // and none of PrepareNeedAttachments/UploadFile is ever called. Confirmed live that the
    // same TNDV9/TrainingNeed endpoints apply regardless of persona (Applicant vs
    // Supervisor) - PrepareNeedAttachments/UploadFile/DeleteFile/AttchList's shape were all
    // captured from the same TNDV9 module the self-application tool already uses (Dev in
    // progress Features/T&D/), and this screen shares that module's tna_id/typecode
    // convention (tna_id always -1 for a new application record, typecode from the
    // Existing/New Need Type choice resolved just above).
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

    // Confirmation gate - confirmed live via TNDV9/Common/GetTndResource ({resource:
    // "TndNeedApplicationSaveConfirm"} -> "Are you sure you want to submit this training
    // need?"): the real form always shows this confirm dialog right before Save, after
    // every field has already been filled in. Nothing is uploaded, validated, or saved
    // until the supervisor has reviewed this exact application and confirmed - placed
    // here (after subordinates/need/attachment-detection, before any write call) so the
    // preview reflects exactly what would be submitted. The prompt text is fetched live
    // rather than hardcoded, same reasoning as the file-type/size messages below.
    if (!args.confirmed) {
      let confirmPrompt = "Are you sure you want to submit this training need?";
      try {
        const promptResource = await postJson("TNDV9/Common/GetTndResource", { resource: "TndNeedApplicationSaveConfirm" });
        if (typeof promptResource === "string" && promptResource.trim()) {
          confirmPrompt = promptResource.trim();
        }
      } catch (resourceError) {
        // Keep the fallback text above - this lookup is best-effort only.
      }

      return {
        status: "CONFIRMATION_REQUIRED",
        message: `Review this training need application with the supervisor before submitting. ${confirmPrompt} Call this tool again with confirmed:true (and the same arguments) once they agree.`,
        confirmationPrompt: confirmPrompt,
        preview: {
          subordinates: resolvedRecords.map((r) => ({ employeeNumber: r.displayempno, name: r.empname })),
          needSelectionType: existingNeedName ? "Existing" : "New",
          needName: existingNeedName ? mainNeed.find((n) => n.needcode === needcode).needname : newNeedName,
          objective: objective,
          relevanceToJob: relevanceToJob,
          benefitToEmployee: benefitToEmployee,
          benefitToCompany: benefitToCompany,
          attachments: attachedFiles.map((f) => ({ fileName: f.name }))
        }
      };
    }

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

    const resolvedDisplayEmpNos = new Set(resolvedRecords.map((r) => r.displayempno));
    const empList = suborList.map((s) => ({
      tna_id: s.tna_id,
      raw_id: s.raw_id,
      empno: s.empno,
      displayempno: s.displayempno,
      empname: s.empname,
      designame: s.designame,
      app_approved: s.app_approved,
      typecode: s.typecode,
      selected: resolvedDisplayEmpNos.has(s.displayempno) ? 1 : 0,
      enrollstatus: s.enrollstatus,
      appid: s.appid,
      schmode: s.schmode,
      course: s.course,
      SchList: Array.isArray(s.SchList) ? s.SchList : [],
      EvalList: Array.isArray(s.EvalList) ? s.EvalList : []
    }));

    // Attach stays "0" and FileNameAttached stays "" even when files ARE attached -
    // confirmed live for the self-application tool against the same TNDV9 module (Dev in
    // progress Features/T&D/ValidateNeedApplication, SaveNeedApplication with a real
    // attachment): the module links attachments purely through AttchList, populated above.
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
      reqtypecode: "000002",
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
